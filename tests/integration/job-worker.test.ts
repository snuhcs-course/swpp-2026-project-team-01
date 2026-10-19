import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { createJobWorkerHandler, type JobRouteDependencies } from "../../lib/server/job-worker";
import { claimJobs, type JobHandler, publishJob } from "../../lib/server/jobs";
import { devWorkerRefusal } from "../../scripts/jobs-dev";
import type { Database } from "../../lib/server/database";
import { testDatabase } from "./support/database";

const db = testDatabase();
const secret = randomBytes(32).toString("base64url");
const production = { VERCEL: "1", VERCEL_ENV: "production" };
const url = "http://localhost:3000/api/internal/jobs";

afterAll(async () => {
  await db.end();
});

function kind() {
  return `test.${randomUUID()}`;
}

async function publishProduction(jobKind: string) {
  return (await db.begin((tx) => publishJob(tx, { kind: jobKind }, "production"))) as string;
}

function worker(handlers: Record<string, JobHandler>, overrides: Partial<JobRouteDependencies> = {}) {
  return createJobWorkerHandler(() => ({ db, env: production, handlers, secret, ...overrides }));
}

async function job(id: string) {
  const [row] = await db<{ attempts: number; fence: number; state: string }[]>`
    select state, attempts, fence from app.jobs where id = ${id}
  `;
  return row!;
}

describe("job worker route", () => {
  it.each([
    ["no credential", {}],
    ["a wrong secret", { authorization: `Bearer ${randomBytes(32).toString("base64url")}` }],
    ["the secret without the bearer scheme", { authorization: secret }],
    ["a browser session cookie", { cookie: "sb-127-auth-token=base64-eyJ1c2VyIjp7fX0" }],
  ])("denies a public caller with %s without claiming", async (_label, headers) => {
    const jobKind = kind();
    const id = await publishProduction(jobKind);

    const response = await worker({ [jobKind]: async () => ({}) })(new Request(url, { headers, method: "POST" }));

    expect(response.status).toBe(401);
    expect(await job(id)).toEqual({ attempts: 0, fence: 0, state: "pending" });
  });

  it("reports unavailable configuration without a worker secret and claims nothing", async () => {
    const jobKind = kind();
    const id = await publishProduction(jobKind);

    const response = await worker({ [jobKind]: async () => ({}) }, { secret: undefined })(
      new Request(url, { headers: { authorization: "Bearer " }, method: "POST" }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { category: "unavailable_configuration" } });
    expect(await job(id)).toEqual({ attempts: 0, fence: 0, state: "pending" });
  });

  it("processes due work for an authorized call", async () => {
    const jobKind = kind();
    const id = await publishProduction(jobKind);

    const response = await worker({ [jobKind]: async () => ({ ok: true }) })(
      new Request(url, { headers: { authorization: `Bearer ${secret}` }, method: "POST" }),
    );

    expect(await response.json()).toEqual({ claimed: 1, results: { completed: 1 } });
    expect(await job(id)).toMatchObject({ attempts: 1, state: "completed" });
  });

  it("recovers a job whose worker died mid-job once its lease expires", async () => {
    const jobKind = kind();
    const id = await publishProduction(jobKind);
    const handle = worker({ [jobKind]: async () => ({ recovered: true }) });
    const call = () => handle(new Request(url, { headers: { authorization: `Bearer ${secret}` }, method: "POST" }));

    // The first worker claims the job for one second and dies without an outcome.
    const [dead] = await claimJobs(db, { environment: "production", kinds: [jobKind], leaseSeconds: 1, owner: "dead" });
    expect(await (await call()).json()).toEqual({ claimed: 0, results: {} });

    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(await (await call()).json()).toEqual({ claimed: 1, results: { completed: 1 } });
    const recovered = await job(id);
    expect(recovered).toMatchObject({ attempts: 2, state: "completed" });
    expect(recovered.fence).toBeGreaterThan(dead!.fence);
  });
});

// A database stand-in that fails the test on any use.
const untouchable = new Proxy(() => {}, {
  apply: () => {
    throw new Error("the worker touched the database");
  },
  get: () => {
    throw new Error("the worker touched the database");
  },
}) as unknown as Database;

describe("production fence", () => {
  it.each([
    ["a preview deployment", { VERCEL: "1", VERCEL_ENV: "preview" }],
    ["a custom environment", { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "staging" }],
    ["Vercel development", { VERCEL: "1", VERCEL_ENV: "development" }],
    ["VERCEL_ENV without VERCEL", { VERCEL_ENV: "production" }],
    ["VERCEL without VERCEL_ENV", { VERCEL: "1" }],
    ["a production label on another target", { VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "preview" }],
    ["a process outside Vercel", {}],
  ])("refuses on %s before touching job state", async (_label, env) => {
    const handle = createJobWorkerHandler(() => ({ db: untouchable, env, handlers: { any: async () => ({}) }, secret }));

    const response = await handle(new Request(url, { headers: { authorization: `Bearer ${secret}` }, method: "POST" }));

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ error: { category: "unavailable_configuration" } });
    expect(body).not.toContain(secret);
    expect(body).not.toMatch(/preview|staging|development|VERCEL/);
  });

  it("leaves a preview-produced job unclaimed and visible while production work runs", async () => {
    const jobKind = kind();
    const previewJob = (await db.begin((tx) => publishJob(tx, { kind: jobKind }, "preview"))) as string;
    const productionJob = await publishProduction(jobKind);

    const response = await worker({ [jobKind]: async () => ({ ok: true }) })(
      new Request(url, { headers: { authorization: `Bearer ${secret}` }, method: "POST" }),
    );

    expect(await response.json()).toEqual({ claimed: 1, results: { completed: 1 } });
    expect(await job(productionJob)).toMatchObject({ state: "completed" });
    expect(await job(previewJob)).toEqual({ attempts: 0, fence: 0, state: "pending" });
  });
});

describe("worker wake-ups", () => {
  it("processes work whose wake-up was lost when the sweep runs", async () => {
    const jobKind = kind();
    const handle = worker({ [jobKind]: async () => ({ swept: true }) });
    const requests: string[] = [];
    // The database container reaches this server through host.docker.internal.
    const server = createServer(async (incoming, outgoing) => {
      requests.push(incoming.url ?? "");
      const response = await handle(
        new Request(`http://host.docker.internal${incoming.url}`, {
          headers: { authorization: incoming.headers.authorization ?? "" },
          method: incoming.method,
        }),
      );
      outgoing.writeHead(response.status, { "content-type": "application/json" });
      outgoing.end(await response.text());
    });
    await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      // Committed while Vault holds no worker entries, so its wake-up is lost.
      const id = await publishProduction(jobKind);
      expect(await job(id)).toMatchObject({ state: "pending" });

      await db`
        select vault.create_secret(${`http://host.docker.internal:${port}/api/internal/jobs`}, 'worker_url'),
               vault.create_secret(${secret}, 'worker_secret')
      `;
      const [sweep] = await db<{ requested: boolean }[]>`select app.sweep_jobs() as requested`;
      expect(sweep!.requested).toBe(true);

      for (let waited = 0; waited < 15_000 && (await job(id)).state !== "completed"; waited += 250) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      expect(await job(id)).toMatchObject({ state: "completed" });
      expect(requests).toContain("/api/internal/jobs");
    } finally {
      await db`delete from vault.secrets where name in ('worker_url', 'worker_secret')`;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("jobs:dev", () => {
  it.each([
    [{ DATABASE_URL: "postgresql://postgres@127.0.0.1:54322/postgres", SUPABASE_PROJECT_REF: "anelszynxtvxoxqvzgqt" }],
    [{ DATABASE_URL: "postgresql://postgres.anelszynxtvxoxqvzgqt:pw@aws-0-us-east-2.pooler.supabase.com:6543/postgres" }],
    [{ DATABASE_URL: "postgresql://postgres.mriseqztcwmezvtawnbo:pw@aws-0-us-east-2.pooler.supabase.com:6543/postgres" }],
  ])("refuses the shared or reserved project %#", (env) => {
    expect(devWorkerRefusal(env)).toMatch(/refuses a shared or reserved Supabase project/);
  });

  it("refuses to run on Vercel and accepts the local stack", () => {
    const local = { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" };

    expect(devWorkerRefusal({ ...local, ...production })).toMatch(/outside Vercel/);
    expect(devWorkerRefusal(local)).toBeNull();
  });

  it("exits with an error before connecting when pointed at the shared project", async () => {
    const run = promisify(execFile)("npm", ["run", "--silent", "jobs:dev"], {
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:1/postgres",
        SUPABASE_PROJECT_REF: "anelszynxtvxoxqvzgqt",
      },
    });

    await expect(run).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("refuses a shared or reserved Supabase project"),
    });
  });
});

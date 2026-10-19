import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { readHostStanding } from "../../lib/server/host-eligibility";
import { type AdminDependencies, runAdmin } from "../../lib/server/operator";
import { findReadyHostByHandle } from "../../lib/server/readiness";
import { signInHost } from "./support/auth";
import { LOCAL_DATABASE_URL, testDatabase } from "./support/database";
import { makeHostReady } from "./support/ready-host";

const db = testDatabase();

afterAll(async () => {
  await db.end();
});

function admin(env: Record<string, string | undefined> = { DATABASE_URL: process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL }) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: AdminDependencies = {
    env,
    interactive: false,
    prompt: async () => "",
    stderr: (line) => err.push(line),
    stdout: (line) => out.push(line),
  };
  return { deps, err, out };
}

async function readyHost() {
  const host = await signInHost(db);
  const { handle } = await makeHostReady(db, host.hostAccountId);
  return { ...host, handle };
}

describe("fmat-admin against the local stack", () => {
  it("suspends a host: hosting is refused and the public profile disappears, with an audit row", async () => {
    const host = await readyHost();
    const reason = `abuse report ${randomUUID()} (O'Neil)`;
    const run = admin();

    expect(await runAdmin(["suspend", "--host", host.handle, "--reason", reason, "--operator", "dana", "--local", "--yes"], run.deps)).toBe(0);
    expect(run.out).toContain("Environment: local");
    expect(run.out.at(-1)).toBe(`Host account ${host.hostAccountId}: active -> suspended`);

    expect(await readHostStanding(db, host.userId)).toMatchObject({ eligible: false, nextAction: "account_suspended" });
    expect(await findReadyHostByHandle(db, host.handle)).toBeNull();

    const audit = await db<{ action: string; environment: string; operator: string; previous_status: string; reason: string }[]>`
      select action, environment, operator, previous_status, reason from app.operator_actions where host_account_id = ${host.hostAccountId}
    `;
    expect(audit).toEqual([{ action: "suspend", environment: "local", operator: "dana", previous_status: "active", reason }]);
  });

  it("restores a host by account ID with its saved setup and public profile", async () => {
    const host = await readyHost();

    expect(await runAdmin(["suspend", "--host", host.hostAccountId, "--reason", "test", "--operator", "dana", "--local", "--yes"], admin().deps)).toBe(0);
    expect(await runAdmin(["restore", "--host", host.hostAccountId.toUpperCase(), "--reason", "appeal", "--operator", "dana", "--local", "--yes"], admin().deps)).toBe(0);

    expect(await readHostStanding(db, host.userId)).toMatchObject({ eligible: true, nextAction: null, ready: true });
    expect(await findReadyHostByHandle(db, host.handle)).toMatchObject({ handle: host.handle, hostAccountId: host.hostAccountId });

    const shown = admin();
    expect(await runAdmin(["show", "--host", host.handle, "--operator", "dana", "--local"], shown.deps)).toBe(0);
    expect(shown.out).toEqual([
      "Environment: local",
      `Host account: ${host.hostAccountId}`,
      "Status: active",
      `Handle: ${host.handle}`,
      "Ready: yes",
    ]);
  });

  it("refuses a mutation without --yes when no one can confirm, changing nothing", async () => {
    const host = await readyHost();
    const run = admin();

    expect(await runAdmin(["suspend", "--host", host.handle, "--reason", "test", "--operator", "dana", "--local"], run.deps)).toBe(1);
    expect(await findReadyHostByHandle(db, host.handle)).not.toBeNull();
  });

  it("accepts a typed confirmation of the host", async () => {
    const host = await readyHost();
    const run = admin();

    expect(
      await runAdmin(["suspend", "--host", host.handle, "--reason", "test", "--operator", "dana", "--local"], {
        ...run.deps,
        interactive: true,
        prompt: async () => host.handle,
      }),
    ).toBe(0);
    expect(await findReadyHostByHandle(db, host.handle)).toBeNull();
  });

  it("refuses --local when DATABASE_URL is not the local stack", async () => {
    for (const url of [
      "postgresql://postgres.anelszynxtvxoxqvzgqt:secret@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres",
      "postgresql://postgres:postgres@127.0.0.1.evil.example:54322/postgres",
      undefined,
    ]) {
      const run = admin({ DATABASE_URL: url });
      expect(await runAdmin(["show", "--host", "ada", "--operator", "dana", "--local"], run.deps)).toBe(1);
      expect(run.err.join("\n")).toMatch(/local stack|needs DATABASE_URL/);
    }
  });

  it("reports an unknown host without changing anything", async () => {
    const run = admin();

    expect(await runAdmin(["suspend", "--host", `nobody-${randomUUID().slice(0, 8)}`, "--reason", "x", "--operator", "dana", "--local", "--yes"], run.deps)).toBe(1);
    expect(run.err.join("\n")).toMatch(/no host matches/);
  });

  it("denies the operator function to Data API roles", async () => {
    const host = await readyHost();

    for (const role of ["anon", "authenticated"]) {
      await expect(
        db.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select * from app.operator_set_host_status(${host.handle}, 'suspended', 'mallory', 'x', 'local')`;
        }),
      ).rejects.toThrow(/permission denied/);
    }

    expect(await findReadyHostByHandle(db, host.handle)).not.toBeNull();
  });
});

describe("fmat-admin through the Management API", () => {
  it("posts the statement to the project's database query endpoint with the operator's token", async () => {
    const requests: { authorization?: string; body: string; method?: string; url?: string }[] = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      requests.push({ authorization: request.headers.authorization, body, method: request.method, url: request.url });
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify([{ host_account_id: "0b9a4c1e-1111-4222-8333-944455556666", previous_status: "active", status: "suspended" }]));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const run = admin({ SUPABASE_ACCESS_TOKEN: "sbp_test_token" });

    try {
      const code = await runAdmin(
        ["suspend", "--host", "ada", "--reason", "spam", "--operator", "dana", "--project", "abcdefghijklmnopqrst", "--yes"],
        { ...run.deps, managementApiUrl: `http://127.0.0.1:${port}` },
      );

      expect(code).toBe(0);
      expect(run.out).toContain("Environment: project:abcdefghijklmnopqrst");
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        authorization: "Bearer sbp_test_token",
        method: "POST",
        url: "/v1/projects/abcdefghijklmnopqrst/database/query",
      });
      expect((JSON.parse(requests[0]!.body) as { query: string }).query).toContain(
        "app.operator_set_host_status('ada', 'suspended', 'dana', 'spam', 'project:abcdefghijklmnopqrst')",
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("refuses --project without the operator's own access token", async () => {
    const run = admin({});

    expect(await runAdmin(["show", "--host", "ada", "--operator", "dana", "--project", "abcdefghijklmnopqrst"], run.deps)).toBe(1);
    expect(run.err.join("\n")).toMatch(/SUPABASE_ACCESS_TOKEN/);
  });
});

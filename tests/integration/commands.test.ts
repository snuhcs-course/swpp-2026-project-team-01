import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { COMMAND_ERROR_MESSAGES } from "../../lib/contracts/command-errors";
import {
  type Actor,
  assertRevision,
  type CommandDefinition,
  CommandError,
  configurationStatus,
  runCommand,
  verifiedHostActor,
} from "../../lib/server/commands";
import {
  createGoogleCallbackHandler,
  createGoogleSignInHandler,
  type GoogleSignInDependencies,
} from "../../lib/server/google-sign-in";
import { createGrantedScopesFetcher } from "../../lib/server/google-token-info";
import { publishJob } from "../../lib/server/jobs";
import { parseTokenKey } from "../../lib/server/token-encryption";
import {
  completeGoogleLeg,
  cookieHeader,
  createGoogleUser,
  localAuthConfig,
  startFakeTokenInfo,
  startGoogleSignIn,
} from "./support/auth";
import { LOCAL_DATABASE_URL, testDatabase } from "./support/database";

const db = testDatabase();

afterAll(async () => {
  await db.end();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function hostActor(): Actor {
  return { id: randomUUID(), kind: "host_account" };
}

// A probe command over an in-memory resource: it checks the expected revision,
// bumps the revision and counts how often it actually ran.
function probeCommand(resource = { revision: 1 }) {
  const runs: string[] = [];
  const command: CommandDefinition<{ title: string }, { revision: number; title: string }> = {
    input: z.strictObject({ title: z.string().min(1) }),
    operation: "probe.rename",
    run: async (_tx, context) => {
      assertRevision(resource.revision, context.expectedRevision);
      runs.push(context.input.title);
      resource.revision += 1;
      return { revision: resource.revision, title: context.input.title };
    },
  };

  return { command, resource, runs };
}

describe("command pipeline", () => {
  it("returns the saved outcome for an identical retry without running the command again", async () => {
    const actor = hostActor();
    const { command, runs } = probeCommand();
    const deps = { authenticate: async () => actor, db };
    const request = { expectedRevision: 1, input: { title: "Weekly sync" }, resourceId: "r1", retryKey: randomUUID() };

    const first = await runCommand(deps, command, request);
    const retry = await runCommand(deps, command, { ...request, input: { title: "Weekly sync" } });

    expect(first).toMatchObject({ ok: true, replayed: false, result: { revision: 2, title: "Weekly sync" } });
    expect(retry).toMatchObject({ ok: true, replayed: true, result: { revision: 2, title: "Weekly sync" } });
    expect(runs).toEqual(["Weekly sync"]);
  });

  it("publishes a command's job once, not again on an identical retry", async () => {
    const actor = hostActor();
    const jobKind = `test.${randomUUID()}`;
    const command: CommandDefinition<{ title: string }, { jobId: string | null }> = {
      input: z.strictObject({ title: z.string() }),
      operation: "probe.publish",
      run: async (tx, context) => ({
        jobId: await publishJob(tx, { kind: jobKind, payload: { title: context.input.title } }, "local"),
      }),
    };
    const deps = { authenticate: async () => actor, db };
    const request = { input: { title: "Weekly sync" }, resourceId: "r1", retryKey: randomUUID() };

    const first = await runCommand(deps, command, request);
    const retry = await runCommand(deps, command, request);

    expect(retry).toMatchObject({ ok: true, replayed: true });
    expect(retry.ok && first.ok && retry.result.jobId).toBe(first.ok && first.result.jobId);
    const [jobs] = await db<{ count: number }[]>`select count(*)::int as count from app.jobs where kind = ${jobKind}`;
    expect(jobs!.count).toBe(1);
  });

  it("rejects a retry key reused with changed input, operation or resource without changing state", async () => {
    const actor = hostActor();
    const { command, resource, runs } = probeCommand();
    const deps = { authenticate: async () => actor, db };
    const retryKey = randomUUID();

    await runCommand(deps, command, { expectedRevision: 1, input: { title: "A" }, resourceId: "r1", retryKey });

    const changedInput = await runCommand(deps, command, {
      expectedRevision: 1,
      input: { title: "B" },
      resourceId: "r1",
      retryKey,
    });
    const changedResource = await runCommand(deps, command, {
      expectedRevision: 1,
      input: { title: "A" },
      resourceId: "r2",
      retryKey,
    });
    const changedOperation = await runCommand(
      deps,
      { ...command, operation: "probe.other" },
      { expectedRevision: 1, input: { title: "A" }, resourceId: "r1", retryKey },
    );

    for (const outcome of [changedInput, changedResource, changedOperation]) {
      expect(outcome).toMatchObject({ error: { category: "retry_conflict" }, ok: false });
    }
    expect(runs).toEqual(["A"]);
    expect(resource.revision).toBe(2);
  });

  it("keeps the same retry key independent between actors", async () => {
    const { command, runs } = probeCommand({ revision: 1 });
    const retryKey = randomUUID();
    const request = { expectedRevision: 1, input: { title: "A" }, resourceId: "r1", retryKey };

    await runCommand({ authenticate: async () => hostActor(), db }, command, request);
    const other = await runCommand({ authenticate: async () => hostActor(), db }, command, {
      ...request,
      expectedRevision: 2,
    });

    expect(other).toMatchObject({ ok: true, replayed: false });
    expect(runs).toEqual(["A", "A"]);
  });

  it("rejects a stale expected revision and saves nothing", async () => {
    const actor = hostActor();
    const { command, runs } = probeCommand({ revision: 3 });
    const retryKey = randomUUID();

    const outcome = await runCommand({ authenticate: async () => actor, db }, command, {
      expectedRevision: 2,
      input: { title: "A" },
      resourceId: "r1",
      retryKey,
    });

    expect(outcome).toMatchObject({ error: { category: "stale_revision" }, ok: false });
    expect(runs).toEqual([]);
    const saved = await db`select 1 from app.command_outcomes where retry_key = ${retryKey}`;
    expect(saved.count).toBe(0);
  });

  it("rejects a supplied actor before authenticating or running the command", async () => {
    const actor = hostActor();
    const foreign = hostActor();
    const { command, runs } = probeCommand();
    const authenticate = vi.fn(async () => actor);

    const outcome = await runCommand({ authenticate, db }, command, {
      expectedRevision: 1,
      input: { hostAccountId: foreign.id, title: "A" },
      resourceId: "r1",
      retryKey: randomUUID(),
    });

    expect(outcome).toMatchObject({ error: { category: "forbidden" }, ok: false });
    expect(authenticate).not.toHaveBeenCalled();
    expect(runs).toEqual([]);
    expect(JSON.stringify(outcome)).not.toContain(foreign.id);
  });

  it("rejects an unauthenticated caller", async () => {
    const { command, runs } = probeCommand();

    const outcome = await runCommand({ authenticate: async () => null, db }, command, {
      input: { title: "A" },
      resourceId: "r1",
      retryKey: randomUUID(),
    });

    expect(outcome).toMatchObject({ error: { category: "unauthenticated" }, ok: false });
    expect(runs).toEqual([]);
  });

  it.each(["anon", "authenticated"])("denies a %s database client at the command boundary", async (role) => {
    // Same login, but every statement runs as the Data API role.
    const roleClient = postgres(process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL, {
      connection: { role },
      prepare: false,
    });
    const { command, runs } = probeCommand();
    const retryKey = randomUUID();

    try {
      const outcome = await runCommand({ authenticate: async () => hostActor(), db: roleClient }, command, {
        expectedRevision: 1,
        input: { title: "A" },
        resourceId: "r1",
        retryKey,
      });

      expect(outcome).toMatchObject({ error: { category: "forbidden" }, ok: false });
      expect(runs).toEqual([]);
      const saved = await db`select 1 from app.command_outcomes where retry_key = ${retryKey}`;
      expect(saved.count).toBe(0);
    } finally {
      await roleClient.end();
    }
  });

  it("answers with a safe category and correlation identifier and logs no secret", async () => {
    const secret = `ya29.${randomBytes(24).toString("base64url")}`;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const command: CommandDefinition<object, never> = {
      input: z.strictObject({}),
      operation: "probe.provider",
      run: async () => {
        throw new Error(`Google rejected access token ${secret} for calendar "Therapy with Dr. Kim"`, {
          cause: { token: secret },
        });
      },
    };

    const outcome = await runCommand({ authenticate: async () => hostActor(), db }, command, {
      input: {},
      resourceId: "r1",
      retryKey: randomUUID(),
    });

    expect(outcome.ok).toBe(false);
    const error = outcome.ok ? null : outcome.error;
    expect(error).toEqual({
      category: "internal",
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      message: COMMAND_ERROR_MESSAGES.internal,
    });
    const logged = log.mock.calls.flat().join("\n");
    expect(logged).toContain(error!.correlationId);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain("Therapy");
    expect(JSON.stringify(outcome)).not.toContain(secret);
  });

  it("reports a missing provider secret as unavailable configuration without running", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn(async () => ({ sent: true }));
    const command: CommandDefinition<object, { sent: boolean }> = {
      input: z.strictObject({}),
      operation: "probe.needs_provider",
      requires: ["PROBE_PROVIDER_SECRET"],
      run,
    };

    const outcome = await runCommand(
      { authenticate: async () => hostActor(), db, env: { PROBE_PROVIDER_SECRET: "" } },
      command,
      { input: {}, resourceId: "r1", retryKey: randomUUID() },
    );

    expect(outcome).toMatchObject({ error: { category: "unavailable_configuration" }, ok: false });
    expect(run).not.toHaveBeenCalled();
    expect(configurationStatus({ probe: ["PROBE_PROVIDER_SECRET"] }, {})).toEqual({
      application: "reachable",
      providers: { probe: "unavailable" },
    });
    expect(configurationStatus({ probe: ["PROBE_PROVIDER_SECRET"] }, { PROBE_PROVIDER_SECRET: "set" })).toEqual({
      application: "reachable",
      providers: { probe: "ready" },
    });
  });

  it("maps a command error to its own category", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const command: CommandDefinition<object, never> = {
      input: z.strictObject({}),
      operation: "probe.denied",
      run: async () => {
        throw new CommandError("forbidden");
      },
    };

    const outcome = await runCommand({ authenticate: async () => hostActor(), db }, command, {
      input: {},
      resourceId: "r1",
      retryKey: randomUUID(),
    });

    expect(outcome).toMatchObject({ error: { category: "forbidden", message: COMMAND_ERROR_MESSAGES.forbidden } });
  });
});

describe("verified host actor", () => {
  const origin = "http://localhost:3000";
  let tokenInfo: Awaited<ReturnType<typeof startFakeTokenInfo>>;
  let deps: GoogleSignInDependencies;

  beforeAll(async () => {
    tokenInfo = await startFakeTokenInfo({});
    deps = {
      appOrigin: origin,
      auth: localAuthConfig(),
      db,
      fetchGrantedScopes: createGrantedScopesFetcher(tokenInfo.url),
      tokenKey: parseTokenKey(randomBytes(32).toString("base64")),
    };
  });

  afterAll(async () => {
    await tokenInfo.close();
  });

  it("derives the host account from a verified session and nothing from a missing one", async () => {
    const user = await createGoogleUser(db);
    const flow = await startGoogleSignIn(createGoogleSignInHandler(() => deps), origin);
    const code = await completeGoogleLeg(db, flow.codeChallenge, user.userId, {
      accessToken: `ya29.${randomUUID()}`,
      refreshToken: null,
    });
    const callback = await createGoogleCallbackHandler(() => deps)(
      new Request(`${origin}/auth/callback?code=${code}`, { headers: { cookie: flow.cookie } }),
    );
    const [account] = await db<{ id: string }[]>`
      select host_account_id as id from app.google_identities where auth_user_id = ${user.userId}
    `;

    const signedIn = new Request(`${origin}/app`, { headers: { cookie: cookieHeader(flow.response, callback) } });
    const anonymous = new Request(`${origin}/app`);
    const forged = new Request(`${origin}/app`, {
      headers: { cookie: `sb-127-auth-token=${Buffer.from(JSON.stringify({ user: { id: user.userId } })).toString("base64")}` },
    });

    expect(await verifiedHostActor(signedIn, { auth: deps.auth, db })).toEqual({ id: account!.id, kind: "host_account" });
    expect(await verifiedHostActor(anonymous, { auth: deps.auth, db })).toBeNull();
    expect(await verifiedHostActor(forged, { auth: deps.auth, db })).toBeNull();
  });
});

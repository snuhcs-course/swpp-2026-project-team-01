import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "../../lib/server/commands";
import { createAppAuth } from "../../lib/server/eve-auth";
import { signInternalBearer } from "../../lib/server/internal-bearer";
import { sessionIdHash } from "../../lib/server/model-limits";
import {
  draftSettingsForTool,
  readSetupStateForTool,
  type SetupToolCall,
  SetupToolDeniedError,
} from "../../lib/server/setup-tools";
import { localAuthConfig } from "./support/auth";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { updateDraftCommand } from "../../lib/server/setup-commands";
import {
  draftRevision,
  hostCommandDeps,
  prepareReviewableHost,
  type SeededHost,
  seedHost,
  setupDependencies,
} from "./support/setup-host";

// The setup tools' fence, replay and value idempotence (task 3.1), calling the
// tool entry points with the principal appAuth gives a host setup session.

const db = testDatabase();
let google: FakeGoogle;
let deps: ReturnType<typeof setupDependencies>;

beforeAll(async () => {
  google = await startFakeGoogle();
  deps = setupDependencies(db, google);
});

afterAll(async () => {
  await google.close();
  await db.end();
});

function call(host: SeededHost, overrides: Partial<SetupToolCall> = {}): SetupToolCall {
  return {
    auth: {
      attributes: { audience: "host_setup", discussionId: host.discussionId, generation: "1" },
      principalId: host.hostAccountId,
      principalType: "user",
    },
    callId: `call_${randomUUID()}`,
    sessionId: host.sessionId,
    ...overrides,
  };
}

async function commandOutcomes(hostAccountId: string) {
  const [row] = await db<{ count: number }[]>`
    select count(*)::int as count from app.command_outcomes
    where actor = ${`host_account:${hostAccountId}`} and operation = 'setup.draft_settings'
  `;
  return row!.count;
}

describe("setup tool fence", () => {
  it("reads the current generation's own setup state", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });

    expect(await readSetupStateForTool(deps, call(host))).toMatchObject({ draftRevision: 0, nextAction: "connect_calendar", ready: false });
  });

  it("denies a retired generation, a suspended host and another audience before reading", async () => {
    const retired = await seedHost(db, deps, google, { calendar: false });
    const successor = `session-${randomUUID()}`;
    await db`update app.agent_sessions set state = 'retired' where session_id = ${retired.sessionId}`;
    await db`
      insert into app.agent_sessions
        (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version)
      values (${successor}, ${sessionIdHash(successor)}, ${retired.discussionId}, 'host_account', ${retired.hostAccountId}, 2, 'test')
    `;
    const suspended = await seedHost(db, deps, google, { calendar: false });
    await db`update app.host_accounts set status = 'suspended' where id = ${suspended.hostAccountId}`;
    const other = await seedHost(db, deps, google, { calendar: false });
    const input = { expectedRevision: 0, values: { durationMinutes: { source: "stated" as const, value: 45 } } };

    for (const denied of [
      call(retired),
      call(suspended),
      // Another host's session, and a session principal of another audience.
      call(retired, { sessionId: other.sessionId }),
      call(other, { auth: { attributes: { audience: "requester" }, principalId: other.hostAccountId, principalType: "user" } }),
    ]) {
      await expect(readSetupStateForTool(deps, denied)).rejects.toBeInstanceOf(SetupToolDeniedError);
      await expect(draftSettingsForTool(deps, denied, input)).rejects.toBeInstanceOf(SetupToolDeniedError);
    }

    for (const host of [retired, suspended, other]) {
      expect(await draftRevision(db, host.hostAccountId)).toBe(0);
    }
    // The successor generation is the current one.
    expect(await readSetupStateForTool(deps, call(retired, { sessionId: successor }))).toMatchObject({ draftRevision: 0 });
  });
});

describe("draft_settings", () => {
  it("replays a call with the same call ID without a second write", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });
    const replayed = call(host);
    const input = { expectedRevision: 0, values: { durationMinutes: { source: "stated" as const, value: 45 } } };

    const first = await draftSettingsForTool(deps, replayed, input);
    const again = await draftSettingsForTool(deps, replayed, input);

    expect(first).toMatchObject({ changed: true, revision: 1, saved: true });
    expect(again).toMatchObject({ changed: true, revision: 1, saved: true });
    expect(await draftRevision(db, host.hostAccountId)).toBe(1);
    expect(await commandOutcomes(host.hostAccountId)).toBe(1);
  });

  it("replays the saved outcome after the host accepted the drafted value on its card", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });
    const replayed = call(host);
    const input = { expectedRevision: 0, values: { durationMinutes: { source: "inferred" as const, value: 45 } } };

    const first = await draftSettingsForTool(deps, replayed, input);
    const accepted = await runCommand(hostCommandDeps(db, host.hostAccountId), updateDraftCommand, {
      expectedRevision: 1,
      input: { action: "use_suggestion", field: "durationMinutes", shown: 45 },
      resourceId: host.hostAccountId,
      retryKey: randomUUID(),
    });
    // The step is replayed after recovery: the draft now holds the host's answer.
    const again = await draftSettingsForTool(deps, replayed, input);
    const fresh = await draftSettingsForTool(deps, call(host), {
      expectedRevision: 2,
      values: { durationMinutes: { source: "inferred", value: 30 } },
    });

    expect(first).toMatchObject({ changed: true, revision: 1, saved: true });
    expect(accepted).toMatchObject({ ok: true, result: { revision: 2 } });
    expect(again).toMatchObject({ changed: true, revision: 1, saved: true });
    // A new call still cannot replace the host's answer, and says why.
    expect(fresh).toMatchObject({ error: "invalid_input", problems: { durationMinutes: expect.any(String) }, saved: false });
    expect(await draftRevision(db, host.hostAccountId)).toBe(2);
  });

  it("does not advance the revision for identical values under a new call ID", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });
    const input = { expectedRevision: 0, values: { durationMinutes: { source: "stated" as const, value: 45 } } };

    await draftSettingsForTool(deps, call(host), input);
    // After recovery the model repeats the call, even with its old revision.
    const repeated = await draftSettingsForTool(deps, call(host), input);

    expect(repeated).toMatchObject({ changed: false, revision: 1, saved: true });
    expect(await draftRevision(db, host.hostAccountId)).toBe(1);
  });

  it("writes values unaccepted and labeled, and rejects a stale revision", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });

    const drafted = await draftSettingsForTool(deps, call(host), {
      expectedRevision: 0,
      values: {
        durationMinutes: { source: "inferred", value: 60 },
        meetingMode: { source: "stated", value: "online" },
      },
    });
    const stale = await draftSettingsForTool(deps, call(host), {
      expectedRevision: 0,
      values: { bufferAfterMinutes: { source: "stated", value: 5 } },
    });

    expect(drafted).toMatchObject({ saved: true, revision: 1 });
    if (!drafted.saved) throw new Error("Not saved.");
    expect(drafted.state.fields.durationMinutes.draft).toEqual({ accepted: false, source: "inferred", value: 60 });
    expect(drafted.state.fields.meetingMode.draft).toEqual({ accepted: false, source: "stated", value: "online" });
    // A stated mode is shown on its card as "You said" and counts only once the host accepts it there.
    expect(drafted.state.missingFields).toContain("meetingMode");
    expect(stale).toMatchObject({ error: "stale_revision", saved: false });
  });

  it("cannot answer mode, location or transport without source stated, or replace the host's answer", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });
    await draftSettingsForTool(deps, call(host), {
      expectedRevision: 0,
      values: { durationMinutes: { source: "stated", value: 45 } },
    });

    const inferred = await draftSettingsForTool(deps, call(host), {
      expectedRevision: 1,
      values: {
        location: { source: "inferred", value: { kind: "decide_per_meeting" } },
        meetingMode: { source: "inferred", value: "in_person" },
      },
    });
    const overwrite = await draftSettingsForTool(deps, call(host), {
      expectedRevision: 1,
      values: { durationMinutes: { source: "inferred", value: 30 } },
    });

    expect(inferred).toMatchObject({ error: "invalid_input", problems: { location: expect.any(String), meetingMode: expect.any(String) }, saved: false });
    expect(overwrite).toMatchObject({ error: "invalid_input", problems: { durationMinutes: expect.any(String) }, saved: false });
    expect(await draftRevision(db, host.hostAccountId)).toBe(1);
  });

  it("returns links only once the host is ready", async () => {
    const host = await seedHost(db, deps, google);
    await prepareReviewableHost(db, host);

    const state = await readSetupStateForTool(deps, call(host));

    expect(state).toMatchObject({ links: null, nextAction: "confirm_settings", ready: false });
    expect(JSON.stringify(state)).not.toContain(host.email);
    expect(JSON.stringify(state)).not.toContain(host.primaryId);
  });
});

describe("appAuth host setup audience", () => {
  const signingKey = "a-setup-signing-key-of-at-least-32-characters";
  const appAuth = createAppAuth(() => ({ auth: localAuthConfig(), db, signingKey }));
  const create = (discussionId: string, hostAccountId: string, generation = 2) =>
    appAuth(
      new Request("http://127.0.0.1/eve/v1/session", {
        headers: {
          authorization: `Bearer ${signInternalBearer(
            { discussionId, generation, kind: "create", principal: { id: hostAccountId, type: "host_account" } },
            signingKey,
          )}`,
        },
        method: "POST",
      }),
    );

  it("gives the host's setup discussion the host setup audience", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });

    await expect(create(host.discussionId, host.hostAccountId)).resolves.toMatchObject({
      attributes: { audience: "host_setup", discussionId: host.discussionId, generation: "2" },
      principalId: host.hostAccountId,
    });
  });

  it("refuses a discussion that is missing or another host's", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });
    const other = await seedHost(db, deps, google, { calendar: false });

    await expect(create(randomUUID(), host.hostAccountId, 1)).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(create(other.discussionId, host.hostAccountId, 1)).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});

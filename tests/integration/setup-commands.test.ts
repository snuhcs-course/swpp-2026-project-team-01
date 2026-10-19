import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "../../lib/server/commands";
import { readSetupState } from "../../lib/server/setup";
import { updateDraftCommand } from "../../lib/server/setup-commands";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { draftRevision, hostCommandDeps, seedHost, setupDependencies } from "./support/setup-host";

// setup.update_draft through the command pipeline (task 3.2): revisions, retries,
// Use this copying the current suggestion, and handle checks.

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

async function draftFields(hostAccountId: string) {
  const [row] = await db<{ fields: Record<string, unknown> }[]>`
    select fields from app.setup_drafts where host_account_id = ${hostAccountId}
  `;
  return row?.fields ?? {};
}

describe("setup.update_draft", () => {
  it("creates the draft on first write, rejects a stale revision and replays an exact retry", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });
    const commandDeps = hostCommandDeps(db, host.hostAccountId);
    const request = {
      expectedRevision: 0,
      input: { action: "adjust", field: "durationMinutes", value: 45 },
      resourceId: host.hostAccountId,
      retryKey: randomUUID(),
    };

    const first = await runCommand(commandDeps, updateDraftCommand, request);
    const retry = await runCommand(commandDeps, updateDraftCommand, request);
    const stale = await runCommand(commandDeps, updateDraftCommand, {
      ...request,
      input: { action: "adjust", field: "durationMinutes", value: 60 },
      retryKey: randomUUID(),
    });

    expect(first).toMatchObject({ ok: true, replayed: false, result: { revision: 1 } });
    expect(retry).toMatchObject({ ok: true, replayed: true, result: { revision: 1 } });
    expect(stale).toMatchObject({ error: { category: "stale_revision" }, ok: false });
    expect(await draftRevision(db, host.hostAccountId)).toBe(1);
    expect(await draftFields(host.hostAccountId)).toEqual({ durationMinutes: { accepted: true, source: "stated", value: 45 } });
  });

  it("copies the current suggestion with its label for Use this", async () => {
    const host = await seedHost(db, deps, google, { calendar: false, displayName: "Alice Kim" });
    const before = await readSetupState(deps, host.hostAccountId, { browserTimeZone: "Asia/Seoul" });

    const used = await runCommand(hostCommandDeps(db, host.hostAccountId), updateDraftCommand, {
      expectedRevision: 0,
      input: { action: "use_suggestion", browserTimeZone: "Asia/Seoul", field: "timezone" },
      resourceId: host.hostAccountId,
      retryKey: randomUUID(),
    });
    const mode = await runCommand(hostCommandDeps(db, host.hostAccountId), updateDraftCommand, {
      expectedRevision: 1,
      input: { action: "use_suggestion", field: "meetingMode" },
      resourceId: host.hostAccountId,
      retryKey: randomUUID(),
    });

    expect(used).toMatchObject({ ok: true, result: { revision: 1 } });
    expect((await draftFields(host.hostAccountId)).timezone).toEqual({
      accepted: true,
      reason: before!.fields.timezone.suggestion!.reason,
      sampleSize: null,
      source: "starter_default",
      value: "Asia/Seoul",
    });
    // Mode has no suggestion to accept: only the host answers it.
    expect(mode).toMatchObject({ error: { category: "invalid_input" }, ok: false });
  });

  it("keeps the previous handle when the drafted one is another host's or invalid", async () => {
    const other = await seedHost(db, deps, google, { calendar: false });
    await db`insert into app.host_handles (handle, host_account_id) values (${other.local}, ${other.hostAccountId})`;
    const host = await seedHost(db, deps, google, { calendar: false });
    const draft = (value: string, expectedRevision: number) =>
      runCommand(hostCommandDeps(db, host.hostAccountId), updateDraftCommand, {
        expectedRevision,
        input: { action: "choose_own", field: "handle", value },
        resourceId: host.hostAccountId,
        retryKey: randomUUID(),
      });

    expect(await draft(`${host.local}-x`, 0)).toMatchObject({ ok: true, result: { revision: 1 } });
    expect(await draft(other.local, 1)).toMatchObject({ error: { category: "invalid_input" }, ok: false });
    expect(await draft("admin", 1)).toMatchObject({ error: { category: "invalid_input" }, ok: false });
    expect((await draftFields(host.hostAccountId)).handle).toMatchObject({ value: `${host.local}-x` });
  });

  it("changes nothing for a suspended host", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });
    await db`update app.host_accounts set status = 'suspended' where id = ${host.hostAccountId}`;

    const outcome = await runCommand(hostCommandDeps(db, host.hostAccountId), updateDraftCommand, {
      expectedRevision: 0,
      input: { action: "adjust", field: "durationMinutes", value: 45 },
      resourceId: host.hostAccountId,
      retryKey: randomUUID(),
    });

    expect(outcome).toMatchObject({ error: { category: "forbidden" }, ok: false });
    expect(await draftRevision(db, host.hostAccountId)).toBe(0);
  });
});

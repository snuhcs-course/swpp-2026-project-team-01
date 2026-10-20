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
    expect(await draftFields(host.hostAccountId)).toEqual({
      durationMinutes: { accepted: true, acceptedAt: expect.any(String), source: "stated", value: 45 },
    });
  });

  const use = (hostAccountId: string, expectedRevision: number, field: string, shown: unknown) =>
    runCommand(hostCommandDeps(db, hostAccountId), updateDraftCommand, {
      expectedRevision,
      input: { action: "use_suggestion", field, shown },
      resourceId: hostAccountId,
      retryKey: randomUUID(),
    });

  it("accepts the shown proposed value with its label for Use this", async () => {
    const host = await seedHost(db, deps, google, { calendar: false, displayName: "Alice Kim" });
    const before = await readSetupState(deps, host.hostAccountId, { browserTimeZone: "Asia/Seoul" });

    const used = await use(host.hostAccountId, before!.draft.revision, "timezone", "Asia/Seoul");
    const mode = await use(host.hostAccountId, before!.draft.revision + 1, "meetingMode", "online");

    expect(used).toMatchObject({ ok: true, result: { revision: before!.draft.revision + 1 } });
    expect((await draftFields(host.hostAccountId)).timezone).toEqual({
      accepted: true,
      acceptedAt: expect.any(String),
      reason: before!.fields.timezone.proposed!.reason,
      sampleSize: null,
      source: "starter_default",
      value: "Asia/Seoul",
    });
    // Mode has no proposed value to accept: only the host answers it.
    expect(mode).toMatchObject({ error: { category: "invalid_input" }, ok: false });
  });

  it("refuses Use this as stale when the proposed value is no longer the one shown", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });

    const stale = await use(host.hostAccountId, 0, "durationMinutes", 45);

    expect(stale).toMatchObject({ error: { category: "stale_revision" }, ok: false });
    expect(await draftRevision(db, host.hostAccountId)).toBe(0);
    expect(await use(host.hostAccountId, 0, "durationMinutes", 30)).toMatchObject({ ok: true, result: { revision: 1 } });
  });

  it("accepts a stated draft shown as \"You said\", which then counts as the host's answer", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });
    await db`
      insert into app.setup_drafts (host_account_id, fields)
      values (${host.hostAccountId}, ${db.json({ meetingMode: { accepted: false, source: "stated", value: "online" } })})
    `;
    expect((await readSetupState(deps, host.hostAccountId))!.missingFields).toContain("meetingMode");

    expect(await use(host.hostAccountId, 1, "meetingMode", "online")).toMatchObject({ ok: true, result: { revision: 2 } });

    expect((await draftFields(host.hostAccountId)).meetingMode).toEqual({
      accepted: true,
      acceptedAt: expect.any(String),
      reason: null,
      sampleSize: null,
      source: "stated",
      value: "online",
    });
    expect((await readSetupState(deps, host.hostAccountId))!.missingFields).not.toContain("meetingMode");
  });

  it("needs no request zone for Use this: without a stored browser zone it accepts the labeled UTC fallback", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });
    const state = await readSetupState(deps, host.hostAccountId);

    expect(state!.fields.timezone.proposed).toMatchObject({ source: "starter_default", value: "UTC" });
    expect(await use(host.hostAccountId, 0, "timezone", "UTC")).toMatchObject({ ok: true, result: { revision: 1 } });
    expect((await draftFields(host.hostAccountId)).timezone).toMatchObject({ accepted: true, value: "UTC" });
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

  it("stamps each answer with its time and keeps a changed answer's predecessors for the receipts", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });
    const answer = (value: number, expectedRevision: number) =>
      runCommand(hostCommandDeps(db, host.hostAccountId), updateDraftCommand, {
        expectedRevision,
        input: { action: "adjust", field: "durationMinutes", value },
        resourceId: host.hostAccountId,
        retryKey: randomUUID(),
      });
    const started = Date.now();

    expect(await answer(30, 0)).toMatchObject({ ok: true });
    const first = (await draftFields(host.hostAccountId)).durationMinutes as { acceptedAt: string };
    // Edit, then save a new value: the earlier answer moves to the history.
    expect(await answer(45, 1)).toMatchObject({ ok: true });
    // Saving the same value again is no new answer.
    expect(await answer(45, 2)).toMatchObject({ ok: true });

    const entry = (await draftFields(host.hostAccountId)).durationMinutes as Record<string, unknown>;
    expect(Date.parse(first.acceptedAt)).toBeGreaterThanOrEqual(started - 1_000);
    expect(entry).toMatchObject({
      accepted: true,
      history: [{ acceptedAt: first.acceptedAt, source: "stated", value: 30 }],
      value: 45,
    });
    expect(Date.parse(entry.acceptedAt as string)).toBeGreaterThanOrEqual(Date.parse(first.acceptedAt));

    // The state read exposes both, and the proposal still depends only on the value.
    const state = await readSetupState(deps, host.hostAccountId);
    expect(state!.fields.durationMinutes.draft).toMatchObject({ acceptedAt: entry.acceptedAt, history: entry.history });
  });

  it("keeps at most five earlier answers", async () => {
    const host = await seedHost(db, deps, google, { calendar: false });

    for (let index = 0; index < 8; index += 1) {
      const outcome = await runCommand(hostCommandDeps(db, host.hostAccountId), updateDraftCommand, {
        expectedRevision: index,
        input: { action: "adjust", field: "durationMinutes", value: 30 + index * 5 },
        resourceId: host.hostAccountId,
        retryKey: randomUUID(),
      });
      expect(outcome).toMatchObject({ ok: true });
    }

    const entry = (await draftFields(host.hostAccountId)).durationMinutes as { history: { value: number }[]; value: number };
    expect(entry.value).toBe(65);
    expect(entry.history.map((earlier) => earlier.value)).toEqual([40, 45, 50, 55, 60]);
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

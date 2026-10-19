import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "../../lib/server/commands";
import { readHostStanding } from "../../lib/server/host-eligibility";
import { findReadyHostByHandle } from "../../lib/server/readiness";
import { readSetupState } from "../../lib/server/setup";
import { confirmSettingsCommand, updateDraftCommand } from "../../lib/server/setup-commands";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import {
  draftRevision,
  hostCommandDeps,
  prepareReviewableHost,
  type SeededHost,
  seedHost,
  SETUP_ORIGIN,
  setupDependencies,
} from "./support/setup-host";

// Confirm and save proposed settings (design decision 12, task 3.4): the
// transactional recheck and readiness.

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

type Live = Awaited<ReturnType<typeof prepareReviewableHost>>;

async function confirm(host: SeededHost, live: Live, review?: { revision: number; hash: string }) {
  const state = await readSetupState(deps, host.hostAccountId);
  return runCommand(hostCommandDeps(db, host.hostAccountId), confirmSettingsCommand(live, SETUP_ORIGIN), {
    expectedRevision: review?.revision ?? state!.draft.revision,
    input: { proposalHash: review?.hash ?? state!.proposalHash },
    resourceId: host.hostAccountId,
    retryKey: randomUUID(),
  });
}

async function settingsOf(hostAccountId: string) {
  const [row] = await db<{ settings: Record<string, unknown>; revision: number }[]>`
    select settings, revision from app.host_settings where host_account_id = ${hostAccountId}
  `;
  return row ?? null;
}

async function adjust(host: SeededHost, field: string, value: unknown) {
  return runCommand(hostCommandDeps(db, host.hostAccountId), updateDraftCommand, {
    expectedRevision: await draftRevision(db, host.hostAccountId),
    input: { action: "adjust", field, value },
    resourceId: host.hostAccountId,
    retryKey: randomUUID(),
  });
}

describe("setup.confirm_settings", () => {
  it("makes the host ready with its links on the configured origin", async () => {
    const host = await seedHost(db, deps, google, { displayName: "Alice Kim" });
    const live = await prepareReviewableHost(db, host);

    const outcome = await confirm(host, live);
    const links = { booking: `${SETUP_ORIGIN}/${host.local}`, skill: `${SETUP_ORIGIN}/${host.local}/SKILL.md` };

    expect(outcome).toMatchObject({ ok: true, result: { handle: host.local, links } });
    expect(await readHostStanding(db, host.userId)).toMatchObject({ eligible: true, nextAction: null, ready: true });
    expect(await findReadyHostByHandle(db, host.local)).toEqual({
      displayName: "Alice Kim",
      handle: host.local,
      hostAccountId: host.hostAccountId,
    });
    expect((await settingsOf(host.hostAccountId))!.settings).toMatchObject({
      bookingCalendar: { accessRole: "owner", id: host.primaryId, verifiedAt: expect.any(String) },
      conflictCalendars: [{ id: host.primaryId }],
      location: null,
      meetingMode: "online",
      provenance: { durationMinutes: "starter_default", meetingMode: "stated" },
      travelMode: null,
    });
    expect(await readSetupState(deps, host.hostAccountId)).toMatchObject({ links, nextAction: "ready", pendingChanges: false });
  });

  it("keeps a ready host public on the confirmed policy while the draft changes", async () => {
    const host = await seedHost(db, deps, google);
    const live = await prepareReviewableHost(db, host);
    expect(await confirm(host, live)).toMatchObject({ ok: true });

    expect(await adjust(host, "durationMinutes", 60)).toMatchObject({ ok: true });

    expect(await readHostStanding(db, host.userId)).toMatchObject({ ready: true });
    expect((await settingsOf(host.hostAccountId))!.settings).toMatchObject({ durationMinutes: 30 });
    expect(await readSetupState(deps, host.hostAccountId)).toMatchObject({ nextAction: "ready", pendingChanges: true });
  });

  it("rejects a stale review by revision or by proposal, saving nothing", async () => {
    const host = await seedHost(db, deps, google);
    const live = await prepareReviewableHost(db, host);
    const review = await readSetupState(deps, host.hostAccountId);

    await adjust(host, "bufferAfterMinutes", 5);
    const byRevision = await confirm(host, live, { hash: review!.proposalHash, revision: review!.draft.revision });
    const current = await readSetupState(deps, host.hostAccountId);
    const byProposal = await confirm(host, live, { hash: review!.proposalHash, revision: current!.draft.revision });

    expect(byRevision).toMatchObject({ error: { category: "stale_revision" }, ok: false });
    expect(byProposal).toMatchObject({ error: { category: "stale_revision" }, ok: false });
    expect(await settingsOf(host.hostAccountId)).toBeNull();
    expect(await readHostStanding(db, host.userId)).toMatchObject({ ready: false });
  });

  it("rejects a destination that became read-only", async () => {
    const host = await seedHost(db, deps, google);
    const live = await prepareReviewableHost(db, host);
    const readOnly = live.map((calendar) => (calendar.id === host.primaryId ? { ...calendar, accessRole: "reader" } : calendar));

    expect(await confirm(host, readOnly)).toMatchObject({ error: { category: "invalid_input" }, ok: false });
    expect(await confirm(host, live.filter((calendar) => calendar.id !== host.primaryId))).toMatchObject({
      error: { category: "invalid_input" },
      ok: false,
    });
    expect(await settingsOf(host.hostAccountId)).toBeNull();
  });

  it("rejects a handle another host took after it was drafted, changing neither host", async () => {
    const host = await seedHost(db, deps, google);
    const live = await prepareReviewableHost(db, host);
    const handle = `${host.local}-mine`;
    expect(await adjust(host, "handle", handle)).toMatchObject({ ok: true });
    const review = await readSetupState(deps, host.hostAccountId);
    const other = await seedHost(db, deps, google, { calendar: false });
    await db`insert into app.host_handles (handle, host_account_id) values (${handle}, ${other.hostAccountId})`;

    const outcome = await confirm(host, live, { hash: review!.proposalHash, revision: review!.draft.revision });
    const handles = await db<{ handle: string; host_account_id: string }[]>`
      select handle, host_account_id from app.host_handles where host_account_id in (${host.hostAccountId}, ${other.hostAccountId})
    `;

    expect(outcome).toMatchObject({ error: { category: "invalid_input" }, ok: false });
    expect(handles).toEqual([{ handle, host_account_id: other.hostAccountId }]);
    expect(await settingsOf(host.hostAccountId)).toBeNull();
  });

  it("rejects a suspended account", async () => {
    const host = await seedHost(db, deps, google);
    const live = await prepareReviewableHost(db, host);
    const review = await readSetupState(deps, host.hostAccountId);
    await db`update app.host_accounts set status = 'suspended' where id = ${host.hostAccountId}`;

    const outcome = await confirm(host, live, { hash: review!.proposalHash, revision: review!.draft.revision });

    expect(outcome).toMatchObject({ error: { category: "forbidden" }, ok: false });
    expect(await settingsOf(host.hostAccountId)).toBeNull();
    expect(await db`select 1 from app.host_handles where host_account_id = ${host.hostAccountId}`).toHaveLength(0);
  });
});

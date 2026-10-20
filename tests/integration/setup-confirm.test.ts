import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordDestinationAccess, saveCalendarRolesCommand } from "../../lib/server/calendar-roles";
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

  it("exposes the confirmation and roles times for the receipts, and leaves the roles' save time to the host's saves", async () => {
    const host = await seedHost(db, deps, google);
    const live = await prepareReviewableHost(db, host);
    const before = await readSetupState(deps, host.hostAccountId);
    expect(before!.confirmedAt).toBeNull();
    expect(before!.roles!.savedAt).toEqual(expect.any(String));

    expect(await confirm(host, live)).toMatchObject({ ok: true });

    const after = await readSetupState(deps, host.hostAccountId);
    expect(Date.parse(after!.confirmedAt!)).toBeGreaterThanOrEqual(Date.parse(before!.roles!.savedAt));
    // Verifying the destination at confirmation is not a save of the roles.
    expect(after!.roles!.savedAt).toBe(before!.roles!.savedAt);
    expect(Date.parse(after!.roles!.destinationVerifiedAt)).toBeGreaterThan(Date.parse(before!.roles!.destinationVerifiedAt));
  });

  it("reviews the same proposal after an answer is changed back, whatever its answer history", async () => {
    const host = await seedHost(db, deps, google);
    const live = await prepareReviewableHost(db, host);
    expect(await adjust(host, "durationMinutes", 30)).toMatchObject({ ok: true });
    const review = await readSetupState(deps, host.hostAccountId);

    expect(await adjust(host, "durationMinutes", 45)).toMatchObject({ ok: true });
    expect(await adjust(host, "durationMinutes", 30)).toMatchObject({ ok: true });

    const state = await readSetupState(deps, host.hostAccountId);
    expect(state!.fields.durationMinutes.draft!.history).toHaveLength(2);
    expect(state!.draft.revision).toBeGreaterThan(review!.draft.revision);
    expect(state!.proposalHash).toBe(review!.proposalHash);
    expect(await confirm(host, live)).toMatchObject({ ok: true });
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

  it("rejects a destination that became read-only with its own reason, and setup then asks for a writable one", async () => {
    const host = await seedHost(db, deps, google);
    const live = await prepareReviewableHost(db, host);
    const readOnly = live.map((calendar) => (calendar.id === host.primaryId ? { ...calendar, accessRole: "reader" } : calendar));
    const lost = { error: { category: "invalid_input", reason: "destination_not_writable" }, ok: false };

    expect(await confirm(host, readOnly)).toMatchObject(lost);
    expect(await confirm(host, live.filter((calendar) => calendar.id !== host.primaryId))).toMatchObject(lost);
    expect(await settingsOf(host.hostAccountId)).toBeNull();

    await recordDestinationAccess(db, host.hostAccountId, readOnly);
    const state = await readSetupState(deps, host.hostAccountId);

    expect(state).toMatchObject({ calendar: { destinationLost: true }, nextAction: "choose_calendars" });
    expect(state!.roles?.bookingCalendar.accessRole).toBe("reader");
  });

  it("keeps a ready host public on the confirmed destination after saving new roles, and shows the change as pending", async () => {
    const side = { accessRole: "owner", id: `side-${randomUUID()}@group.calendar.google.com`, summary: "Side" };
    const host = await seedHost(db, deps, google);
    const live = await prepareReviewableHost(db, host);
    expect(await confirm(host, live)).toMatchObject({ ok: true });
    const withSide = [...live, { ...side, timeZone: null }];
    const revision = await draftRevision(db, host.hostAccountId);

    const saved = await runCommand(hostCommandDeps(db, host.hostAccountId), saveCalendarRolesCommand(withSide), {
      expectedRevision: 1,
      input: { bookingCalendarId: side.id, conflictCalendarIds: [host.primaryId, side.id] },
      resourceId: host.hostAccountId,
      retryKey: randomUUID(),
    });
    const state = await readSetupState(deps, host.hostAccountId);

    expect(saved).toMatchObject({ ok: true, result: { revision: 2 } });
    expect(state).toMatchObject({ nextAction: "ready", pendingChanges: true, readiness: { ready: true } });
    expect(state!.roles?.bookingCalendar.id).toBe(side.id);
    expect((await settingsOf(host.hostAccountId))!.settings).toMatchObject({ bookingCalendar: { id: host.primaryId } });
    expect(await draftRevision(db, host.hostAccountId)).toBe(revision);
  });

  it("serializes a roles save and a confirmation without deadlock: confirm sees the old roles or is stale", async () => {
    for (let round = 0; round < 5; round += 1) {
      const host = await seedHost(db, deps, google);
      const live = await prepareReviewableHost(db, host);
      const review = await readSetupState(deps, host.hostAccountId);
      const team = host.calendars.find((calendar) => !calendar.primary)!;

      const [saved, confirmed] = await Promise.all([
        runCommand(hostCommandDeps(db, host.hostAccountId), saveCalendarRolesCommand(live), {
          expectedRevision: 1,
          input: { bookingCalendarId: host.primaryId, conflictCalendarIds: [host.primaryId, team.id] },
          resourceId: host.hostAccountId,
          retryKey: randomUUID(),
        }),
        confirm(host, live, { hash: review!.proposalHash, revision: review!.draft.revision }),
      ]);

      expect(saved).toMatchObject({ ok: true });
      if (confirmed.ok) {
        // Confirmed before the save: the policy holds the reviewed roles.
        expect((await settingsOf(host.hostAccountId))!.settings).toMatchObject({ conflictCalendars: [{ id: host.primaryId }] });
      } else {
        expect(confirmed.error.category).toBe("stale_revision");
        expect(await settingsOf(host.hostAccountId)).toBeNull();
      }
    }
  });

  it("confirms without any browser zone in the request, saving the labeled UTC fallback", async () => {
    const host = await seedHost(db, deps, google);
    const live = await prepareReviewableHost(db, host);

    expect(await confirm(host, live)).toMatchObject({ ok: true });
    expect((await settingsOf(host.hostAccountId))!.settings).toMatchObject({
      provenance: { timezone: "starter_default" },
      timezone: "UTC",
    });
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

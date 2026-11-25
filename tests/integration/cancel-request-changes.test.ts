import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { approveCommand } from "../../lib/server/bookings";
import { changeBookingCommand } from "../../lib/server/booking-cancellation";
import { type CommandDefinition, runCommand } from "../../lib/server/commands";
import { createDatabase, type Database } from "../../lib/server/database";
import { listHostRequests } from "../../lib/server/host-requests";
import { enqueueHostNotice } from "../../lib/server/imessage-notices";
import { readChangeBaseline } from "../../lib/server/request-change-baseline";
import { cancelChangesCommand } from "../../lib/server/request-changes";
import { changeAgreementCommand } from "../../lib/server/request-proposals";
import { LOCAL_DATABASE_URL, testDatabase } from "./support/database";

// Exercise real SQL, constraints, transactions, lifecycle cleanup and host list
// projection in a unique disposable database. Only notification transport is
// stubbed; no test depends on Google, messaging credentials or Supabase Auth.
vi.mock("../../lib/server/imessage-notices", async (original) => ({
  ...await original<typeof import("../../lib/server/imessage-notices")>(),
  enqueueButtonRetirement: vi.fn(), enqueueHostNotice: vi.fn(),
}));

const admin = testDatabase();
const databaseName = `cancel_changes_${randomUUID().replaceAll("-", "")}`;
let db: Database;
let created = false;

beforeAll(async () => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Local test database required");
  await admin.unsafe(`create database "${databaseName}"`);
  created = true;
  url.pathname = `/${databaseName}`;
  db = createDatabase(url.toString());
  await db`create schema app`;
  for (const table of ["host_accounts", "host_settings", "jobs", "requests", "booking_links", "evaluations", "proposals", "agreements", "command_outcomes", "shared_change_drafts", "approvals", "bookings", "request_reviews", "requester_host_profiles", "requester_grants", "email_deliveries", "contact_confirmations"]) {
    await db.unsafe(await readFile(new URL(`../../supabase/schemas/app/tables/${table}.sql`, import.meta.url), "utf8"));
  }
});

afterAll(async () => {
  await db?.end();
  if (created) await admin.unsafe(`drop database "${databaseName}"`);
  await admin.end();
});
beforeEach(() => vi.clearAllMocks());

function command<Input, Result>(requestId: string, definition: CommandDefinition<Input, Result>, revision: number, retryKey = randomUUID(), actorId = requestId) {
  return runCommand({ db, authenticate: async () => ({ id: actorId, kind: "requester_request" as const }) }, definition, {
    expectedRevision: revision, input: {}, resourceId: requestId, retryKey,
  });
}

async function seed(booked = false, past = false) {
  const [host] = await db<{ id: string }[]>`insert into app.host_accounts default values returning id`;
  const start = new Date(Date.now() + (past ? -1 : 1) * 86_400_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  const details = { purpose: "Coffee chat", durationMinutes: 30, mode: "online", location: null, linkPlan: { kind: "google_meet" }, timezone: "Asia/Seoul", language: "en", travelMode: "transit", windows: [] };
  const [request] = await db<{ id: string }[]>`
    insert into app.requests (host_account_id, state, revision, details, requester_name, contact_email, expires_at, closed_at)
    values (${host!.id}, ${booked ? "booked" : "awaiting_host_approval"}, 2, ${db.json(details)}, 'Alex', 'alex@example.com',
            now() + interval '6 days', ${booked ? new Date() : null}) returning id
  `;
  const id = request!.id;
  await db`insert into app.booking_links (request_id, link_hash, link_ciphertext, link_key_id) values (${id}, ${randomUUID()}, 'test-only', 'test')`;
  const [evaluation] = await db<{ id: string }[]>`
    insert into app.evaluations (request_id, request_revision, settings_revision, state, completed_at)
    values (${id}, 1, 1, 'completed', now()) returning id
  `;
  const proposal = { start: start.toISOString(), end: end.toISOString(), displayTimezones: ["Asia/Seoul"], durationMinutes: 30, participants: [], mode: "online", location: null, linkPlan: { kind: "google_meet" } };
  const [p] = await db<{ id: string }[]>`
    insert into app.proposals (request_id, version, evaluation_id, candidate_id, start_at, end_at, details)
    values (${id}, 1, ${evaluation!.id}, 'candidate', ${start}, ${end}, ${db.json(proposal)}) returning id
  `;
  await db`insert into app.agreements (proposal_id, request_revision, retry_key) values (${p!.id}, 1, ${randomUUID()})`;
  let bookingId: string | null = null;
  if (booked) {
    const [approval] = await db<{ id: string }[]>`
      insert into app.approvals (request_id, proposal_id, host_account_id, request_revision, retry_key)
      values (${id}, ${p!.id}, ${host!.id}, 2, ${randomUUID()}) returning id
    `;
    const [b] = await db<{ id: string }[]>`
      insert into app.bookings (request_id, proposal_id, approval_id, host_account_id, calendar_id, event_id, start_at, end_at,
          reserved_start, reserved_end, state, payload, dispatched_at, confirmed_at)
      values (${id}, ${p!.id}, ${approval!.id}, ${host!.id}, 'calendar', ${randomUUID().replaceAll("-", "")}, ${start}, ${end},
          ${start}, ${end}, 'confirmed', '{}'::jsonb, now(), now()) returning id
    `;
    bookingId = b!.id;
  }
  return { id, hostId: host!.id, details, proposalId: p!.id, bookingId };
}

async function row(id: string) {
  const [request] = await db<{ state: string; revision: number; details: Record<string, unknown> }[]>`select state, revision, details from app.requests where id = ${id}`;
  return request!;
}

async function edit(id: string) {
  await db`update app.requests set details = details || '{"purpose":"Changed purpose","durationMinutes":60,"preferredWeeklyWindows":[],"notificationPreference":"email_only","language":"ko"}'::jsonb, revision = revision + 1 where id = ${id}`;
}

describe("cancel meeting changes", () => {
  it("restores original details and Needs your decision instead of Coordinating time", async () => {
    const request = await seed();
    expect((await command(request.id, changeAgreementCommand, 2)).ok).toBe(true);
    await edit(request.id);
    await db`insert into app.request_reviews (request_id, base_revision, intent, patch) values (${request.id}, 4, 'details', '{"purpose":"Unapplied edit"}'::jsonb)`;
    expect((await listHostRequests(db, request.hostId))[0]).toMatchObject({ state: "negotiating", needsDecision: false });
    const result = await command(request.id, cancelChangesCommand, 4);
    expect(result).toMatchObject({ ok: true, result: { state: "awaiting_host_approval", revision: 5, version: 2 } });
    expect((await listHostRequests(db, request.hostId))[0]).toMatchObject({ state: "awaiting_host_approval", needsDecision: true, purpose: "Coffee chat" });
    const restored = await row(request.id);
    expect(restored.details).toMatchObject({ purpose: "Coffee chat", durationMinutes: 30, notificationPreference: "email_only", language: "ko" });
    expect(restored.details).not.toHaveProperty("preferredWeeklyWindows");
    expect(await db`select state from app.request_reviews where request_id = ${request.id}`).toEqual([{ state: "superseded" }]);
    expect(await db`select 1 from app.proposals where request_id = ${request.id}`).toHaveLength(2);
    expect(await db`select 1 from app.agreements a join app.proposals p on p.id = a.proposal_id where p.request_id = ${request.id}`).toHaveLength(2);
    expect(await readChangeBaseline(db, request.id)).toBeNull();
  });

  it("restores an approvable new version even after another proposal was drafted", async () => {
    const request = await seed();
    await command(request.id, changeAgreementCommand, 2);
    await db`
      insert into app.proposals (request_id, version, evaluation_id, candidate_id, start_at, end_at, details)
      select request_id, 2, evaluation_id, candidate_id, start_at, end_at, details from app.proposals where id = ${request.proposalId}
    `;
    expect(await command(request.id, cancelChangesCommand, 3)).toMatchObject({ ok: true, result: { version: 3 } });
    const hostRun = (version: number, expectedRevision: number) => runCommand({ db, authenticate: async () => ({ id: request.hostId, kind: "host_account" as const }) }, approveCommand, {
      expectedRevision, input: { version }, resourceId: request.id, retryKey: randomUUID(),
    });
    expect(await hostRun(1, 2)).toMatchObject({ ok: false, error: { category: "stale_revision" } });
    await db`insert into app.host_settings (host_account_id, draft_revision, settings) values (${request.hostId}, 1, '{"bookingCalendar":{"id":"calendar"}}'::jsonb)`;
    expect(await hostRun(3, 4)).toMatchObject({ ok: true, result: { state: "reserved" } });
    expect((await row(request.id)).state).toBe("booking");
  });

  it("replays a cancellation without cloning twice or notifying twice", async () => {
    const request = await seed();
    await command(request.id, changeAgreementCommand, 2);
    vi.clearAllMocks();
    const key = randomUUID();
    expect(await command(request.id, cancelChangesCommand, 3, key)).toMatchObject({ ok: true, replayed: false });
    expect(await command(request.id, cancelChangesCommand, 3, key)).toMatchObject({ ok: true, replayed: true });
    expect(await db`select 1 from app.proposals where request_id = ${request.id}`).toHaveLength(2);
    expect(enqueueHostNotice).toHaveBeenCalledTimes(1);
  });

  it("rejects another requester, stale revisions and a host decision that won first", async () => {
    const request = await seed();
    await command(request.id, changeAgreementCommand, 2);
    expect(await command(request.id, cancelChangesCommand, 3, randomUUID(), randomUUID())).toMatchObject({ ok: false, error: { category: "forbidden" } });
    expect(await command(request.id, cancelChangesCommand, 2)).toMatchObject({ ok: false, error: { category: "stale_revision" } });
    await db`update app.requests set state = 'booking', revision = revision + 1 where id = ${request.id}`;
    expect(await command(request.id, cancelChangesCommand, 3)).toMatchObject({ ok: false, error: { category: "stale_revision" } });
    expect((await row(request.id)).state).toBe("booking");
  });

  it("rejects an expired original time without altering the editing request", async () => {
    const request = await seed(false, true);
    await command(request.id, changeAgreementCommand, 2);
    expect(await command(request.id, cancelChangesCommand, 3)).toMatchObject({ ok: false, error: { reason: "start_passed" } });
    expect((await row(request.id)).state).toBe("negotiating");
  });

  it("does not undo a newer host-shared change", async () => {
    const request = await seed();
    await command(request.id, changeAgreementCommand, 2);
    await db`insert into app.shared_change_drafts (request_id, source, base_revision, changes, state) values (${request.id}, 'host', 3, '{}'::jsonb, 'checking')`;
    expect(await readChangeBaseline(db, request.id)).toBeNull();
    expect(await command(request.id, cancelChangesCommand, 3)).toMatchObject({ ok: false, error: { category: "stale_revision" } });
  });

  it("keeps the standing booking and restores Booked without changing its event", async () => {
    const request = await seed(true);
    await command(request.id, changeBookingCommand, 2);
    await edit(request.id);
    expect(await command(request.id, cancelChangesCommand, 4)).toMatchObject({ ok: true, result: { state: "booked", revision: 5 } });
    expect(await db`select state, id from app.bookings where request_id = ${request.id}`).toEqual([{ state: "confirmed", id: request.bookingId }]);
    expect((await row(request.id)).details.purpose).toBe("Coffee chat");
    expect(await db`select 1 from app.jobs where kind = 'booking_cancel'`).toHaveLength(0);
  });

  it("does not let a guest discard an edit the host opened", async () => {
    const request = await seed(true);
    const hostChange = await runCommand({ db, authenticate: async () => ({ id: request.hostId, kind: "host_account" as const }) }, changeBookingCommand, {
      expectedRevision: 2, input: {}, resourceId: request.id, retryKey: randomUUID(),
    });
    expect(hostChange.ok).toBe(true);
    await command(request.id, changeBookingCommand, 3);
    expect(await readChangeBaseline(db, request.id)).toBeNull();
    expect(await command(request.id, cancelChangesCommand, 3)).toMatchObject({ ok: false, error: { category: "stale_revision" } });
  });

  it("keeps cancellation available when the host only repeats an already open guest change", async () => {
    const request = await seed(true);
    await command(request.id, changeBookingCommand, 2);
    await runCommand({ db, authenticate: async () => ({ id: request.hostId, kind: "host_account" as const }) }, changeBookingCommand, {
      expectedRevision: 3, input: {}, resourceId: request.id, retryKey: randomUUID(),
    });
    expect(await readChangeBaseline(db, request.id)).not.toBeNull();
    expect(await command(request.id, cancelChangesCommand, 3)).toMatchObject({ ok: true, result: { state: "booked" } });
  });

  it("reconstructs an unchanged legacy opening but refuses one with later details edits", async () => {
    const request = await seed();
    await command(request.id, changeAgreementCommand, 2);
    await db`update app.command_outcomes set result = result - 'restore' where resource_id = ${request.id}`;
    expect(await readChangeBaseline(db, request.id)).not.toBeNull();
    await edit(request.id);
    expect(await readChangeBaseline(db, request.id)).toBeNull();
    expect(await command(request.id, cancelChangesCommand, 4)).toMatchObject({ ok: false, error: { category: "stale_revision" } });
  });
});

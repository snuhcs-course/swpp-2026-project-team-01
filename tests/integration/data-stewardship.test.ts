import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveCommand } from "../../lib/server/bookings";
import { checkHandle } from "../../lib/server/handles";
import { ensureHostAccount } from "../../lib/server/host-accounts";
import { type AdminDependencies, runAdmin } from "../../lib/server/operator";
import { findReadyHostByHandle } from "../../lib/server/readiness";
import { signInHost } from "./support/auth";
import { agreedRequest, asHost, bookingDeps, bookingOf, runBooking } from "./support/booking";
import { LOCAL_DATABASE_URL, testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { makeHostReady, newHostAccount } from "./support/ready-host";
import { closeTestRequest, createTestRequest } from "./support/requests";
import { revisionOf } from "./support/scheduling";

// Retention and deletion on request (data-stewardship; operations-and-release
// design 8 and 9) against the local stack: each retention rule, the open-request
// guard and the per-rule bound, and the operator's host and request deletion
// with the handle tombstone, the Auth user and the refused restoration.

const db = testDatabase();
let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
});

afterAll(async () => {
  await google.close();
  await db.end();
});

function admin() {
  const out: string[] = [];
  const err: string[] = [];
  const deps: AdminDependencies = {
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL },
    interactive: false,
    prompt: async () => "",
    stderr: (line) => err.push(line),
    stdout: (line) => out.push(line),
  };
  return { deps, err, out };
}

async function retention(rowLimit = 1000) {
  const rows = await db<{ deleted: number; rule: string }[]>`select rule, deleted from app.cleanup_retained_records(${rowLimit})`;
  return Object.fromEntries(rows.map((row) => [row.rule, row.deleted]));
}

// A requester discussion with one session, one recorded event, one input and
// one model reservation, as a guest conversation leaves them.
async function conversationFor(requestId: string) {
  const [discussion] = await db<{ id: string }[]>`
    insert into app.discussions (principal_type, principal_id, audience)
    values ('requester_request', ${requestId}, 'requester')
    on conflict on constraint discussions_principal_audience_key do update set created_at = app.discussions.created_at
    returning id
  `;
  const sessionId = `wrun_${randomUUID()}`;
  await db`
    insert into app.agent_sessions (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version, state)
    values (${sessionId}, ${randomUUID().replaceAll("-", "")}, ${discussion!.id}, 'requester_request', ${requestId}, 99, 'test', 'retired')
  `;
  await db`insert into app.agent_session_events (session_id, stream_index, event) values (${sessionId}, 0, '{"type":"message.received"}'::jsonb)`;
  const [input] = await db<{ id: string }[]>`
    insert into app.conversation_inputs (discussion_id, client_input_id, fingerprint, message, session_id, state)
    values (${discussion!.id}, ${randomUUID()}, 'f', 'Can we meet next week?', ${sessionId}, 'completed')
    returning id
  `;
  const [reservation] = await db<{ id: string }[]>`
    insert into app.model_reservations (work_kind, work_id, principal_type, principal_id, session_id, amount_usd, window_start)
    values ('conversation_input', ${input!.id}, 'requester_request', ${requestId}, ${sessionId}, 0.10, now())
    returning id
  `;
  return { discussionId: discussion!.id, inputId: input!.id, reservationId: reservation!.id, sessionId };
}

async function exists(table: string, column: string, value: string) {
  const [row] = await db<{ found: boolean }[]>`select exists (select 1 from ${db(table)} where ${db(column)} = ${value}) as found`;
  return row!.found;
}

describe("retention", () => {
  it("deletes a request 90 days after it closed, with everything under it, and leaves the calendar event", async () => {
    const request = await agreedRequest(db, google);
    const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    if (!approved.ok) throw new Error(`approve failed: ${approved.error.category}`);
    await runBooking(db, bookingDeps(db, google), approved.result.bookingId);
    const booking = await bookingOf(db, approved.result.bookingId);
    expect(booking.state).toBe("confirmed");
    const conversation = await conversationFor(request.requestId);

    await db`update app.requests set closed_at = now() - interval '91 days' where id = ${request.requestId}`;
    const removed = await retention();

    expect(removed.closed_requests).toBeGreaterThanOrEqual(1);
    expect(await exists("app.requests", "id", request.requestId)).toBe(false);
    expect(await exists("app.proposals", "request_id", request.requestId)).toBe(false);
    expect(await exists("app.bookings", "request_id", request.requestId)).toBe(false);
    expect(await exists("app.booking_links", "request_id", request.requestId)).toBe(false);
    expect(await exists("app.email_deliveries", "request_id", request.requestId)).toBe(false);
    expect(await exists("app.discussions", "id", conversation.discussionId)).toBe(false);
    expect(await exists("app.agent_sessions", "session_id", conversation.sessionId)).toBe(false);
    expect(await exists("app.agent_session_events", "session_id", conversation.sessionId)).toBe(false);
    expect(await db`select session_id from app.model_reservations where id = ${conversation.reservationId}`).toEqual([{ session_id: null }]);
    expect(google.createdEvents(request.calendarId).some((event) => event.id === booking.event_id)).toBe(true);
  });

  it("keeps a closed request whose booking write may exist", async () => {
    const request = await agreedRequest(db, google);
    const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    if (!approved.ok) throw new Error(`approve failed: ${approved.error.category}`);
    await db`update app.bookings set state = 'dispatching', dispatched_at = now(), payload = '{}'::jsonb where id = ${approved.result.bookingId}`;
    await db`update app.requests set state = 'expired', closed_at = now() - interval '91 days' where id = ${request.requestId}`;

    await retention();

    expect(await exists("app.requests", "id", request.requestId)).toBe(true);
    await db`update app.bookings set state = 'cancelled' where id = ${approved.result.bookingId}`;
  });

  it("keeps a recently closed request and an old open one", async () => {
    const recent = await createTestRequest(db);
    await closeTestRequest(db, recent.requestId);
    await db`update app.requests set closed_at = now() - interval '89 days' where id = ${recent.requestId}`;
    const open = await createTestRequest(db);
    await db`update app.requests set created_at = now() - interval '200 days' where id = ${open.requestId}`;

    await retention();

    expect(await exists("app.requests", "id", recent.requestId)).toBe(true);
    expect(await exists("app.requests", "id", open.requestId)).toBe(true);
  });

  it("applies each operational rule at its own age", async () => {
    const job = async (state: "completed" | "exhausted", age: string) => {
      const [row] = await db<{ id: string }[]>`
        insert into app.jobs (kind, producer_environment, state, completed_at, updated_at)
        values ('retention_probe', 'local', ${state}, ${state === "completed" ? db`now() - ${age}::interval` : null}, now() - ${age}::interval)
        returning id
      `;
      return row!.id;
    };
    const oldCompleted = await job("completed", "31 days");
    const newCompleted = await job("completed", "29 days");
    const oldExhausted = await job("exhausted", "91 days");
    const newExhausted = await job("exhausted", "89 days");
    const actor = `host_account:${randomUUID()}`;
    await db`
      insert into app.command_outcomes (actor, retry_key, operation, resource_id, input_hash, result, created_at)
      values (${actor}, 'old', 'probe', 'r', 'h', '{}'::jsonb, now() - interval '31 days'),
             (${actor}, 'new', 'probe', 'r', 'h', '{}'::jsonb, now() - interval '29 days')
    `;
    const operation = randomUUID();
    await db`
      insert into app.operator_operations (operator, action, target_id, previous_state, reason, environment, created_at)
      values ('dana', 'requeue_job', ${operation}, 'exhausted:x', 'old', 'local', now() - interval '366 days')
    `;

    await retention();

    const jobs = await db<{ id: string }[]>`select id from app.jobs where kind = 'retention_probe'`;
    expect(jobs.map((row) => row.id).sort()).toEqual([newCompleted, newExhausted].sort());
    expect(jobs.map((row) => row.id)).not.toContain(oldCompleted);
    expect(jobs.map((row) => row.id)).not.toContain(oldExhausted);
    expect(await db`select retry_key from app.command_outcomes where actor = ${actor}`).toEqual([{ retry_key: "new" }]);
    expect(await exists("app.operator_operations", "target_id", operation)).toBe(false);
    await db`delete from app.jobs where kind = 'retention_probe'`;
  });

  it("deletes at most the row limit per rule in one run", async () => {
    await db`
      insert into app.jobs (kind, producer_environment, state, completed_at)
      values ('retention_probe', 'local', 'completed', now() - interval '40 days'),
             ('retention_probe', 'local', 'completed', now() - interval '40 days')
    `;

    expect((await retention(1)).completed_jobs).toBe(1);
    expect(await db`select count(*)::int as count from app.jobs where kind = 'retention_probe'`).toEqual([{ count: 1 }]);
    await retention(1);
    expect(await db`select count(*)::int as count from app.jobs where kind = 'retention_probe'`).toEqual([{ count: 0 }]);
  });

  it("is scheduled every hour", async () => {
    expect(await db`select schedule, command from cron.job where jobname = 'app-retention'`).toEqual([
      { command: "select app.cleanup_retained_records(1000)", schedule: "17 * * * *" },
    ]);
  });
});

describe("deletion on request", () => {
  it("deletes a host's data and Auth user, keeps the handle taken, and refuses restoration", async () => {
    const host = await signInHost(db);
    const { handle } = await makeHostReady(db, host.hostAccountId);
    const request = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    const conversation = await conversationFor(request.requestId);
    const [identity] = await db<{ email: string; google_subject: string }[]>`
      select google_subject, email from app.google_identities where host_account_id = ${host.hostAccountId}
    `;

    const run = admin();
    expect(await runAdmin(["delete-host", "--host", handle, "--reason", "deletion request by email", "--operator", "dana", "--local", "--yes"], run.deps)).toBe(0);
    expect(run.out.at(-1)).toBe(`Host account ${host.hostAccountId} (active): data deleted; the account stays suspended with its handle history`);

    expect(await db`select status, display_name, deleted_at is not null as deleted from app.host_accounts where id = ${host.hostAccountId}`).toEqual([
      { deleted: true, display_name: null, status: "suspended" },
    ]);
    for (const table of ["app.google_identities", "app.provider_grants", "app.host_settings", "app.calendar_roles", "app.requests"]) {
      expect(await exists(table, "host_account_id", host.hostAccountId)).toBe(false);
    }
    expect(await exists("auth.users", "id", host.userId)).toBe(false);
    expect(await exists("app.discussions", "id", conversation.discussionId)).toBe(false);
    expect(await exists("app.host_handles", "handle", handle)).toBe(true);
    expect(await findReadyHostByHandle(db, handle)).toBeNull();
    expect((await checkHandle(db, await newHostAccount(db), handle)).availability).toBe("taken");
    expect(await db`select action, previous_state, reason from app.operator_operations where target_id = ${host.hostAccountId}`).toEqual([
      { action: "delete_host", previous_state: "active", reason: "deletion request by email" },
    ]);

    const restore = admin();
    expect(await runAdmin(["restore", "--host", host.hostAccountId, "--reason", "x", "--operator", "dana", "--local", "--yes"], restore.deps)).toBe(1);
    expect(restore.err.join("\n")).toMatch(/deleted on request/);
    const again = admin();
    expect(await runAdmin(["delete-host", "--host", host.hostAccountId, "--reason", "x", "--operator", "dana", "--local", "--yes"], again.deps)).toBe(1);
    expect(again.err.join("\n")).toMatch(/already deleted/);

    // The same Google account signing in later gets a new, empty account.
    const authUser = randomUUID();
    await db`insert into auth.users (id, email, aud, role) values (${authUser}, ${identity!.email}, 'authenticated', 'authenticated')`;
    const account = await db.begin((tx) => ensureHostAccount(tx, { authUserId: authUser, email: identity!.email, googleSubject: identity!.google_subject }));
    expect(account.created).toBe(true);
    expect(account.id).not.toBe(host.hostAccountId);
  });

  it("deletes one request with its conversation, and refuses while a booking write may exist", async () => {
    const hostAccountId = await newHostAccount(db);
    const request = await createTestRequest(db, { hostAccountId });
    const conversation = await conversationFor(request.requestId);
    // A turn reply still waiting on the deleted input.
    await db`
      insert into app.email_replies (kind, dedupe_key, request_id, inbox_id, reply_to_message_id, input_id, state)
      values ('turn', ${randomUUID()}, ${request.requestId}, 'inbox@example.test', '<m@example.test>', ${conversation.inputId}, 'waiting')
    `;

    const run = admin();
    expect(await runAdmin(["delete-request", "--request", request.requestId, "--reason", "requester asked", "--operator", "dana", "--local", "--yes"], run.deps)).toBe(0);
    expect(run.out.at(-1)).toBe(`Request ${request.requestId} (gathering): deleted`);
    expect(await exists("app.requests", "id", request.requestId)).toBe(false);
    expect(await exists("app.discussions", "id", conversation.discussionId)).toBe(false);
    expect(await exists("app.host_accounts", "id", hostAccountId)).toBe(true);

    const pending = await agreedRequest(db, google);
    const approved = await asHost(db, pending.hostAccountId, pending.requestId, approveCommand, { version: 1 }, {
      expectedRevision: await revisionOf(db, pending.requestId),
    });
    if (!approved.ok) throw new Error(`approve failed: ${approved.error.category}`);
    await db`update app.bookings set state = 'dispatching', dispatched_at = now(), payload = '{}'::jsonb where id = ${approved.result.bookingId}`;

    const refused = admin();
    expect(await runAdmin(["delete-request", "--request", pending.requestId, "--reason", "x", "--operator", "dana", "--local", "--yes"], refused.deps)).toBe(1);
    expect(refused.err.join("\n")).toMatch(/reconcile it with recover booking first/);
    const refusedHost = admin();
    expect(await runAdmin(["delete-host", "--host", pending.hostAccountId, "--reason", "x", "--operator", "dana", "--local", "--yes"], refusedHost.deps)).toBe(1);
    expect(await exists("app.requests", "id", pending.requestId)).toBe(true);

    const unknown = admin();
    expect(await runAdmin(["delete-request", "--request", randomUUID(), "--reason", "x", "--operator", "dana", "--local", "--yes"], unknown.deps)).toBe(1);
    expect(unknown.err.join("\n")).toMatch(/no request matches/);
  });

  it("needs --yes or the typed subject", async () => {
    const request = await createTestRequest(db);
    const run = admin();

    expect(await runAdmin(["delete-request", "--request", request.requestId, "--reason", "x", "--operator", "dana", "--local"], run.deps)).toBe(1);
    expect(await exists("app.requests", "id", request.requestId)).toBe(true);
  });

  it("denies the deletion and retention functions to Data API roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const statement of [
        "select * from app.cleanup_retained_records(1)",
        `select * from app.operator_delete_request('${randomUUID()}', 'mallory', 'x', 'local')`,
        "select * from app.operator_delete_host('nobody', 'mallory', 'x', 'local')",
        "select app.delete_request_records('{}'::uuid[])",
      ]) {
        await expect(
          db.begin(async (tx) => {
            await tx.unsafe(`set local role ${role}`);
            await tx.unsafe(statement);
          }),
        ).rejects.toThrow(/permission denied/);
      }
    }
  });
});

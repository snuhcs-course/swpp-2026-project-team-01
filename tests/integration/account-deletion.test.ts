import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAccountDeletionHandler,
  createHostDeletionHandler,
  HOST_DELETION_JOB,
  scheduleHostDeletionCommand,
} from "../../lib/server/account-deletion";
import { approveCommand } from "../../lib/server/bookings";
import { checkHandle } from "../../lib/server/handles";
import { completeGoogleSignIn } from "../../lib/server/google-sign-in";
import { createGrantedScopesFetcher } from "../../lib/server/google-token-info";
import { runCommand } from "../../lib/server/commands";
import { createEmailDeliveryHandler } from "../../lib/server/email-delivery";
import { localAuthConfig, signInHost, UNBOUNDED_SIGN_UPS } from "./support/auth";
import { agreedRequest, asHost } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeCloudflare, startFakeCloudflare } from "./support/fake-cloudflare";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { makeHostReady, newHostAccount } from "./support/ready-host";
import { createTestRequest, runJob, testTokenKey } from "./support/requests";
import { revisionOf } from "./support/scheduling";

// Self-service host account deletion (self-service-account-deletion) against
// the local stack: scheduling from the Settings route, cancelling by signing in,
// the delayed job running the operator's deletion with the guest and host
// emails, a stale or blocked job, the account email checks and retention.

const db = testDatabase();
const origin = "http://localhost:3000";
let google: FakeGoogle;
let cloudflare: FakeCloudflare;

beforeAll(async () => {
  google = await startFakeGoogle();
  cloudflare = await startFakeCloudflare();
});

afterAll(async () => {
  await google.close();
  await cloudflare.close();
  await db.end();
});

const route = createAccountDeletionHandler(
  () => ({ allowedOrigins: [], appOrigin: origin, auth: localAuthConfig(), db }) as never,
  () => ({ origin, tokenKey: testTokenKey }),
);
const deletionJob = createHostDeletionHandler(() => ({ origin, tokenKey: testTokenKey }));

function scheduleAgain(hostAccountId: string, confirmation: string) {
  return runCommand(
    { authenticate: async () => ({ id: hostAccountId, kind: "host_account" }), db },
    scheduleHostDeletionCommand({ origin, tokenKey: testTokenKey }),
    { input: { confirmation }, resourceId: hostAccountId, retryKey: randomUUID() },
  );
}

function schedule(cookie: string, confirmation: string, headers: Record<string, string> = {}) {
  return route(
    new Request(`${origin}/api/host/account-deletion`, {
      body: JSON.stringify({ confirmation, retryKey: randomUUID() }),
      headers: { cookie, "content-type": "application/json", origin, ...headers },
      method: "POST",
    }),
  );
}

async function accountOf(hostAccountId: string) {
  const [row] = await db<{ deletion_due_at: Date | null; deleted_at: Date | null; status: string }[]>`
    select deletion_due_at, deleted_at, status from app.host_accounts where id = ${hostAccountId}
  `;
  return row!;
}

async function deletionJobsOf(hostAccountId: string) {
  return db<{ id: string; dedupe_key: string; state: string; run_after: Date; outcome: unknown }[]>`
    select id, dedupe_key, state, run_after, outcome from app.jobs
    where kind = ${HOST_DELETION_JOB} and payload ->> 'hostAccountId' = ${hostAccountId}
    order by created_at
  `;
}

async function accountEmailsOf(hostAccountId: string) {
  return db<{ id: string; kind: string; recipients: string[]; language: string; state: string; request_id: string | null }[]>`
    select id, kind, recipients, language, state, request_id from app.email_deliveries
    where parameters ->> 'hostAccountId' = ${hostAccountId}
    order by created_at, kind
  `;
}

// Signs the same Google user in again, as the callback does after Google.
async function signInAgain(userId: string) {
  const [identity] = await db<{ email: string; google_subject: string }[]>`
    select email, google_subject from app.google_identities where auth_user_id = ${userId}
  `;
  const user = {
    email: identity!.email,
    id: userId,
    identities: [{ id: identity!.google_subject, identity_data: { sub: identity!.google_subject }, provider: "google" }],
    user_metadata: {},
  } as unknown as User;
  return completeGoogleSignIn(
    {
      appOrigin: origin,
      db,
      fetchGrantedScopes: createGrantedScopesFetcher("http://127.0.0.1:9/tokeninfo"),
      signUpLimits: UNBOUNDED_SIGN_UPS,
      tokenKey: testTokenKey,
    },
    { accessToken: null, refreshToken: null, user },
    "test-source",
  );
}

// Moves a schedule and its job into the past, as seven days passing would.
async function fallDue(hostAccountId: string) {
  await db`update app.host_accounts set deletion_due_at = deletion_due_at - interval '8 days' where id = ${hostAccountId}`;
  await db`
    update app.jobs set run_after = run_after - interval '8 days',
      payload = jsonb_set(payload, '{dueAt}', to_jsonb(to_char(((payload ->> 'dueAt')::timestamptz - interval '8 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    where kind = ${HOST_DELETION_JOB} and payload ->> 'hostAccountId' = ${hostAccountId} and state = 'pending'
  `;
}

describe("scheduling from Settings", () => {
  it("refuses a mismatch, schedules 7 days out with one job and one email, and signs the host out", async () => {
    const host = await signInHost(db);
    const { handle } = await makeHostReady(db, host.hostAccountId);

    const wrong = await schedule(host.cookie, "someone-else");
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ code: "confirmation_mismatch" });
    expect((await accountOf(host.hostAccountId)).deletion_due_at).toBeNull();

    const crossSite = await schedule(host.cookie, handle, { origin: "https://evil.example" });
    expect(crossSite.status).toBe(403);
    expect((await schedule("", handle)).status).toBe(401);

    const before = Date.now();
    const response = await schedule(host.cookie, `  @${handle.toUpperCase()} `);
    expect(response.status).toBe(200);
    const { dueAt } = (await response.json()) as { dueAt: string };
    const days = (new Date(dueAt).getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    // The session cookies are cleared in this browser.
    expect(response.headers.getSetCookie().some((cookie) => /Max-Age=0/i.test(cookie))).toBe(true);

    const account = await accountOf(host.hostAccountId);
    expect(account.status).toBe("active");
    expect(account.deletion_due_at?.toISOString()).toBe(dueAt);
    const jobs = await deletionJobsOf(host.hostAccountId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.run_after.toISOString()).toBe(dueAt);
    expect((await accountEmailsOf(host.hostAccountId)).map((email) => [email.kind, email.request_id])).toEqual([
      ["account_deletion_scheduled", null],
    ]);
  });

  it("keeps the first due time when asked again", async () => {
    const host = await signInHost(db);
    const { handle } = await makeHostReady(db, host.hostAccountId);
    const first = (await (await schedule(host.cookie, handle)).json()) as { dueAt: string };
    const again = await scheduleAgain(host.hostAccountId, handle);
    expect(again).toMatchObject({ ok: true, result: { alreadyScheduled: true, dueAt: first.dueAt } });
    expect(await deletionJobsOf(host.hostAccountId)).toHaveLength(1);

    // A job that spent its attempts is replaced when the host asks again.
    const [job] = await deletionJobsOf(host.hostAccountId);
    expect((await db<{ max_attempts: number }[]>`select max_attempts from app.jobs where id = ${job!.id}`)[0]!.max_attempts).toBe(100);
    await db`update app.jobs set state = 'exhausted' where id = ${job!.id}`;
    expect(await scheduleAgain(host.hostAccountId, handle)).toMatchObject({ ok: true, result: { dueAt: first.dueAt } });
    const jobs = await deletionJobsOf(host.hostAccountId);
    expect(jobs.map((row) => row.state)).toEqual(["exhausted", "pending"]);
    expect(jobs[1]!.run_after.toISOString()).toBe(first.dueAt);
  });
});

describe("cancelling by signing in", () => {
  it("clears the schedule, emails the host, and runs only a later schedule", async () => {
    const host = await signInHost(db);
    const { handle } = await makeHostReady(db, host.hostAccountId);
    await schedule(host.cookie, handle);

    const account = await signInAgain(host.userId);
    expect(account.id).toBe(host.hostAccountId);
    expect((await accountOf(host.hostAccountId)).deletion_due_at).toBeNull();
    expect((await accountEmailsOf(host.hostAccountId)).map((email) => email.kind).sort()).toEqual([
      "account_deletion_cancelled",
      "account_deletion_scheduled",
    ]);

    // The first job, once due, finds its schedule gone and deletes nothing.
    await fallDue(host.hostAccountId);
    const [stale] = await deletionJobsOf(host.hostAccountId);
    expect(await runJob(db, stale!.id, deletionJob)).toBe("completed");
    expect((await deletionJobsOf(host.hostAccountId))[0]!.outcome).toEqual({ status: "cancelled" });
    expect((await accountOf(host.hostAccountId)).deleted_at).toBeNull();

    // Scheduling again makes a new job of its own.
    const rescheduled = await scheduleAgain(host.hostAccountId, handle);
    expect(rescheduled).toMatchObject({ ok: true, result: { alreadyScheduled: false } });
    expect(await deletionJobsOf(host.hostAccountId)).toHaveLength(2);
  });

  it("suppresses the scheduled email once the host cancelled", async () => {
    const host = await signInHost(db);
    const { handle } = await makeHostReady(db, host.hostAccountId);
    await schedule(host.cookie, handle);
    await signInAgain(host.userId);

    const delivery = createEmailDeliveryHandler(() => ({
      config: { accountId: "acct_test", apiToken: "cf_test_token", baseUrl: cloudflare.baseUrl, from: "no-reply@findmeatime.com", timeoutMs: 2_000 },
      db,
      env: {},
      tokenKeys: [testTokenKey],
    }));
    const [identity] = await db<{ email: string }[]>`select email from app.google_identities where host_account_id = ${host.hostAccountId}`;

    for (const email of await accountEmailsOf(host.hostAccountId)) {
      const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = 'email_delivery' and payload ->> 'deliveryId' = ${email.id}`;
      await runJob(db, job!.id, delivery);
    }
    const states = Object.fromEntries((await accountEmailsOf(host.hostAccountId)).map((email) => [email.kind, email.state]));
    expect(states.account_deletion_scheduled).toBe("suppressed");
    expect(states.account_deletion_cancelled).toBe("accepted");
    expect(cloudflare.messagesTo(identity!.email).map((email) => email.subject)).toEqual(["Your account deletion was cancelled"]);
  });
});

describe("running a scheduled deletion", () => {
  it("deletes like the operator, tells open requests' guests and the host, and keeps the handle", async () => {
    const host = await signInHost(db);
    const { handle } = await makeHostReady(db, host.hostAccountId);
    const open = await createTestRequest(db, { hostAccountId: host.hostAccountId, language: "ko" });
    const closed = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${closed.requestId}`;
    await schedule(host.cookie, handle);

    const [notYet] = await deletionJobsOf(host.hostAccountId);
    expect(notYet!.run_after.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    await fallDue(host.hostAccountId);
    expect(await runJob(db, notYet!.id, deletionJob)).toBe("completed");
    expect((await deletionJobsOf(host.hostAccountId))[0]!.outcome).toEqual({ guestNotices: 1, status: "deleted" });

    const account = await accountOf(host.hostAccountId);
    expect(account).toMatchObject({ deletion_due_at: null, status: "suspended" });
    expect(account.deleted_at).not.toBeNull();
    expect(await db`select 1 from app.requests where host_account_id = ${host.hostAccountId}`).toHaveLength(0);
    expect(await db`select 1 from auth.users where id = ${host.userId}`).toHaveLength(0);
    expect((await checkHandle(db, await newHostAccount(db), handle)).availability).toBe("taken");
    expect(await db`select operator, action, reason from app.operator_operations where target_id = ${host.hostAccountId}`).toEqual([
      { action: "delete_host", operator: "self-service", reason: "requested by the host in Settings" },
    ]);

    const emails = await accountEmailsOf(host.hostAccountId);
    expect(emails.map((email) => [email.kind, email.recipients, email.language, email.request_id])).toEqual(
      expect.arrayContaining([
        ["host_account_closed", [open.contactEmail], "ko", null],
        ["account_deletion_completed", [expect.any(String)], "en", null],
      ]),
    );
    expect(emails.some((email) => email.recipients.includes(closed.contactEmail))).toBe(false);
  });

  it("waits while a booking write may exist, then deletes", async () => {
    const pending = await agreedRequest(db, google);
    const approved = await asHost(db, pending.hostAccountId, pending.requestId, approveCommand, { version: 1 }, {
      expectedRevision: await revisionOf(db, pending.requestId),
    });
    if (!approved.ok) throw new Error(`approve failed: ${approved.error.category}`);
    await db`update app.bookings set state = 'dispatching', dispatched_at = now(), payload = '{}'::jsonb where id = ${approved.result.bookingId}`;
    const [scheduled] = await db<{ due: Date }[]>`
      update app.host_accounts set deletion_due_at = date_trunc('milliseconds', now()) - interval '1 minute'
      where id = ${pending.hostAccountId} returning deletion_due_at as due
    `;
    const [job] = await db<{ id: string }[]>`
      insert into app.jobs (kind, payload, dedupe_key, producer_environment, run_after)
      values (${HOST_DELETION_JOB}, ${db.json({ dueAt: scheduled!.due.toISOString(), hostAccountId: pending.hostAccountId })},
              ${`host:${pending.hostAccountId}:${scheduled!.due.toISOString()}`}, 'local', now() - interval '1 minute')
      returning id
    `;

    expect(await runJob(db, job!.id, deletionJob)).toBe("failed");
    const [retry] = await db<{ failure_category: string; state: string }[]>`select state, failure_category from app.jobs where id = ${job!.id}`;
    expect(retry).toEqual({ failure_category: "booking_pending", state: "pending" });
    expect((await accountOf(pending.hostAccountId)).deleted_at).toBeNull();
    expect(await db`select 1 from app.requests where id = ${pending.requestId}`).toHaveLength(1);

    await db`update app.bookings set state = 'failed' where id = ${approved.result.bookingId}`;
    await db`update app.jobs set run_after = now() where id = ${job!.id}`;
    expect(await runJob(db, job!.id, deletionJob)).toBe("completed");
    expect((await accountOf(pending.hostAccountId)).deleted_at).not.toBeNull();
  });
});

describe("retention", () => {
  it("deletes account emails 30 days after they finished and keeps newer ones", async () => {
    const hostAccountId = await newHostAccount(db);
    const insert = (completedDaysAgo: number) => db`
      insert into app.email_deliveries (kind, dedupe_key, sender, recipients, template, language, parameters, state, completed_at)
      values ('account_deletion_completed', ${randomUUID()}, 'no-reply@findmeatime.com', ${["host@example.test"]},
              'account_deletion_completed', 'en', ${db.json({ hostAccountId })}, 'accepted', now() - make_interval(days => ${completedDaysAgo}))
    `;
    await insert(31);
    await insert(1);

    const rows = await db<{ deleted: number; rule: string }[]>`select rule, deleted from app.cleanup_retained_records(1000)`;
    expect(rows.find((row) => row.rule === "account_emails")?.deleted).toBeGreaterThanOrEqual(1);
    expect(await accountEmailsOf(hostAccountId)).toHaveLength(1);
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { publishJob } from "../../lib/server/jobs";
import {
  createRequestExpiryHandler,
  EXPIRY_BATCH,
  REQUEST_EXPIRY_JOB,
  requestExpiresAt,
} from "../../lib/server/request-lifecycle";
import { REQUESTER_REVOCATION_JOB } from "../../lib/server/requester-grants";
import { createRequesterCommandHandler, createRequesterStateHandler } from "../../lib/server/requester-routes";
import { requesterGrantContext } from "../../lib/server/requester-calendar";
import { sealToken } from "../../lib/server/token-encryption";
import { testDatabase } from "./support/database";
import { call, guestDependencies } from "./support/guests";
import { createTestRequest, runJob, testTokenKey } from "./support/requests";

// Withdrawal and expiry (task 3.5): request.withdraw from each actionable state
// at the expected revision, the request_expiry job at seven days and at an
// earlier window end, the per-command expiry check, closure deleting grants and
// superseding confirmation links and reviews, and replay never reopening a
// closed request.

const db = testDatabase();
const deps = guestDependencies(db);

afterAll(async () => {
  await db.end();
});

function command(bookingId: string, operation: string, expectedRevision: number | null, retryKey: string = randomUUID()) {
  return call(createRequesterCommandHandler(() => deps), { bookingId }, `/api/requests/${bookingId}/commands`, {
    body: { expectedRevision, input: {}, operation, retryKey },
  });
}

async function seedClosable(state = "gathering") {
  const request = await createTestRequest(db);
  await db`update app.requests set state = ${state} where id = ${request.requestId}`;
  await db`
    insert into app.request_reviews (request_id, base_revision, intent, patch)
    values (${request.requestId}, 1, 'details', ${db.json({ purpose: "Intro" })})
  `;
  await db`
    insert into app.contact_confirmations (request_id, contact_email, token_hash)
    values (${request.requestId}, ${request.contactEmail}, ${randomUUID()})
  `;
  const sealed = sealToken(testTokenKey, `1//${randomUUID()}`, requesterGrantContext(request.requestId));
  await db`
    insert into app.requester_grants
      (request_id, kind, google_subject_hash, granted_scopes, refresh_token_ciphertext, refresh_token_key_id)
    values (${request.requestId}, 'calendar', ${randomUUID()}, '{}', ${sealed.ciphertext}, ${sealed.keyId})
  `;
  return request;
}

async function closure(requestId: string) {
  const [row] = await db<
    { closed: boolean; confirmations: number; live_grants: number; pending: number; revocations: number; state: string; tokens: number }[]
  >`
    select r.state, r.closed_at is not null as closed,
      (select count(*)::int from app.request_reviews where request_id = r.id and state = 'pending') as pending,
      (select count(*)::int from app.contact_confirmations where request_id = r.id and superseded_at is null) as confirmations,
      (select count(*)::int from app.requester_grants where request_id = r.id and revoked_at is null) as live_grants,
      (select count(*)::int from app.requester_grants where request_id = r.id and refresh_token_ciphertext is not null) as tokens,
      (select count(*)::int from app.jobs where kind = ${REQUESTER_REVOCATION_JOB} and payload ->> 'requestId' = r.id::text) as revocations
    from app.requests r where r.id = ${requestId}
  `;
  return row!;
}

const CLOSED = { closed: true, confirmations: 0, live_grants: 0, pending: 0, revocations: 1, tokens: 0 };

describe("request.withdraw", () => {
  it.each(["gathering", "negotiating", "awaiting_host_approval"])("withdraws from %s and closes everything the request held", async (state) => {
    const request = await seedClosable(state);
    const response = await command(request.bookingId, "request.withdraw", 1);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: { revision: 2, state: "withdrawn" } });
    expect(await closure(request.requestId)).toEqual({ ...CLOSED, state: "withdrawn" });
  });

  it("rejects a stale expected revision and changes nothing", async () => {
    const request = await seedClosable();
    const response = await command(request.bookingId, "request.withdraw", 7);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { category: "stale_revision" }, ok: false });
    expect((await closure(request.requestId)).state).toBe("gathering");
  });

  it("rejects a decision after withdrawal with the current status, and replay never reopens it", async () => {
    const request = await seedClosable();
    const retryKey = randomUUID();
    await command(request.bookingId, "request.withdraw", 1, retryKey);

    const again = await command(request.bookingId, "request.withdraw", 2);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { category: "request_closed" }, status: "withdrawn" });

    const replay = await command(request.bookingId, "request.withdraw", 1, retryKey);
    expect(await replay.json()).toMatchObject({ ok: true, replayed: true, result: { state: "withdrawn" } });
    expect((await closure(request.requestId)).state).toBe("withdrawn");

    const state = await call(createRequesterStateHandler(() => deps), { bookingId: request.bookingId }, "/state");
    expect(await state.json()).toEqual({ host: { displayName: "Your host", handle: null }, open: false, request: { state: "withdrawn" } });
  });
});

describe("expiry", () => {
  async function sweep() {
    const id = await db.begin((tx) => publishJob(tx, { dedupeKey: `test:${randomUUID()}`, kind: REQUEST_EXPIRY_JOB }));
    return runJob(db, id!, createRequestExpiryHandler());
  }

  it("ends an actionable request seven days after creation", async () => {
    const request = await seedClosable("negotiating");
    await db`
      update app.requests set created_at = now() - interval '7 days 1 minute', expires_at = now() - interval '1 minute'
      where id = ${request.requestId}
    `;

    expect(await sweep()).toBe("completed");
    expect(await closure(request.requestId)).toEqual({ ...CLOSED, state: "expired" });
  });

  it("ends a request at its latest requested window's end when that comes first", async () => {
    const created = new Date();
    const end = new Date(created.getTime() + 2 * 86_400_000);
    expect(requestExpiresAt(created, [{ end: end.toISOString(), start: created.toISOString() }])).toEqual(end);
    expect(requestExpiresAt(created).getTime()).toBe(created.getTime() + 7 * 86_400_000);

    const request = await seedClosable();
    const windows = [{ end: new Date(Date.now() - 60_000).toISOString(), start: new Date(Date.now() - 3_600_000).toISOString() }];
    await db`
      update app.requests set details = details || ${db.json({ windows })},
        expires_at = ${requestExpiresAt(new Date(Date.now() - 86_400_000), windows)}
      where id = ${request.requestId}
    `;

    await sweep();
    expect((await closure(request.requestId)).state).toBe("expired");
  });

  it("rejects a decision once the expiry passed, before the sweep runs", async () => {
    const request = await seedClosable();
    await db`update app.requests set expires_at = now() - interval '1 second' where id = ${request.requestId}`;

    const response = await command(request.bookingId, "request.withdraw", 1);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { category: "request_closed" }, status: "expired" });
    expect((await closure(request.requestId)).state).toBe("gathering");
  });

  it("closes due requests in batches of 200 and publishes the next batch", async () => {
    const request = await createTestRequest(db);
    await db`
      insert into app.requests (host_account_id, details, requester_name, contact_email, expires_at)
      select ${request.hostAccountId}, '{}'::jsonb, 'Batch', 'batch@example.test', now() - interval '1 minute'
      from generate_series(1, ${EXPIRY_BATCH + 1})
    `;
    const id = await db.begin((tx) => publishJob(tx, { dedupeKey: `test:${randomUUID()}`, kind: REQUEST_EXPIRY_JOB }));
    await runJob(db, id!, createRequestExpiryHandler());

    const [next] = await db<{ id: string }[]>`
      select id from app.jobs where kind = ${REQUEST_EXPIRY_JOB} and dedupe_key = ${`continue:${id}`}
    `;
    expect(next).toBeDefined();
    await runJob(db, next!.id, createRequestExpiryHandler());

    const [open] = await db<{ count: number }[]>`
      select count(*)::int as count from app.requests where host_account_id = ${request.hostAccountId} and closed_at is null
    `;
    expect(open!.count).toBe(1);
  });
});

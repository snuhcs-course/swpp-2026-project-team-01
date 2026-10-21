import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookingUrl } from "../../lib/server/booking-links";
import type { CloudflareEmailConfig } from "../../lib/server/cloudflare-email";
import {
  createEmailDeliveryHandler,
  EMAIL_DELIVERY_JOB,
  type EmailDeliveryDependencies,
  enqueueEmail,
  type EnqueueEmail,
} from "../../lib/server/email-delivery";
import { runWorkerBatch } from "../../lib/server/job-worker";
import { testDatabase } from "./support/database";
import { type FakeCloudflare, startFakeCloudflare } from "./support/fake-cloudflare";
import { closeTestRequest, createTestRequest, jobFor, runJob, testTokenKey, type TestRequest } from "./support/requests";

const db = testDatabase();
let cloudflare: FakeCloudflare;

beforeAll(async () => {
  cloudflare = await startFakeCloudflare();
});

afterAll(async () => {
  await cloudflare.close();
  await db.end();
});

const origin = "http://localhost:3000";

function config(overrides: Partial<CloudflareEmailConfig> = {}): CloudflareEmailConfig {
  return {
    accountId: "acct_test",
    apiToken: "cf_test_token",
    baseUrl: cloudflare.baseUrl,
    from: "no-reply@findmeatime.com",
    timeoutMs: 2_000,
    ...overrides,
  };
}

function handler(overrides: Partial<EmailDeliveryDependencies> = {}) {
  return createEmailDeliveryHandler(() => ({ config: config(), db, env: {}, tokenKeys: [testTokenKey], ...overrides }));
}

async function enqueue(request: TestRequest, overrides: Partial<EnqueueEmail> = {}) {
  const confirmToken = `confirm-${randomUUID()}`;
  const delivery = await db.begin((tx) =>
    enqueueEmail(tx, {
      dedupeKey: `test:${randomUUID()}`,
      from: "Find Me a Time <no-reply@findmeatime.com>",
      kind: "request_creation",
      language: "en",
      parameters: { hostName: "Ada Lovelace", requesterName: "Grace Hopper" },
      recipient: request.contactEmail,
      requestId: request.requestId,
      secrets: { bookingUrl: bookingUrl(origin, request.bookingId), confirmUrl: `${origin}/booking/confirm/${confirmToken}` },
      tokenKey: testTokenKey,
      ...overrides,
    }),
  );
  return { ...delivery, confirmToken };
}

async function deliver(deliveryId: string, run = handler()) {
  const job = await jobFor(db, EMAIL_DELIVERY_JOB, `email:${deliveryId}`);
  return runJob(db, job!.id, run);
}

async function delivery(id: string) {
  const [row] = await db<
    {
      dispatch_id: string;
      evidence: Record<string, unknown> | null;
      secret_ciphertext: string | null;
      sender: string;
      state: string;
    }[]
  >`select state, evidence, secret_ciphertext, dispatch_id, sender from app.email_deliveries where id = ${id}`;
  return row!;
}

async function storedRow(id: string) {
  const [row] = await db<{ row: string }[]>`select row_to_json(d)::text as row from app.email_deliveries d where id = ${id}`;
  return row!.row;
}

describe("email delivery", () => {
  it("records acceptance with the dispatch ID the message carried, and deletes the sealed links", async () => {
    const request = await createTestRequest(db);
    const { confirmToken, id } = await enqueue(request);

    // A stored queued row holds no usable link.
    expect(await storedRow(id)).not.toContain(request.bookingId);
    expect(await storedRow(id)).not.toContain(confirmToken);

    expect(await deliver(id)).toBe("completed");

    const row = await delivery(id);
    const [message] = cloudflare.messagesTo(request.contactEmail);
    expect(row.state).toBe("accepted");
    expect(row.secret_ciphertext).toBeNull();
    expect(row.evidence).toMatchObject({ delivered: [request.contactEmail], dispatchId: row.dispatch_id });
    expect(message).toMatchObject({
      accountId: "acct_test",
      authorization: "Bearer cf_test_token",
      from: "Find Me a Time <no-reply@findmeatime.com>",
      headers: { "X-Fmat-Dispatch-Id": row.dispatch_id },
      to: [request.contactEmail],
    });
    expect(message!.text).toContain(`${origin}/booking/${request.bookingId}`);
    expect(message!.html).toContain(`${origin}/booking/confirm/${confirmToken}`);
    expect(await storedRow(id)).not.toContain(request.bookingId);
  });

  it("accepts a queued recipient and records a duplicate publication once", async () => {
    const request = await createTestRequest(db);
    cloudflare.setBehavior(request.contactEmail, "queued");
    const dedupeKey = `test:${randomUUID()}`;
    const first = await enqueue(request, { dedupeKey });
    const second = await enqueue(request, { dedupeKey, parameters: { hostName: "Someone else" } });

    expect(second).toMatchObject({ created: false, id: first.id });
    await deliver(first.id);
    expect((await delivery(first.id)).state).toBe("accepted");
    expect(cloudflare.messagesTo(request.contactEmail)).toHaveLength(1);
    expect(cloudflare.messagesTo(request.contactEmail)[0]!.text).toContain("Ada Lovelace");
  });

  it.each([
    ["a permanent bounce", "bounce" as const, "rejected"],
    ["a 429", { status: 429 }, "rejected"],
    ["a server error", { status: 503 }, "uncertain"],
    ["a lost response", "drop" as const, "uncertain"],
    ["a success with no recipient evidence", "missing_evidence" as const, "uncertain"],
  ])("records %s truthfully and changes no request state", async (_label, behavior, state) => {
    const request = await createTestRequest(db);
    cloudflare.setBehavior(request.contactEmail, behavior);
    const { id } = await enqueue(request);

    await deliver(id);

    const row = await delivery(id);
    expect(row.state).toBe(state);
    expect(row.secret_ciphertext).toBeNull();
    const [after] = await db<{ contact_confirmed_email: string | null; revision: number; state: string }[]>`
      select state, revision, contact_confirmed_email from app.requests where id = ${request.requestId}
    `;
    expect(after).toEqual({ contact_confirmed_email: null, revision: 1, state: "gathering" });
  });

  it("records a timeout as uncertain and never sends it again", async () => {
    const request = await createTestRequest(db);
    cloudflare.setBehavior(request.contactEmail, "hang");
    const { id } = await enqueue(request);
    const run = handler({ config: config({ timeoutMs: 300 }) });

    await deliver(id, run);
    expect(await delivery(id)).toMatchObject({ evidence: { reason: "timeout" }, state: "uncertain" });

    // Redelivering the job sends nothing more.
    const job = await jobFor(db, EMAIL_DELIVERY_JOB, `email:${id}`);
    await db`update app.jobs set state = 'pending', completed_at = null where id = ${job!.id}`;
    await deliver(id, run);
    expect(cloudflare.messagesTo(request.contactEmail)).toHaveLength(1);
  });

  it("marks a delivery found dispatching after a crash as uncertain without sending", async () => {
    const request = await createTestRequest(db);
    const { id } = await enqueue(request);
    await db`update app.email_deliveries set state = 'dispatching', dispatched_at = now() where id = ${id}`;

    await deliver(id);

    expect(await delivery(id)).toMatchObject({
      evidence: { reason: "interrupted" },
      secret_ciphertext: null,
      state: "uncertain",
    });
    expect(cloudflare.messagesTo(request.contactEmail)).toHaveLength(0);
  });

  it("suppresses a recipient that is no longer current", async () => {
    const closed = await createTestRequest(db);
    const changed = await createTestRequest(db);
    const unconfirmed = await createTestRequest(db);
    const first = await enqueue(closed);
    const second = await enqueue(changed);
    const third = await enqueue(unconfirmed, {
      kind: "link_resend",
      secrets: { bookingUrl: bookingUrl(origin, unconfirmed.bookingId) },
    });
    await closeTestRequest(db, closed.requestId);
    await db`update app.requests set contact_email = 'other@example.test' where id = ${changed.requestId}`;

    for (const { id } of [first, second, third]) {
      await deliver(id);
      expect(await delivery(id)).toMatchObject({ secret_ciphertext: null, state: "suppressed" });
    }
    for (const request of [closed, changed, unconfirmed]) {
      expect(cloudflare.messagesTo(request.contactEmail)).toHaveLength(0);
    }
  });

  it("leaves the delivery queued without configuration, then rejects it unsent, with no fallback", async () => {
    const request = await createTestRequest(db);
    const { id } = await enqueue(request);
    const run = handler({ config: config({ apiToken: "" }) });

    expect(await deliver(id, run)).toBe("failed");
    expect((await delivery(id)).state).toBe("queued");

    const job = await jobFor(db, EMAIL_DELIVERY_JOB, `email:${id}`);
    await db`update app.jobs set run_after = now(), max_attempts = 2 where id = ${job!.id}`;
    expect(await deliver(id, run)).toBe("exhausted");
    expect(await delivery(id)).toMatchObject({
      evidence: { reason: "not_dispatched" },
      secret_ciphertext: null,
      state: "rejected",
    });
    expect(cloudflare.messagesTo(request.contactEmail)).toHaveLength(0);
  });

  it("sends nothing from a preview deployment, even toward a stand-in", async () => {
    const request = await createTestRequest(db);
    const { id } = await enqueue(request);

    expect(await deliver(id, handler({ env: { VERCEL: "1", VERCEL_ENV: "preview" } }))).toBe("failed");
    expect((await delivery(id)).state).toBe("queued");
    expect(cloudflare.messagesTo(request.contactEmail)).toHaveLength(0);
  });

  it("keeps a local worker aimed at the real provider from claiming deliveries", async () => {
    const request = await createTestRequest(db);
    const { id } = await enqueue(request);
    const real = handler({ config: config({ baseUrl: "https://api.cloudflare.com" }) });

    const batch = await runWorkerBatch({ db, env: {}, environment: "local", handlers: { [EMAIL_DELIVERY_JOB]: real } });

    expect(batch).toEqual({ claimed: 0, results: {} });
    expect((await delivery(id)).state).toBe("queued");
    expect((await jobFor(db, EMAIL_DELIVERY_JOB, `email:${id}`))!.state).toBe("pending");
  });
});

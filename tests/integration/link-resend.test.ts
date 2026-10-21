import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEmailDeliveryHandler, EMAIL_DELIVERY_JOB } from "../../lib/server/email-delivery";
import {
  addressHash,
  createLinkResendHandler,
  createLinkResendRouteHandler,
  LINK_RESEND_JOB,
  type LinkResendLimits,
} from "../../lib/server/link-resend";
import { testDatabase } from "./support/database";
import { type FakeCloudflare, startFakeCloudflare } from "./support/fake-cloudflare";
import { closeTestRequest, createTestRequest, jobFor, runJob, testTokenKey, uniqueEmail } from "./support/requests";

const db = testDatabase();
const origin = "http://localhost:3000";
let cloudflare: FakeCloudflare;

beforeAll(async () => {
  cloudflare = await startFakeCloudflare();
});

afterAll(async () => {
  await cloudflare.close();
  await db.end();
});

function route(options: { limits?: Partial<LinkResendLimits>; now?: Date } = {}) {
  return createLinkResendRouteHandler(() => ({ appOrigin: origin, db, tokenKey: () => testTokenKey, ...options }));
}

function post(body: unknown) {
  return new Request(`${origin}/api/booking-links/resend`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  });
}

function jobHandler(limits?: Partial<LinkResendLimits>) {
  return createLinkResendHandler(() => ({ limits, origin, tokenKey: testTokenKey, tokenKeys: [testTokenKey] }));
}

async function attemptsFor(email: string) {
  return db<{ id: string; retry_key: string }[]>`
    select id, retry_key from app.link_resend_attempts where address_hash = ${addressHash(testTokenKey, email)}
  `;
}

// Asks for a resend and runs the queued attempt's job, as the worker would.
async function resend(email: string, options: { retryKey?: string; limits?: Partial<LinkResendLimits> } = {}) {
  const retryKey = options.retryKey ?? randomUUID();
  const response = await route()(post({ email, retryKey }));
  const attempt = (await attemptsFor(email)).find((row) => row.retry_key === retryKey);

  if (attempt) {
    const job = await jobFor(db, LINK_RESEND_JOB, `attempt:${attempt.id}`);
    await runJob(db, job!.id, jobHandler(options.limits));
  }

  return response;
}

async function resendDeliveries(requestId: string) {
  return db<{ id: string; state: string }[]>`
    select id, state from app.email_deliveries where request_id = ${requestId} and kind = 'link_resend'
  `;
}

// Moves the request's issuances back in time, past the per-minute limit.
async function age(requestId: string, seconds = 61) {
  await db`
    update app.link_resend_issuances set created_at = created_at - make_interval(secs => ${seconds})
    where request_id = ${requestId}
  `;
}

const roomy = { perRequestHour: 1000, perRequestMinute: 1000, perRecipientHour: 1000, serviceMinute: 1_000_000 };

describe("link resend", () => {
  it("answers an unknown and a confirmed address identically, and emails only the confirmed one", async () => {
    const request = await createTestRequest(db, { confirmed: true });
    const unknown = uniqueEmail("unknown");

    const known = await resend(request.contactEmail);
    const stranger = await resend(unknown);

    expect(known.status).toBe(202);
    expect(stranger.status).toBe(known.status);
    expect(await stranger.json()).toEqual(await known.json());
    expect(known.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await attemptsFor(unknown)).toEqual([]);

    const [delivery] = await resendDeliveries(request.requestId);
    expect(delivery).toBeDefined();
    const job = await jobFor(db, EMAIL_DELIVERY_JOB, `email:${delivery!.id}`);
    await runJob(
      db,
      job!.id,
      createEmailDeliveryHandler(() => ({
        config: { accountId: "a", apiToken: "t", baseUrl: cloudflare.baseUrl, from: "no-reply@findmeatime.com", timeoutMs: 2_000 },
        db,
        env: {},
        tokenKeys: [testTokenKey],
      })),
    );
    const [message] = cloudflare.messagesTo(request.contactEmail);
    expect(message!.text).toContain(`${origin}/booking/${request.bookingId}`);
    expect(message!.text).not.toContain("/booking/confirm/");
  });

  it("sends nothing to an unconfirmed contact or for a closed request", async () => {
    const unconfirmed = await createTestRequest(db);
    const closed = await createTestRequest(db, { confirmed: true });
    await closeTestRequest(db, closed.requestId);

    await resend(unconfirmed.contactEmail);
    await resend(closed.contactEmail);

    expect(await resendDeliveries(unconfirmed.requestId)).toEqual([]);
    expect(await resendDeliveries(closed.requestId)).toEqual([]);
  });

  it("sends nothing for an expired link", async () => {
    const request = await createTestRequest(db, { confirmed: true });
    await db`update app.booking_links set expires_at = now() - interval '1 second' where request_id = ${request.requestId}`;

    await resend(request.contactEmail);

    expect(await resendDeliveries(request.requestId)).toEqual([]);
  });

  it("allows one resend per minute and five per hour per request", async () => {
    const request = await createTestRequest(db, { confirmed: true });

    await resend(request.contactEmail);
    await resend(request.contactEmail);
    expect(await resendDeliveries(request.requestId)).toHaveLength(1);

    for (let index = 0; index < 6; index += 1) {
      await age(request.requestId);
      await resend(request.contactEmail);
    }
    expect(await resendDeliveries(request.requestId)).toHaveLength(5);
  });

  it("allows five resends per recipient in an hour across requests", async () => {
    const address = uniqueEmail("many");
    const requests = [];
    for (let index = 0; index < 6; index += 1) {
      requests.push(await createTestRequest(db, { confirmed: true, contactEmail: address }));
    }

    await resend(address);

    const counts = await Promise.all(requests.map(async (request) => (await resendDeliveries(request.requestId)).length));
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(5);
  });

  it("stops at the service-wide per-minute limit", async () => {
    const [row] = await db<{ count: number }[]>`
      select count(*)::int as count from app.link_resend_issuances where created_at > now() - interval '1 minute'
    `;
    const address = uniqueEmail("service");
    const first = await createTestRequest(db, { confirmed: true, contactEmail: address });
    const second = await createTestRequest(db, { confirmed: true, contactEmail: address });

    await resend(address, { limits: { serviceMinute: row!.count + 1 } });

    const issued = (await resendDeliveries(first.requestId)).length + (await resendDeliveries(second.requestId)).length;
    expect(issued).toBe(1);
  });

  it("answers generically when the attempt budget is spent, and recovers in the next window", async () => {
    // A minute of its own, so earlier runs and other suites never share its slot.
    const minute = new Date(Date.UTC(2001, 0, 1) + randomInt(1_000_000) * 120_000);
    const request = await createTestRequest(db, { confirmed: true });
    const limited = route({ limits: { attemptsPerMinute: 2 }, now: minute });

    const answers = [];
    for (let index = 0; index < 3; index += 1) {
      answers.push(await limited(post({ email: request.contactEmail, retryKey: randomUUID() })));
    }

    expect(answers.map((answer) => answer.status)).toEqual([202, 202, 202]);
    const bodies = await Promise.all(answers.map((answer) => answer.json()));
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(await attemptsFor(request.contactEmail)).toHaveLength(2);

    const next = route({ limits: { attemptsPerMinute: 2 }, now: new Date(minute.getTime() + 60_000) });
    await next(post({ email: request.contactEmail, retryKey: randomUUID() }));
    expect(await attemptsFor(request.contactEmail)).toHaveLength(3);

    await db`delete from app.link_resend_attempts where address_hash = ${addressHash(testTokenKey, request.contactEmail)}`;
  });

  it("creates one delivery for concurrent and retried calls with one retry key", async () => {
    const request = await createTestRequest(db, { confirmed: true });
    const retryKey = randomUUID();

    await Promise.all([1, 2, 3].map(() => route()(post({ email: request.contactEmail, retryKey }))));
    expect(await attemptsFor(request.contactEmail)).toHaveLength(1);

    await resend(request.contactEmail, { limits: roomy, retryKey });
    await resend(request.contactEmail, { limits: roomy, retryKey });

    expect(await resendDeliveries(request.requestId)).toHaveLength(1);
    expect(await attemptsFor(request.contactEmail)).toEqual([]);
  });

  it("refuses an invalid body and a cross-site call", async () => {
    expect((await route()(post({ email: "not an email", retryKey: randomUUID() }))).status).toBe(400);
    const crossSite = await route()(
      new Request(`${origin}/api/booking-links/resend`, {
        body: JSON.stringify({ email: uniqueEmail(), retryKey: randomUUID() }),
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        method: "POST",
      }),
    );
    expect(crossSite.status).toBe(403);
  });
});

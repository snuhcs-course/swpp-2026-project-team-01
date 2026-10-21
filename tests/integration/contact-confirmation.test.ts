import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "../../lib/server/commands";
import {
  type ConfirmationLimits,
  confirmContact,
  issueContactConfirmation,
  readConfirmationStatus,
  resendConfirmationCommand,
  supersedeConfirmations,
} from "../../lib/server/contact-confirmation";
import { createConfirmationStatusHandler, createResendConfirmationHandler } from "../../lib/server/confirmation-routes";
import { createEmailDeliveryHandler, EMAIL_DELIVERY_JOB } from "../../lib/server/email-delivery";
import { testDatabase } from "./support/database";
import { type FakeCloudflare, startFakeCloudflare } from "./support/fake-cloudflare";
import {
  closeTestRequest,
  createTestRequest,
  jobFor,
  runJob,
  testTokenKey,
  type TestRequest,
  uniqueEmail,
} from "./support/requests";

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

function deliveryHandler() {
  return createEmailDeliveryHandler(() => ({
    config: { accountId: "acct", apiToken: "token", baseUrl: cloudflare.baseUrl, from: "no-reply@findmeatime.com", timeoutMs: 2_000 },
    db,
    env: {},
    tokenKeys: [testTokenKey],
  }));
}

async function dispatch(deliveryId: string) {
  const job = await jobFor(db, EMAIL_DELIVERY_JOB, `email:${deliveryId}`);
  await runJob(db, job!.id, deliveryHandler());
}

async function issue(request: TestRequest) {
  const issued = await db.begin((tx) =>
    issueContactConfirmation(tx, { bookingId: request.bookingId, origin, requestId: request.requestId, tokenKey: testTokenKey }),
  );
  await dispatch(issued.deliveryId);
  return issued;
}

function lastMessageTo(address: string) {
  return cloudflare.messagesTo(address).at(-1)!;
}

function tokenIn(text: string) {
  return text.match(/\/booking\/confirm\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

async function requestRow(requestId: string) {
  const [row] = await db<{ contact_confirmed_email: string | null; revision: number; state: string }[]>`
    select contact_confirmed_email, revision, state from app.requests where id = ${requestId}
  `;
  return row!;
}

// Moves every creation email of the request back in time, past the spacing.
async function age(requestId: string, seconds = 61) {
  await db`
    update app.email_deliveries set created_at = created_at - make_interval(secs => ${seconds})
    where request_id = ${requestId} and kind = 'request_creation'
  `;
}

function resend(request: TestRequest, retryKey = randomUUID(), limits?: Partial<ConfirmationLimits>) {
  return runCommand(
    { authenticate: async () => ({ id: request.requestId, kind: "requester_request" }), db },
    resendConfirmationCommand({ limits, origin, tokenKey: testTokenKey }),
    { input: {}, resourceId: request.requestId, retryKey },
  );
}

describe("contact confirmation", () => {
  it("sends the booking link and a single-use confirmation link that confirms only the address", async () => {
    const request = await createTestRequest(db);
    await issue(request);

    const message = lastMessageTo(request.contactEmail);
    expect(message.text).toContain(`${origin}/booking/${request.bookingId}`);
    const token = tokenIn(message.text)!;
    expect(token).toBeTruthy();

    expect(await confirmContact(db, token)).toBe("confirmed");
    expect(await requestRow(request.requestId)).toEqual({
      contact_confirmed_email: request.contactEmail,
      revision: 1,
      state: "gathering",
    });
    expect(await confirmContact(db, token)).toBe("unavailable");
    expect((await readConfirmationStatus(db, request.requestId))?.confirmed).toBe(true);
  });

  it("sends no confirmation link to a Google-verified address", async () => {
    const request = await createTestRequest(db, { confirmed: true });
    const issued = await issue(request);

    expect(issued.confirmationId).toBeNull();
    expect(tokenIn(lastMessageTo(request.contactEmail).text)).toBeNull();
    expect(lastMessageTo(request.contactEmail).text).toContain(`${origin}/booking/${request.bookingId}`);
  });

  it("voids the old link after a contact change, and the new address gets its own email", async () => {
    const request = await createTestRequest(db);
    await issue(request);
    const oldToken = tokenIn(lastMessageTo(request.contactEmail).text)!;
    const newAddress = uniqueEmail("changed");

    await db`update app.requests set contact_email = ${newAddress} where id = ${request.requestId}`;
    await issue({ ...request, contactEmail: newAddress });

    expect(await confirmContact(db, oldToken)).toBe("unavailable");
    expect((await requestRow(request.requestId)).contact_confirmed_email).toBeNull();
    const newToken = tokenIn(lastMessageTo(newAddress).text)!;
    expect(await confirmContact(db, newToken)).toBe("confirmed");
    expect((await requestRow(request.requestId)).contact_confirmed_email).toBe(newAddress);
  });

  it("voids links on closure", async () => {
    const request = await createTestRequest(db);
    const second = await createTestRequest(db);
    await issue(request);
    await issue(second);
    const token = tokenIn(lastMessageTo(request.contactEmail).text)!;
    const secondToken = tokenIn(lastMessageTo(second.contactEmail).text)!;

    await closeTestRequest(db, request.requestId);
    await db.begin((tx) => supersedeConfirmations(tx, second.requestId));

    expect(await confirmContact(db, token)).toBe("unavailable");
    expect(await confirmContact(db, secondToken)).toBe("unavailable");
    expect(await confirmContact(db, "not-a-token")).toBe("unavailable");
  });

  it("spaces creation emails 60 seconds apart and says when the next is allowed", async () => {
    const request = await createTestRequest(db);
    await issue(request);

    const tooSoon = await resend(request);
    expect(tooSoon).toMatchObject({ ok: true, result: { status: "limited" } });
    const retryAt = Date.parse((tooSoon as { result: { retryAt: string } }).result.retryAt);
    expect(retryAt - Date.now()).toBeGreaterThan(50_000);
    expect(retryAt - Date.now()).toBeLessThanOrEqual(60_000);

    await age(request.requestId);
    expect(await resend(request)).toMatchObject({ ok: true, result: { status: "queued" } });
    expect((await readConfirmationStatus(db, request.requestId))?.retryAt).not.toBeNull();
  });

  it("allows 5 resends per request in an hour", async () => {
    const request = await createTestRequest(db);

    for (let index = 0; index < 5; index += 1) {
      expect(await resend(request)).toMatchObject({ result: { status: "queued" } });
      await age(request.requestId);
    }

    expect(await resend(request)).toMatchObject({ result: { status: "limited" } });
  });

  it("allows 10 resends per address in an hour across requests", async () => {
    const address = uniqueEmail("shared");
    const requests = [
      await createTestRequest(db, { contactEmail: address }),
      await createTestRequest(db, { contactEmail: address }),
      await createTestRequest(db, { contactEmail: address }),
    ];

    for (const request of requests.slice(0, 2)) {
      for (let index = 0; index < 5; index += 1) {
        expect(await resend(request)).toMatchObject({ result: { status: "queued" } });
        await age(request.requestId);
      }
    }

    expect(await resend(requests[2]!)).toMatchObject({ result: { status: "limited" } });
  });

  it("stops at the service-wide daily bound", async () => {
    const [row] = await db<{ count: number }[]>`
      select count(*)::int as count from app.email_deliveries
      where kind = 'request_creation' and created_at > now() - interval '24 hours'
    `;
    const limits = { serviceDay: row!.count + 1 };
    const first = await createTestRequest(db);
    const second = await createTestRequest(db);

    expect(await resend(first, randomUUID(), limits)).toMatchObject({ result: { status: "queued" } });
    expect(await resend(second, randomUUID(), limits)).toMatchObject({ result: { status: "limited" } });
  });

  it("counts the email request creation sent toward the per-request bound", async () => {
    const request = await createTestRequest(db);
    await issue(request);
    await age(request.requestId);

    for (let index = 0; index < 4; index += 1) {
      expect(await resend(request)).toMatchObject({ result: { status: "queued" } });
      await age(request.requestId);
    }

    expect(await resend(request)).toMatchObject({ result: { status: "limited" } });
  });

  it("recovers a lost response with the same retry key without a second email", async () => {
    const request = await createTestRequest(db);
    const retryKey = randomUUID();

    const first = await resend(request, retryKey);
    const second = await resend(request, retryKey);

    expect(second).toMatchObject({ ok: true, replayed: true, result: (first as { result: unknown }).result });
    const [row] = await db<{ count: number }[]>`
      select count(*)::int as count from app.email_deliveries where request_id = ${request.requestId}
    `;
    expect(row!.count).toBe(1);
  });

  it("shows an uncertain email as uncertain and does not send it again", async () => {
    const request = await createTestRequest(db);
    cloudflare.setBehavior(request.contactEmail, "drop");
    const issued = await issue(request);
    await dispatch(issued.deliveryId);

    expect(await readConfirmationStatus(db, request.requestId)).toMatchObject({ confirmed: false, delivery: "uncertain" });
    expect(cloudflare.messagesTo(request.contactEmail)).toHaveLength(1);
  });

  it("rejects a resend for a closed request", async () => {
    const request = await createTestRequest(db);
    await closeTestRequest(db, request.requestId);

    expect(await resend(request)).toMatchObject({ error: { category: "forbidden" }, ok: false });
  });
});

describe("contact confirmation routes", () => {
  const deps = () => ({ appOrigin: origin, db, tokenKey: () => testTokenKey });
  const status = createConfirmationStatusHandler(deps);
  const send = createResendConfirmationHandler(deps);
  const context = (bookingId: string) => ({ params: Promise.resolve({ bookingId }) });
  const post = (body: unknown) =>
    new Request(`${origin}/api/requests/x/confirmation`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin },
      method: "POST",
    });

  it("answers with the no-referrer, noindex and no-store headers", async () => {
    const request = await createTestRequest(db);
    const response = await status(new Request(origin), context(request.bookingId));

    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ confirmed: false, delivery: null, retryAt: null });
  });

  it.each([
    ["an unknown", () => randomUUID()],
    ["a malformed", () => "not-a-uuid"],
  ])("gives %s link the generic unavailable answer", async (_label, bookingId) => {
    const response = await send(post({ retryKey: randomUUID() }), context(bookingId()));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "unavailable", error: "This booking link is not available." });
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("gives an expired link and a closed request the same answer", async () => {
    const expired = await createTestRequest(db);
    const closed = await createTestRequest(db);
    await db`update app.booking_links set expires_at = now() - interval '1 second' where request_id = ${expired.requestId}`;
    await closeTestRequest(db, closed.requestId);

    for (const request of [expired, closed]) {
      const response = await status(new Request(origin), context(request.bookingId));
      expect(response.status).toBe(404);
    }
  });

  it("queues a resend and reports a limit with 429", async () => {
    const request = await createTestRequest(db);

    const queued = await send(post({ retryKey: randomUUID() }), context(request.bookingId));
    expect(queued.status).toBe(202);
    const limited = await send(post({ retryKey: randomUUID() }), context(request.bookingId));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ result: { status: "limited" } });
  });

  it("refuses a cross-site resend", async () => {
    const request = await createTestRequest(db);
    const response = await send(
      new Request(`${origin}/api/requests/x/confirmation`, {
        body: "{}",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        method: "POST",
      }),
      context(request.bookingId),
    );

    expect(response.status).toBe(403);
  });
});

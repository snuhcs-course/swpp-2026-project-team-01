import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGrantedScopesFetcher } from "../../lib/server/google-token-info";
import { createIntakeMessageHandler } from "../../lib/server/intake-routes";
import { readRequesterCalendarGrant, REQUESTER_CALENDAR_SCOPES } from "../../lib/server/requester-calendar";
import {
  BINDING_COOKIE,
  createGoogleCallbackHandler,
  createGoogleStartHandler,
  type RequesterGoogleDependencies,
} from "../../lib/server/requester-google";
import { createRevocationHandler, REQUESTER_REVOCATION_JOB } from "../../lib/server/requester-grants";
import { createRequesterCalendarsHandler, createRequesterCommandHandler, createRequesterStateHandler } from "../../lib/server/requester-routes";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { call, guestDependencies, ORIGIN, readyHost, SIGNING_KEY, sourceAddress } from "./support/guests";
import { createTestRequest, jobFor, runJob, testTokenKey, uniqueEmail } from "./support/requests";

// The requester's Google consent (task 3.3) against a fake Google: success with
// and without the Calendar part, cancellation, replay, another browser, an
// expired transaction, a closed request, a different Google address, Use
// verified Google email, two open requests of one Google identity keeping each
// other's grant, Disconnect, and that no auth.users or host_accounts row appears.

const db = testDatabase();
let google: FakeGoogle;
let deps: RequesterGoogleDependencies;
const guest = guestDependencies(db);

beforeAll(async () => {
  google = await startFakeGoogle();
  deps = {
    appOrigin: ORIGIN,
    db,
    fetchGrantedScopes: createGrantedScopesFetcher(google.tokenInfoUrl),
    google: { authUrl: google.authUrl, clientId: "requester-client", clientSecret: "requester-secret", tokenUrl: google.tokenUrl },
    signingKey: SIGNING_KEY,
    tokenKey: testTokenKey,
  };
});

afterAll(async () => {
  await google.close();
  await db.end();
});

const ALL_SCOPES = ["openid", "email", "profile", ...REQUESTER_CALENDAR_SCOPES];

function start(fields: Record<string, string>, source = sourceAddress()) {
  return createGoogleStartHandler(() => deps)(
    new Request(`${ORIGIN}/connections/google/start`, {
      body: new URLSearchParams({ language: "en", timezone: "Asia/Seoul", ...fields }),
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "x-forwarded-for": source },
      method: "POST",
    }),
  );
}

function bindingOf(response: Response) {
  const cookie = response.headers.get("set-cookie") ?? "";
  expect(cookie).toMatch(new RegExp(`^${BINDING_COOKIE}=[^;]+; Path=/connections/google; Max-Age=600; HttpOnly; SameSite=Lax`));
  return cookie.split(";")[0]!;
}

// The consent screen's answer: the callback URL the fake Google redirects to.
async function consent(startResponse: Response) {
  expect(startResponse.status).toBe(303);
  const screen = await fetch(startResponse.headers.get("location")!, { redirect: "manual" });
  return screen.headers.get("location")!;
}

function callback(url: string, cookie?: string) {
  return createGoogleCallbackHandler(() => deps)(
    new Request(url, { headers: { ...(cookie ? { cookie } : {}), "x-forwarded-for": sourceAddress() } }),
  );
}

async function intakeToken(handle: string) {
  const response = await call(createIntakeMessageHandler(() => guest), { handle }, `/api/intake/${handle}/messages`, {
    body: { clientInputId: randomUUID(), language: "en", message: "A coffee chat", timezone: "Asia/Seoul" },
  });
  return ((await response.json()) as { intakeToken: string }).intakeToken;
}

function identity(email = uniqueEmail(), sub = `sub-${randomUUID()}`) {
  return { email, email_verified: true, name: "Grace Hopper", sub };
}

async function hostRows(email: string) {
  const [row] = await db<{ accounts: number; users: number }[]>`
    select (select count(*)::int from auth.users where email = ${email}) as users,
           (select count(*)::int from app.google_identities where email = ${email}) as accounts
  `;
  return row!;
}

async function grants(requestId: string) {
  return db<{ calendar_ids: string[]; has_token: boolean; kind: string; revoked: boolean }[]>`
    select kind, refresh_token_ciphertext is not null as has_token, revoked_at is not null as revoked, calendar_ids
    from app.requester_grants where request_id = ${requestId} order by kind, created_at
  `;
}

async function requestOfBooking(location: string) {
  const bookingId = new URL(location).pathname.split("/").at(-1)!;
  const [row] = await db<{ contact_confirmed_email: string | null; contact_email: string; id: string; requester_name: string }[]>`
    select r.id, r.requester_name, r.contact_email, r.contact_confirmed_email
    from app.requests r join app.booking_links l on l.request_id = r.id
    where l.link_hash = encode(sha256(convert_to(${bookingId}, 'UTF8')), 'hex')
  `;
  return { bookingId, request: row };
}

function command(bookingId: string, operation: string, input: unknown = {}) {
  return call(createRequesterCommandHandler(() => guest), { bookingId }, "/commands", {
    body: { expectedRevision: null, input, operation, retryKey: randomUUID() },
  });
}

describe("Continue with Google from the public page", () => {
  it("creates one request with the Google name and email, a confirmed contact and separate grants, and no account", async () => {
    const host = await readyHost(db);
    const person = identity();
    const refreshToken = `1//requester-${randomUUID()}`;
    google.setConsent({ decision: "approve", identity: person, refreshToken, scopes: ALL_SCOPES });
    google.setFixture(refreshToken, {
      calendars: [
        { accessRole: "owner", id: person.email, primary: true, summary: person.email },
        { accessRole: "owner", id: "side@example.test", summary: "Side project" },
      ],
      events: {},
    });

    const started = await start({ handle: host.handle, intakeToken: await intakeToken(host.handle), purpose: "intake" });
    const authorize = new URL(started.headers.get("location")!);
    expect(authorize.searchParams.get("scope")).toBe(ALL_SCOPES.join(" "));
    expect(Object.fromEntries(["access_type", "prompt", "include_granted_scopes", "code_challenge_method"].map((name) => [name, authorize.searchParams.get(name)]))).toEqual({
      access_type: "offline",
      code_challenge_method: "S256",
      include_granted_scopes: "false",
      prompt: "consent",
    });
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/connections/google/callback`);

    const response = await callback(await consent(started), bindingOf(started));
    expect(response.status).toBe(303);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");

    const { bookingId, request } = await requestOfBooking(response.headers.get("location")!);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/booking/${bookingId}`);
    expect(request).toMatchObject({ contact_confirmed_email: person.email, contact_email: person.email, requester_name: "Grace Hopper" });
    expect(await grants(request!.id)).toEqual([
      { calendar_ids: [], has_token: true, kind: "calendar", revoked: false },
      { calendar_ids: [], has_token: false, kind: "identity", revoked: false },
    ]);
    expect(await hostRows(person.email)).toEqual({ accounts: 0, users: 0 });

    // The token works for this request's own reads, and the primary calendar is preselected.
    const grant = await readRequesterCalendarGrant(db, [testTokenKey], request!.id);
    expect(grant?.refreshToken).toBe(refreshToken);
    const previous = process.env.GOOGLE_CALENDAR_API_URL;
    const previousToken = process.env.GOOGLE_OAUTH_TOKEN_URL;
    process.env.GOOGLE_CALENDAR_API_URL = google.apiBaseUrl;
    process.env.GOOGLE_OAUTH_TOKEN_URL = google.tokenUrl;
    process.env.GOOGLE_REQUESTER_CLIENT_ID = "requester-client";
    process.env.GOOGLE_REQUESTER_CLIENT_SECRET = "requester-secret";
    try {
      const listed = await call(createRequesterCalendarsHandler(() => guest), { bookingId }, "/calendars");
      expect(await listed.json()).toEqual({
        calendars: [
          { id: person.email, primary: true, selected: true, summary: person.email },
          { id: "side@example.test", primary: false, selected: false, summary: "Side project" },
        ],
      });

      // Only IDs on the requester's own calendar list are accepted.
      const unknown = await command(bookingId, "calendar.select", { calendarIds: ["side@example.test", "someone-else@example.test"] });
      expect(unknown.status).toBe(400);
      expect((await grants(request!.id))[0]!.calendar_ids).toEqual([]);

      const chosen = await command(bookingId, "calendar.select", { calendarIds: ["side@example.test"] });
      expect(chosen.status).toBe(200);
      expect((await grants(request!.id))[0]!.calendar_ids).toEqual(["side@example.test"]);
    } finally {
      process.env.GOOGLE_CALENDAR_API_URL = previous;
      process.env.GOOGLE_OAUTH_TOKEN_URL = previousToken;
    }

    // The creation email goes out without a confirmation link.
    const [confirmations] = await db<{ count: number }[]>`
      select count(*)::int as count from app.contact_confirmations where request_id = ${request!.id}
    `;
    expect(confirmations!.count).toBe(0);
  });

  it("records identity only when the Calendar part is unchecked", async () => {
    const host = await readyHost(db);
    google.setConsent({ decision: "approve", identity: identity(), scopes: ["openid", "email", "profile"] });
    const started = await start({ handle: host.handle, purpose: "intake" });
    const response = await callback(await consent(started), bindingOf(started));
    const { bookingId, request } = await requestOfBooking(response.headers.get("location")!);

    expect((await grants(request!.id)).map((grant) => grant.kind)).toEqual(["identity"]);
    const state = await call(createRequesterStateHandler(() => guest), { bookingId }, "/state");
    expect(await state.json()).toMatchObject({ connection: { calendar: false, identity: true } });
  });

  it("returns a cancelled consent to the public page with nothing recorded", async () => {
    const host = await readyHost(db);
    google.setConsent({ decision: "deny" });
    const started = await start({ handle: host.handle, intakeToken: await intakeToken(host.handle), purpose: "intake" });
    const response = await callback(await consent(started), bindingOf(started));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/${host.handle}?google=cancelled`);
    const [counts] = await db<{ open: number; requests: number }[]>`
      select (select count(*)::int from app.requests where host_account_id = ${host.hostAccountId}) as requests,
             (select count(*)::int from app.intakes where host_account_id = ${host.hostAccountId} and closed_at is null) as open
    `;
    expect(counts).toEqual({ open: 1, requests: 0 });
  });

  it("changes nothing on a replay, in another browser or after the transaction expired", async () => {
    const host = await readyHost(db);
    google.setConsent({ decision: "approve", identity: identity(), scopes: ALL_SCOPES });

    // Another browser: no binding cookie, or another one. Nothing is consumed.
    const started = await start({ handle: host.handle, purpose: "intake" });
    const url = await consent(started);
    for (const cookie of [undefined, `${BINDING_COOKIE}=someone-else`]) {
      const other = await callback(url, cookie);
      expect(other.status).toBe(400);
      expect(await other.text()).toContain(`href="/${host.handle}"`);
    }

    const first = await callback(url, bindingOf(started));
    expect(first.status).toBe(303);
    const replay = await callback(url, bindingOf(started));
    expect(replay.status).toBe(400);
    expect(await replay.text()).not.toMatch(/booking\//);

    // An expired transaction.
    const late = await start({ handle: host.handle, purpose: "intake" });
    const lateUrl = await consent(late);
    await db`update app.requester_oauth_transactions set expires_at = now() - interval '1 second' where host_account_id = ${host.hostAccountId} and consumed_at is null`;
    expect((await callback(lateUrl, bindingOf(late))).status).toBe(400);

    const [count] = await db<{ count: number }[]>`select count(*)::int as count from app.requests where host_account_id = ${host.hostAccountId}`;
    expect(count!.count).toBe(1);
  });
});

describe("Connect Google Calendar on an existing request", () => {
  it("records the grants, returns to the booking link, and leaves a different Google address as the contact", async () => {
    const request = await createTestRequest(db);
    google.setConsent({ decision: "approve", identity: identity(), scopes: ALL_SCOPES });
    const started = await start({ bookingId: request.bookingId, purpose: "request" });
    const response = await callback(await consent(started), bindingOf(started));

    expect(response.headers.get("location")).toBe(`${ORIGIN}/booking/${request.bookingId}?google=connected`);
    expect((await grants(request.requestId)).map((grant) => grant.kind)).toEqual(["calendar", "identity"]);
    const [row] = await db<{ confirmed: string | null; email: string }[]>`
      select contact_email as email, contact_confirmed_email as confirmed from app.requests where id = ${request.requestId}
    `;
    expect(row).toEqual({ confirmed: null, email: request.contactEmail });
    const state = await call(createRequesterStateHandler(() => guest), { bookingId: request.bookingId }, "/state");
    expect(await state.json()).toMatchObject({ connection: { canUseGoogleEmail: false } });
    expect((await command(request.bookingId, "contact.use_google_email")).status).toBe(400);
  });

  it("confirms a matching contact with Use verified Google email and nothing else", async () => {
    const request = await createTestRequest(db);
    google.setConsent({ decision: "approve", identity: identity(request.contactEmail), scopes: ["openid", "email", "profile"] });
    const started = await start({ bookingId: request.bookingId, purpose: "request" });
    await callback(await consent(started), bindingOf(started));

    const state = await call(createRequesterStateHandler(() => guest), { bookingId: request.bookingId }, "/state");
    expect(await state.json()).toMatchObject({ connection: { canUseGoogleEmail: true }, contact: { confirmed: false } });
    expect((await command(request.bookingId, "contact.use_google_email")).status).toBe(200);
    const [row] = await db<{ confirmed: string | null; revision: number }[]>`
      select contact_confirmed_email as confirmed, revision from app.requests where id = ${request.requestId}
    `;
    expect(row).toEqual({ confirmed: request.contactEmail, revision: 1 });
  });

  it("refuses to start or finish for a closed request", async () => {
    const request = await createTestRequest(db);
    google.setConsent({ decision: "approve", identity: identity(), scopes: ALL_SCOPES });
    const started = await start({ bookingId: request.bookingId, purpose: "request" });
    const url = await consent(started);
    await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${request.requestId}`;

    expect((await callback(url, bindingOf(started))).status).toBe(400);
    expect(await grants(request.requestId)).toEqual([]);
    expect((await start({ bookingId: request.bookingId, purpose: "request" })).status).toBe(404);
  });

  it("replaces a grant of the same identity without revoking the new token at Google", async () => {
    const request = await createTestRequest(db);
    const person = identity();

    for (const refreshToken of ["1//first", "1//second"].map((token) => `${token}-${request.requestId}`)) {
      google.setConsent({ decision: "approve", identity: person, refreshToken, scopes: ALL_SCOPES });
      const started = await start({ bookingId: request.bookingId, purpose: "request" });
      await callback(await consent(started), bindingOf(started));
    }

    const closed = await db<{ id: string; provider_revocation: string | null }[]>`
      select id, provider_revocation from app.requester_grants
      where request_id = ${request.requestId} and kind = 'calendar' and revoked_at is not null
    `;
    expect(closed).toHaveLength(1);
    expect(closed[0]!.provider_revocation).toBe("not_needed");
    expect(await jobFor(db, REQUESTER_REVOCATION_JOB, `grant:${closed[0]!.id}`)).toBeFalsy();
    expect(await readRequesterCalendarGrant(db, [testTokenKey], request.requestId)).toMatchObject({
      refreshToken: `1//second-${request.requestId}`,
    });

    // Another identity replacing it still revokes the old token at Google.
    google.setConsent({ decision: "approve", identity: identity(), refreshToken: `1//other-${request.requestId}`, scopes: ALL_SCOPES });
    const started = await start({ bookingId: request.bookingId, purpose: "request" });
    await callback(await consent(started), bindingOf(started));
    const [replaced] = await db<{ id: string }[]>`
      select id from app.requester_grants
      where request_id = ${request.requestId} and kind = 'calendar' and revoked_at is not null and provider_revocation is null
    `;
    expect(await jobFor(db, REQUESTER_REVOCATION_JOB, `grant:${replaced!.id}`)).toBeTruthy();
  });

  it("keeps another open request's grant of the same identity, and revokes at Google only for the last one", async () => {
    const person = identity();
    const [one, two] = await Promise.all([createTestRequest(db), createTestRequest(db)]);

    for (const request of [one, two]) {
      google.setConsent({ decision: "approve", identity: person, refreshToken: `1//shared-${request.requestId}`, scopes: ALL_SCOPES });
      const started = await start({ bookingId: request.bookingId, purpose: "request" });
      await callback(await consent(started), bindingOf(started));
    }

    // Withdrawing one deletes its token; the other request still holds one, so Google is not asked.
    await call(createRequesterCommandHandler(() => guest), { bookingId: one.bookingId }, "/commands", {
      body: { expectedRevision: 1, input: {}, operation: "request.withdraw", retryKey: randomUUID() },
    });
    expect((await grants(one.requestId)).every((grant) => grant.revoked && !grant.has_token)).toBe(true);
    expect((await grants(two.requestId)).find((grant) => grant.kind === "calendar")).toMatchObject({ has_token: true, revoked: false });
    const [skipped] = await db<{ provider_revocation: string }[]>`
      select provider_revocation from app.requester_grants where request_id = ${one.requestId} and kind = 'calendar'
    `;
    expect(skipped!.provider_revocation).toBe("not_needed");
    expect(await readRequesterCalendarGrant(db, [testTokenKey], two.requestId)).toMatchObject({ refreshToken: `1//shared-${two.requestId}` });

    // Disconnect on the last one revokes at Google, by a job that keeps no copy of the token.
    expect((await command(two.bookingId, "calendar.disconnect")).status).toBe(200);
    const [calendarGrant] = await db<{ id: string }[]>`
      select id from app.requester_grants where request_id = ${two.requestId} and kind = 'calendar'
    `;
    const job = await jobFor(db, REQUESTER_REVOCATION_JOB, `grant:${calendarGrant!.id}`);
    await runJob(db, job!.id, createRevocationHandler(() => ({ revokeUrl: google.revokeUrl, tokenKeys: [testTokenKey] })));
    expect(google.revocations).toContain(`1//shared-${two.requestId}`);
    const [after] = await db<{ payload: Record<string, unknown>; provider_revocation: string }[]>`
      select j.payload, g.provider_revocation from app.jobs j join app.requester_grants g on g.id = ${calendarGrant!.id}
      where j.id = ${job!.id}
    `;
    expect(after!.provider_revocation).toBe("revoked");
    expect(Object.keys(after!.payload).sort()).toEqual(["grantId", "requestId"]);
    expect(await hostRows(person.email)).toEqual({ accounts: 0, users: 0 });
  });
});

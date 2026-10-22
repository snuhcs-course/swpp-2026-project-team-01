import { randomUUID } from "node:crypto";
import { GOOGLE_CALENDAR_SCOPES } from "../../../lib/contracts/google-scopes";
import { hashBookingId, sealBookingLink } from "../../../lib/server/booking-links";
import { BOOKING_JOB, createBookingHandler } from "../../../lib/server/bookings";
import type { Database } from "../../../lib/server/database";
import { recordGoogleGrant } from "../../../lib/server/provider-grants";
import { parseTokenKey } from "../../../lib/server/token-encryption";
import { runJob } from "../../integration/support/calendar-host";
import { makeHostReady, uniqueHandle } from "../../integration/support/ready-host";
import { MONDAY, seoul, settingsFor } from "../../integration/support/scheduling";
import { E2E_TOKEN_ENCRYPTION_KEY } from "./token-key";

// Helpers for the host review journey: the signed-in host made ready in SQL
// with a Calendar grant sealed with the run's key against the fake Google, a
// request already agreed by its requester (as the requester's commands leave
// it), and the booking job run by the test through the real handler, since the
// job worker runs only in production.

const FAKE_GOOGLE_ORIGIN = `http://127.0.0.1:${process.env.FAKE_GOOGLE_PORT ?? "3103"}`;
const FAKE_ROUTES_ORIGIN = `http://127.0.0.1:${process.env.FAKE_ROUTES_PORT ?? "3105"}`;
const tokenKey = parseTokenKey(E2E_TOKEN_ENCRYPTION_KEY);

const calendarConfig = {
  apiBaseUrl: `${FAKE_GOOGLE_ORIGIN}/calendar/v3`,
  clientId: "e2e-google-client",
  clientSecret: "e2e-google-secret",
  timeoutMs: 10_000,
  tokenUrl: `${FAKE_GOOGLE_ORIGIN}/token`,
};

export async function readyReviewHost(db: Database, hostAccountId: string, displayName = "Ada Lovelace") {
  const handle = uniqueHandle("ada");
  await makeHostReady(db, hostAccountId, { displayName, handle });

  const calendarId = `host-${randomUUID()}@example.test`;
  const refreshToken = `1//e2e-review-${randomUUID()}`;
  const fixture = await fetch(`${FAKE_GOOGLE_ORIGIN}/__fixture/${encodeURIComponent(refreshToken)}`, {
    body: JSON.stringify({
      calendars: [
        { accessRole: "owner", conferenceSolutionTypes: ["hangoutsMeet"], id: calendarId, primary: true, summary: "Work", timeZone: "Asia/Seoul" },
      ],
      events: { [calendarId]: [] },
    }),
    method: "POST",
  });
  if (!fixture.ok) throw new Error(`Posting the fake Google fixture failed with ${fixture.status}.`);

  await recordGoogleGrant(db, tokenKey, { grantedScopes: [...GOOGLE_CALENDAR_SCOPES], hostAccountId, refreshToken });
  await db`
    update app.host_settings
    set settings = ${db.json(settingsFor(calendarId, { displayName, handle }) as never)}
    where host_account_id = ${hostAccountId}
  `;

  return { calendarId };
}

// A request awaiting the host's approval: an online meeting on the coming
// Monday at 10:00 in Seoul, with Google Meet, agreed by Grace Hopper.
export async function agreedReviewRequest(db: Database, hostAccountId: string) {
  const bookingId = randomUUID();
  const start = seoul("10:00");
  const end = seoul("10:30");
  const details = {
    durationMinutes: 30,
    language: "en",
    linkPlan: { kind: "google_meet" },
    location: null,
    mode: "online",
    purpose: "Talk about compilers",
    timezone: "Asia/Seoul",
    travelMode: null,
    windows: [{ end: seoul("12:00"), start: seoul("10:00") }],
  };
  const [request] = await db<{ id: string }[]>`
    insert into app.requests (host_account_id, details, requester_name, contact_email, expires_at, state, revision)
    values (${hostAccountId}, ${db.json(details as never)}, 'Grace Hopper', ${`grace-${randomUUID().slice(0, 8)}@example.test`},
            now() + interval '7 days', 'awaiting_host_approval', 2)
    returning id
  `;
  const sealed = sealBookingLink(tokenKey, request!.id, bookingId);
  await db`
    insert into app.booking_links (request_id, link_hash, link_ciphertext, link_key_id)
    values (${request!.id}, ${hashBookingId(bookingId)}, ${sealed.ciphertext}, ${sealed.keyId})
  `;
  await db`insert into app.discussions (principal_type, principal_id, audience) values ('requester_request', ${request!.id}, 'requester')`;
  const [settings] = await db<{ revision: number }[]>`select revision from app.host_settings where host_account_id = ${hostAccountId}`;
  const [evaluation] = await db<{ id: string }[]>`
    insert into app.evaluations (request_id, request_revision, settings_revision, state, completed_at, candidates)
    values (${request!.id}, 1, ${settings!.revision}, 'completed', now(), '[]'::jsonb)
    returning id
  `;
  const proposal = {
    displayTimezones: ["Asia/Seoul"],
    durationMinutes: 30,
    end,
    linkPlan: { kind: "google_meet" },
    location: null,
    mode: "online",
    participants: [
      { name: "Ada Lovelace", role: "host" },
      { name: "Grace Hopper", role: "requester" },
    ],
    start,
  };
  const [row] = await db<{ id: string }[]>`
    insert into app.proposals (request_id, version, evaluation_id, candidate_id, start_at, end_at, details)
    values (${request!.id}, 1, ${evaluation!.id}, 'c1', ${start}, ${end}, ${db.json(proposal as never)})
    returning id
  `;
  await db`insert into app.agreements (proposal_id, request_revision, retry_key) values (${row!.id}, 1, 'e2e')`;

  return { bookingId, monday: MONDAY, requestId: request!.id };
}

// Runs the request's pending booking job through the real handler.
export async function runBookings(db: Database, requestId: string, origin: string) {
  const pending = await db<{ id: string }[]>`
    select j.id from app.jobs j join app.bookings b on b.id = (j.payload ->> 'bookingId')::uuid
    where j.kind = ${BOOKING_JOB} and j.state = 'pending' and b.request_id = ${requestId}
  `;
  const handler = createBookingHandler(() => ({
    calendar: calendarConfig,
    db,
    evaluation: {
      calendar: calendarConfig,
      db,
      model: null,
      requesterCalendar: calendarConfig,
      routes: { apiKey: "fake-routes-key", baseUrl: FAKE_ROUTES_ORIGIN, timeoutMs: 5_000 },
      tokenKeys: [tokenKey],
    },
    notices: { origin, tokenKey, tokenKeys: [tokenKey] },
    tokenKeys: [tokenKey],
  }));

  for (const job of pending) await runJob(db, job.id, handler);
  return pending.length;
}

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConfirmedSettings } from "../../lib/contracts/setup";
import type { Database } from "../../lib/server/database";
import { awaitEvaluation, publishEvaluation } from "../../lib/server/evaluation";
import { readHostRequest } from "../../lib/server/host-requests";
import { closeRequest } from "../../lib/server/request-lifecycle";
import { REQUESTER_CALENDAR_SCOPES, requesterGrantContext } from "../../lib/server/requester-calendar";
import { decideHostProfileCommand, recordHostProfileMatch } from "../../lib/server/requester-host-profiles";
import { sealToken } from "../../lib/server/token-encryption";
import { createCalendarHost } from "./support/calendar-host";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import {
  asRequester,
  busy,
  calendarKey,
  evaluationDeps,
  runEvaluation,
  seedSchedulingRequest,
  seoul,
  settingsFor,
} from "./support/scheduling";

// A guest who is also a host (guest-flow-completion design 6, tasks 6.1, 6.2,
// 6.4 and 6.5): the match by Google subject only, never the request's own host;
// the card's choice per request; their host conflict calendars as the guest's
// busy time inside the evaluation, together with a calendar connected for the
// request; a failed host grant reopening the Calendar step; basic details as a
// pending review; nothing reaching the request's host;
// deletion at closure.

const db = testDatabase();
let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
});

afterAll(async () => {
  await google.close();
  await db.end();
});

// Another host, ready with confirmed settings and a Calendar grant whose conflict
// calendar has `events`.
async function guestHost(options: { events?: ReturnType<typeof busy>[]; settings?: Partial<ConfirmedSettings> } = {}) {
  const host = await createCalendarHost(db, calendarKey);
  google.setFixture(host.refreshToken!, {
    calendars: [{ accessRole: "owner", id: host.email, primary: true, summary: "Work" }],
    events: { [host.email]: options.events ?? [] },
  });
  await db`
    insert into app.host_settings (host_account_id, settings, draft_revision)
    values (${host.hostAccountId}, ${db.json(settingsFor(host.email, options.settings) as never)}, 1)
  `;
  const [identity] = await db<{ google_subject: string }[]>`
    select google_subject from app.google_identities where host_account_id = ${host.hostAccountId}
  `;
  return { ...host, subject: identity!.google_subject };
}

function match(database: Database, requestId: string, subject: string) {
  return database.begin((tx) => recordHostProfileMatch(tx, requestId, subject));
}

async function profileOf(requestId: string) {
  const [row] = await db<{ decided: boolean; host_account_id: string; items: string[] }[]>`
    select host_account_id, items, decided_at is not null as decided from app.requester_host_profiles where request_id = ${requestId}
  `;
  return row ?? null;
}

// A Calendar the guest connected for this request, busy at `events`.
async function connectRequestCalendar(requestId: string, events: ReturnType<typeof busy>[]) {
  const refreshToken = `1//requester-${randomUUID()}`;
  const calendarId = `requester-${randomUUID()}@example.test`;
  const sealed = sealToken(calendarKey, refreshToken, requesterGrantContext(requestId));
  google.setFixture(refreshToken, { calendars: [{ accessRole: "owner", id: calendarId, primary: true, summary: "Me" }], events: { [calendarId]: events } });
  await db`
    insert into app.requester_grants
      (request_id, kind, google_subject_hash, google_email, email_verified, granted_scopes,
       refresh_token_ciphertext, refresh_token_key_id, calendar_ids)
    values (${requestId}, 'calendar', ${randomUUID()}, 'grace@example.test', true, ${[...REQUESTER_CALENDAR_SCOPES]},
            ${sealed.ciphertext}, ${sealed.keyId}, ${[calendarId]})
  `;
}

async function evaluateOnce(requestId: string) {
  const deps = evaluationDeps(db, google);
  const { evaluationId } = await db.begin((tx) => publishEvaluation(tx, { audience: "requester", requestId, retryKey: randomUUID() }));
  await runEvaluation(db, deps, evaluationId);
  return awaitEvaluation(db, evaluationId, 1_000);
}

describe("matching a guest to a host account", () => {
  it("matches by the verified Google subject only", async () => {
    const request = await seedSchedulingRequest(db, google);
    const other = await guestHost();

    await match(db, request.requestId, `sub-${randomUUID()}`);
    expect(await profileOf(request.requestId)).toBeNull();

    await match(db, request.requestId, other.subject);
    expect(await profileOf(request.requestId)).toEqual({ decided: false, host_account_id: other.hostAccountId, items: [] });
  });

  it("does not match the request's own host, a suspended host or a host without confirmed settings", async () => {
    const request = await seedSchedulingRequest(db, google);
    const [own] = await db<{ google_subject: string }[]>`
      select google_subject from app.google_identities where host_account_id = ${request.hostAccountId}
    `;
    await match(db, request.requestId, own!.google_subject);
    expect(await profileOf(request.requestId)).toBeNull();

    const suspended = await guestHost();
    await db`update app.host_accounts set status = 'suspended' where id = ${suspended.hostAccountId}`;
    await match(db, request.requestId, suspended.subject);
    expect(await profileOf(request.requestId)).toBeNull();

    const unready = await createCalendarHost(db, calendarKey);
    const [subject] = await db<{ google_subject: string }[]>`
      select google_subject from app.google_identities where host_account_id = ${unready.hostAccountId}
    `;
    await match(db, request.requestId, subject!.google_subject);
    expect(await profileOf(request.requestId)).toBeNull();
  });

  it("keeps the first match and its decision on a later Google return", async () => {
    const request = await seedSchedulingRequest(db, google);
    const other = await guestHost();
    await match(db, request.requestId, other.subject);
    expect((await asRequester(db, request.requestId, decideHostProfileCommand(), { items: [] })).ok).toBe(true);

    await match(db, request.requestId, other.subject);
    expect(await profileOf(request.requestId)).toMatchObject({ decided: true, items: [] });
  });
});

describe("the guest's choice", () => {
  it("uses only the checked items: Calendars settles the Calendar step and drafts no review", async () => {
    const request = await seedSchedulingRequest(db, google);
    const other = await guestHost({ settings: { timezone: "Europe/London", travelMode: "driving" } });
    await match(db, request.requestId, other.subject);

    expect((await asRequester(db, request.requestId, decideHostProfileCommand(), { items: ["calendars"] })).ok).toBe(true);
    expect(await profileOf(request.requestId)).toMatchObject({ decided: true, items: ["calendars"] });
    const [row] = await db<{ pending: number; settled: boolean }[]>`
      select calendar_settled_at is not null as settled,
             (select count(*)::int from app.request_reviews where request_id = ${request.requestId} and state = 'pending') as pending
      from app.requests where id = ${request.requestId}
    `;
    expect(row).toEqual({ pending: 0, settled: true });
  });

  it("drafts Basic details as a pending review, so the request changes only when the guest applies it", async () => {
    const request = await seedSchedulingRequest(db, google);
    const other = await guestHost({ settings: { timezone: "Europe/London", travelMode: "driving" } });
    await match(db, request.requestId, other.subject);

    expect((await asRequester(db, request.requestId, decideHostProfileCommand(), { items: ["details"] })).ok).toBe(true);
    const reviews = await db<{ intent: string; patch: unknown }[]>`
      select intent, patch from app.request_reviews where request_id = ${request.requestId} and state = 'pending'
    `;
    expect(reviews).toEqual([{ intent: "details", patch: { timezone: "Europe/London", travelMode: "driving" } }]);
    const [details] = await db<{ timezone: string }[]>`select details ->> 'timezone' as timezone from app.requests where id = ${request.requestId}`;
    expect(details!.timezone).toBe("Asia/Seoul");
  });

  it("refuses a decision for a request with no match", async () => {
    const request = await seedSchedulingRequest(db, google);
    const outcome = await asRequester(db, request.requestId, decideHostProfileCommand(), { items: ["calendars"] });
    expect(outcome).toMatchObject({ ok: false });
  });
});

describe("the guest-host's calendars in the evaluation", () => {
  it("leaves out times their host conflict calendar is busy, and the request's host sees nothing of it", async () => {
    const request = await seedSchedulingRequest(db, google);
    const other = await guestHost({ events: [busy("10:00", "10:30")] });
    await match(db, request.requestId, other.subject);
    await asRequester(db, request.requestId, decideHostProfileCommand(), { items: ["calendars"] });

    const view = await evaluateOnce(request.requestId);
    expect(view!.state).toBe("completed");
    const starts = view!.candidates.map((candidate) => candidate.start);
    expect(starts).not.toContain(seoul("10:00"));
    expect(starts).toContain(seoul("10:30"));

    const hostView = JSON.stringify(await readHostRequest(db, request.hostAccountId, request.requestId));
    expect(hostView).not.toContain(other.email);
    expect(hostView).not.toContain(other.hostAccountId);
  });

  it("counts both their host calendars and a calendar connected for the request", async () => {
    const request = await seedSchedulingRequest(db, google, { details: { windows: [{ end: seoul("12:00"), start: seoul("10:00") }] } });
    const other = await guestHost({ events: [busy("10:30", "11:00")] });
    await match(db, request.requestId, other.subject);
    await asRequester(db, request.requestId, decideHostProfileCommand(), { items: ["calendars"] });
    await connectRequestCalendar(request.requestId, [busy("10:00", "10:30")]);

    const starts = (await evaluateOnce(request.requestId))!.candidates.map((candidate) => candidate.start);
    expect(starts).not.toContain(seoul("10:00"));
    expect(starts).not.toContain(seoul("10:30"));
    expect(starts).toContain(seoul("11:00"));
  });

  it("ignores their calendars when the guest did not choose Calendars", async () => {
    const request = await seedSchedulingRequest(db, google);
    const other = await guestHost({ events: [busy("10:00", "10:30")] });
    await match(db, request.requestId, other.subject);
    await asRequester(db, request.requestId, decideHostProfileCommand(), { items: ["details"] });

    const view = await evaluateOnce(request.requestId);
    expect(view!.candidates.map((candidate) => candidate.start)).toContain(seoul("10:00"));
  });

  it("pauses on a revoked host grant: the item is dropped, the Calendar step reopens and no time is offered", async () => {
    const request = await seedSchedulingRequest(db, google);
    const other = await guestHost({ events: [busy("10:00", "10:30")] });
    await match(db, request.requestId, other.subject);
    await asRequester(db, request.requestId, decideHostProfileCommand(), { items: ["calendars"] });
    google.setFixture(other.refreshToken!, { calendars: [], events: {}, revoked: true });

    const view = await evaluateOnce(request.requestId);
    expect(view).toMatchObject({ candidates: [], failure: "requester_calendar_unavailable", state: "failed" });
    expect(await profileOf(request.requestId)).toMatchObject({ items: [] });
    const [row] = await db<{ settled: boolean }[]>`
      select calendar_settled_at is not null as settled from app.requests where id = ${request.requestId}
    `;
    expect(row!.settled).toBe(false);
  });
});

describe("closure", () => {
  it("deletes the choice when the request closes", async () => {
    const request = await seedSchedulingRequest(db, google);
    const other = await guestHost();
    await match(db, request.requestId, other.subject);
    await asRequester(db, request.requestId, decideHostProfileCommand(), { items: ["calendars"] });

    await db.begin((tx) => closeRequest(tx, request.requestId, "withdrawn"));
    expect(await profileOf(request.requestId)).toBeNull();
  });
});

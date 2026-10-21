import { randomBytes, randomUUID } from "node:crypto";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConfirmedSettings } from "../../lib/contracts/setup";
import {
  awaitEvaluation,
  createEvaluationHandler,
  EVALUATION_JOB,
  type EvaluationDependencies,
  publishEvaluation,
  readHostEvaluation,
} from "../../lib/server/evaluation";
import { REQUESTER_CALENDAR_SCOPES, requesterGrantContext } from "../../lib/server/requester-calendar";
import { parseTokenKey, sealToken } from "../../lib/server/token-encryption";
import { createCalendarHost, fakeGoogleConfig, runJob } from "./support/calendar-host";
import { testDatabase } from "./support/database";
import { type FakeEvent, type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { FAKE_ROUTES_API_KEY, type FakeRoutes, startFakeRoutes } from "./support/fake-routes";

// The evaluation job against fake Google Calendar, fake Routes and a mock model.
// Every test seeds its own host, request and Google fixtures, so suites sharing
// the local database never see each other's rows; jobs are run one by one with
// runJob rather than claimed, so no other suite's jobs are touched.

const db = testDatabase();
const key = parseTokenKey(randomBytes(32).toString("base64"));
let google: FakeGoogle;
let routes: FakeRoutes;

beforeAll(async () => {
  google = await startFakeGoogle();
  routes = await startFakeRoutes();
});

afterAll(async () => {
  await google.close();
  await routes.close();
  await db.end();
});

// A Monday in Asia/Seoul at least a week ahead, so every window is in the future.
function futureMonday() {
  const day = new Date(Date.now() + 8 * 86_400_000);
  const shift = (8 - day.getUTCDay()) % 7;
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + shift)).toISOString().slice(0, 10);
}

const MONDAY = futureMonday();
const at = (clock: string, date = MONDAY) => new Date(`${date}T${clock}:00+09:00`);
const iso = (clock: string) => at(clock).toISOString();

function settingsFor(calendarId: string, overrides: Partial<ConfirmedSettings> = {}): ConfirmedSettings {
  return {
    bookingCalendar: { accessRole: "owner", id: calendarId, summary: "Work", verifiedAt: new Date().toISOString() },
    bufferAfterMinutes: 10,
    bufferBeforeMinutes: 10,
    conflictCalendars: [{ accessRole: "owner", id: calendarId, primary: true, summary: "Work" }],
    displayName: "Ada Lovelace",
    durationMinutes: 30,
    handle: `ada-${randomUUID().slice(0, 8)}`,
    location: { kind: "decide_per_meeting" },
    meetingMode: "either",
    noteExclusions: [],
    provenance: {},
    timezone: "Asia/Seoul",
    travelBufferMinutes: 15,
    travelMode: "transit",
    weeklyLimit: null,
    weeklyWindows: (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map((weekday) => ({
      end: "17:00",
      start: "10:00",
      weekday,
    })),
    ...overrides,
  };
}

async function seedHost(options: { events?: FakeEvent[]; settings?: Partial<ConfirmedSettings>; stallPageToken?: string } = {}) {
  const host = await createCalendarHost(db, key);
  const calendarId = host.email;
  google.setFixture(host.refreshToken!, {
    calendars: [
      { accessRole: "owner", conferenceSolutionTypes: ["hangoutsMeet"], id: calendarId, primary: true, summary: "Work" },
    ],
    events: { [calendarId]: options.events ?? [] },
    ...(options.stallPageToken ? { stallPageToken: options.stallPageToken } : {}),
  });
  await db`
    insert into app.host_settings (host_account_id, settings, draft_revision)
    values (${host.hostAccountId}, ${db.json(settingsFor(calendarId, options.settings) as never)}, 1)
  `;
  return { ...host, calendarId };
}

async function seedRequest(hostAccountId: string, details: Record<string, unknown> = {}) {
  const [row] = await db<{ id: string }[]>`
    insert into app.requests (host_account_id, requester_name, contact_email, expires_at, details)
    values (
      ${hostAccountId}, 'Grace Hopper', ${`grace-${randomUUID()}@example.test`}, now() + interval '7 days',
      ${db.json({
        durationMinutes: 30,
        language: "en",
        linkPlan: null,
        location: null,
        mode: "online",
        purpose: "Talk about compilers",
        timezone: "Asia/Seoul",
        travelMode: null,
        windows: [{ end: iso("13:00"), start: iso("10:00") }],
        ...details,
      } as never)}
    )
    returning id
  `;
  return row!.id;
}

async function seedRequesterCalendar(requestId: string, events: FakeEvent[], refreshToken = `1//requester-${randomUUID()}`) {
  const calendarId = `requester-${randomUUID()}@example.test`;
  const sealed = sealToken(key, refreshToken, requesterGrantContext(requestId));
  google.setFixture(refreshToken, {
    calendars: [{ accessRole: "owner", id: calendarId, primary: true, summary: "Me" }],
    events: { [calendarId]: events },
  });
  await db`
    insert into app.requester_grants
      (request_id, kind, google_subject_hash, google_email, email_verified, granted_scopes,
       refresh_token_ciphertext, refresh_token_key_id, calendar_ids)
    values (
      ${requestId}, 'calendar', ${randomUUID()}, 'grace@example.test', true, ${[...REQUESTER_CALENDAR_SCOPES]},
      ${sealed.ciphertext}, ${sealed.keyId}, ${[calendarId]}
    )
  `;
  return calendarId;
}

function deps(overrides: Partial<EvaluationDependencies> = {}): EvaluationDependencies {
  return {
    calendar: fakeGoogleConfig(google),
    db,
    limits: { anonymousWindowUsd: "1000000.00", serviceWindowUsd: "1000000.00" },
    model: null,
    requesterCalendar: fakeGoogleConfig(google),
    routes: { apiKey: FAKE_ROUTES_API_KEY, baseUrl: routes.baseUrl, timeoutMs: 5_000 },
    tokenKeys: [key],
    ...overrides,
  };
}

async function publish(requestId: string, retryKey: string = randomUUID()) {
  return db.begin((tx) => publishEvaluation(tx, { audience: "requester", requestId, retryKey }));
}

async function evaluate(requestId: string, dependencies = deps(), retryKey: string = randomUUID()) {
  const { evaluationId } = await publish(requestId, retryKey);
  const [job] = await db<{ id: string }[]>`
    select id from app.jobs where kind = ${EVALUATION_JOB} and dedupe_key = ${`${EVALUATION_JOB}:${requestId}:${retryKey}`}
  `;
  const started = Date.now();
  const result = await runJob(db, job!.id, createEvaluationHandler(() => dependencies));
  return { elapsed: Date.now() - started, evaluationId, result };
}

async function storedRow(evaluationId: string) {
  const [row] = await db<{ row: string }[]>`select to_jsonb(e)::text as row from app.evaluations e where id = ${evaluationId}`;
  return row!.row;
}

function busyEvent(start: string, end: string, extra: Record<string, unknown> = {}): FakeEvent {
  return { end: { dateTime: iso(end) }, id: `event-${randomUUID()}`, start: { dateTime: iso(start) }, status: "confirmed", ...extra };
}

function rankingModel(answer: (ids: string[]) => string, delayMs = 0) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const prompt = JSON.stringify(options.prompt);
      const ids = [...prompt.matchAll(/(c\d+-\d+):/g)].map((match) => match[1]!);
      return {
        content: [{ text: answer(ids), type: "text" as const }],
        finishReason: { raw: "stop", unified: "stop" as const },
        usage: {
          inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
          outputTokens: { reasoning: 0, text: 10, total: 10 },
        },
        warnings: [],
      };
    },
    modelId: "gpt-5.6-terra",
    provider: "openai.responses",
  });
}

async function reservations(evaluationId: string) {
  const [row] = await db<{ count: number }[]>`
    select count(*)::int as count from app.model_reservations where work_kind = 'ranking_check' and work_id = ${evaluationId}
  `;
  return row!.count;
}

describe("evaluation job", () => {
  it("publishes candidates from the host's busy time and the requested windows", async () => {
    const host = await seedHost({
      events: [busyEvent("10:00", "11:00", { location: "Board room", summary: "Board meeting with Initech" })],
    });
    const requestId = await seedRequest(host.hostAccountId);
    const { evaluationId, result } = await evaluate(requestId);
    const view = await awaitEvaluation(db, evaluationId, 1_000);

    expect(result).toBe("completed");
    expect(view).toMatchObject({ failure: null, meetAvailable: true, state: "completed" });
    expect(view!.candidates.map((candidate) => candidate.start)).toEqual(
      ["11:15", "11:30", "11:45", "12:00", "12:15", "12:30"].map(iso),
    );
    expect(view!.candidates[0]).toMatchObject({ displayTimezone: "Asia/Seoul", linkPlan: { kind: "google_meet" }, mode: "online" });
    expect(JSON.stringify(view)).not.toMatch(/Board|Initech|buffer|minutes before/i);

    const hostView = await readHostEvaluation(db, evaluationId);
    expect(hostView!.candidates[0]!.basis[0]).toBe("Inside your Monday hours 10:00–17:00 in Asia/Seoul.");
    expect(hostView!.exclusions.map((entry) => entry.reason)).toContain("host_busy");
  });

  it("checks the host's inbound trip through Routes and reuses the estimate within 24 hours", async () => {
    const office = `Office ${randomUUID()}, Gangnam`;
    const cafe = `Cafe ${randomUUID()}, Seongsu`;
    routes.setRoute(office, cafe, "TRANSIT", 50);
    const host = await seedHost({ events: [busyEvent("10:00", "11:00", { location: office })] });
    const details = { location: cafe, mode: "in_person", travelMode: "transit", windows: [{ end: iso("13:00"), start: iso("10:00") }] };
    const requestId = await seedRequest(host.hostAccountId, details);
    const before = routes.requests.length;

    const first = await evaluate(requestId);
    const view = await awaitEvaluation(db, first.evaluationId, 1_000);
    // 50 minutes plus 10 before and 15 for travel: the earliest start is 12:15.
    expect(view!.candidates.map((candidate) => candidate.start)).toEqual(["12:15", "12:30"].map(iso));
    expect(view!.candidates[0]).toMatchObject({ location: cafe, mode: "in_person" });

    const hostView = await readHostEvaluation(db, first.evaluationId);
    expect(hostView!.exclusions.find((entry) => entry.reason === "host_travel")!.explanation).toContain(
      "50 minutes by public transit plus 25 minutes of buffers does not fit",
    );
    expect(await storedRow(first.evaluationId)).not.toContain(office);

    await evaluate(requestId);
    expect(routes.requests.length - before).toBe(1);
  });

  it("leaves a leg with no route unresolved and out of the requester's list", async () => {
    const office = `Office ${randomUUID()}, Gangnam`;
    const host = await seedHost({ events: [busyEvent("10:00", "11:00", { location: office })] });
    const requestId = await seedRequest(host.hostAccountId, {
      location: `Cafe ${randomUUID()}`,
      mode: "in_person",
      windows: [{ end: iso("13:00"), start: iso("12:00") }],
    });
    const { evaluationId } = await evaluate(requestId);

    expect((await awaitEvaluation(db, evaluationId, 1_000))!.candidates).toEqual([]);
    expect((await readHostEvaluation(db, evaluationId))!.candidates.map((candidate) => candidate.status)).toEqual([
      "host_unresolved",
      "host_unresolved",
      "host_unresolved",
    ]);
  });

  it("uses the requester's busy time without storing or showing their events", async () => {
    const host = await seedHost();
    const requestId = await seedRequest(host.hostAccountId);
    await seedRequesterCalendar(requestId, [
      busyEvent("12:00", "13:00", { location: "Dental clinic", summary: "Root canal" }),
      busyEvent("10:00", "11:00", {
        attendees: [{ email: "grace@example.test", responseStatus: "declined", self: true }],
        summary: "Declined offsite",
      }),
    ]);
    const { evaluationId } = await evaluate(requestId);
    const view = await awaitEvaluation(db, evaluationId, 1_000);

    expect(view!.candidates.map((candidate) => candidate.start)).toEqual(
      ["10:00", "10:15", "10:30", "10:45", "11:00", "11:15", "11:30"].map(iso),
    );
    expect(await storedRow(evaluationId)).not.toMatch(/Dental|Root canal|Declined offsite/);
  });

  it.each([
    ["a revoked grant", "revoked", false],
    ["a failing calendar", undefined, true],
  ] as const)("pauses on a requester Calendar failure from %s instead of reading free time", async (_name, token, failing) => {
    const host = await seedHost();
    const requestId = await seedRequest(host.hostAccountId);
    const refreshToken = token ?? `1//requester-${randomUUID()}`;
    const calendarId = await seedRequesterCalendar(requestId, [], refreshToken);
    if (failing) {
      google.setFixture(refreshToken, {
        calendars: [{ accessRole: "owner", id: calendarId, summary: "Me" }],
        events: {},
        failingCalendars: [calendarId],
      });
    }

    const { evaluationId } = await evaluate(requestId);
    const view = await awaitEvaluation(db, evaluationId, 1_000);

    expect(view).toMatchObject({ candidates: [], failure: "requester_calendar_unavailable", state: "failed" });
  });

  it("cancels a stalled later page at the original deadline and starts nothing after it", async () => {
    // 260 short events early on Monday: the second page (token "250") stalls mid-body.
    const events = Array.from({ length: 260 }, (_, index) => {
      const start = new Date(at("00:00").getTime() + index * 60_000);
      return { end: { dateTime: new Date(start.getTime() + 30_000).toISOString() }, id: `tiny-${index}`, start: { dateTime: start.toISOString() } };
    });
    const host = await seedHost({ events, stallPageToken: "250" });
    const requestId = await seedRequest(host.hostAccountId, { location: "Somewhere", mode: "in_person" });
    const requesterCalendar = await seedRequesterCalendar(requestId, []);
    const abandoned = google.abandoned.count;
    const routeCalls = routes.requests.length;

    const { elapsed, evaluationId } = await evaluate(requestId, deps({ deadlineMs: 1_500, model: rankingModel(() => "{}") }));

    expect(elapsed).toBeLessThan(3_000);
    expect(await awaitEvaluation(db, evaluationId, 0)).toMatchObject({ candidates: [], failure: "try_again", state: "incomplete" });
    expect((await readHostEvaluation(db, evaluationId))!.failureCategory).toBe("deadline");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(google.abandoned.count).toBeGreaterThan(abandoned);
    expect(google.requests.some((request) => request.path.includes(encodeURIComponent(requesterCalendar)))).toBe(false);
    expect(routes.requests.length).toBe(routeCalls);
    expect(await reservations(evaluationId)).toBe(0);
  });

  it("returns an incomplete evaluation when a provider never settles", async () => {
    const office = `Office ${randomUUID()}`;
    const host = await seedHost({ events: [busyEvent("10:00", "11:00", { location: office })] });
    const requestId = await seedRequest(host.hostAccountId, { location: "Cafe", mode: "in_person" });
    const never: typeof fetch = () => new Promise(() => {});

    const { elapsed, evaluationId } = await evaluate(
      requestId,
      deps({ deadlineMs: 1_000, routes: { apiKey: FAKE_ROUTES_API_KEY, baseUrl: routes.baseUrl, fetch: never, timeoutMs: 60_000 } }),
    );

    expect(elapsed).toBeLessThan(2_500);
    expect((await readHostEvaluation(db, evaluationId))!).toMatchObject({ candidates: [], failureCategory: "deadline", state: "incomplete" });
  });

  it("does not publish a ranking that runs past the original deadline", async () => {
    const host = await seedHost();
    const requestId = await seedRequest(host.hostAccountId);
    const model = rankingModel((ids) => JSON.stringify({ order: ids.reverse() }), 2_500);

    const { elapsed, evaluationId } = await evaluate(requestId, deps({ deadlineMs: 1_000, model }));

    expect(elapsed).toBeLessThan(2_000);
    const hostView = await readHostEvaluation(db, evaluationId);
    expect(hostView).toMatchObject({ candidates: [], failureCategory: "deadline", ranking: null, state: "incomplete" });
    // The attempt that started stays charged.
    expect(await reservations(evaluationId)).toBe(1);
  });

  it.each([
    ["an unknown ID", (ids: string[]) => JSON.stringify({ order: ["c1-30", ...ids] })],
    ["a repeated ID", (ids: string[]) => JSON.stringify({ order: [ids[1], ids[1]] })],
    ["a candidate with a hard conflict", () => JSON.stringify({ order: [`c${at("10:15").getTime() / 60_000}-30`] })],
    ["text that is not a ranking", () => "The best time is Monday."],
  ])("discards a ranking that names %s and keeps the deterministic order", async (_name, answer) => {
    const host = await seedHost({ events: [busyEvent("10:00", "11:00")] });
    const requestId = await seedRequest(host.hostAccountId);
    const { evaluationId } = await evaluate(requestId, deps({ model: rankingModel(answer) }));
    const hostView = await readHostEvaluation(db, evaluationId);

    expect(hostView).toMatchObject({ ranking: null, state: "completed" });
    expect(hostView!.candidates[0]!.start).toBe(iso("11:15"));
    expect(await reservations(evaluationId)).toBe(1);
  });

  it("publishes a valid ranking, and an exact retry reads it with no new reservation", async () => {
    const host = await seedHost();
    const requestId = await seedRequest(host.hostAccountId);
    const model = rankingModel((ids) => JSON.stringify({ order: [ids[2], ids[0]] }));
    const retryKey = `tool:${randomUUID()}`;
    const { evaluationId } = await evaluate(requestId, deps({ model }), retryKey);
    const view = await awaitEvaluation(db, evaluationId, 1_000);

    expect(view!.candidates.slice(0, 3).map((candidate) => candidate.start)).toEqual(["10:30", "10:00", "10:15"].map(iso));
    expect(await reservations(evaluationId)).toBe(1);

    const retried = await publish(requestId, retryKey);
    expect(retried).toEqual({ created: false, evaluationId });
    expect((await awaitEvaluation(db, retried.evaluationId, 1_000))!.candidates).toEqual(view!.candidates);
    expect(await reservations(evaluationId)).toBe(1);
    expect(model.doGenerateCalls).toHaveLength(1);
    const [jobs] = await db<{ count: number }[]>`
      select count(*)::int as count from app.jobs where kind = ${EVALUATION_JOB} and dedupe_key = ${`${EVALUATION_JOB}:${requestId}:${retryKey}`}
    `;
    expect(jobs!.count).toBe(1);
  });

  it.each(["settings", "request"] as const)("publishes nothing when the %s change while it runs", async (changed) => {
    const host = await seedHost();
    const requestId = await seedRequest(host.hostAccountId);
    let touched = false;
    const changing: typeof fetch = async (input, init) => {
      if (!touched && String(input).includes("/events")) {
        touched = true;
        if (changed === "settings") {
          await db`update app.host_settings set revision = revision + 1 where host_account_id = ${host.hostAccountId}`;
        } else {
          await db`update app.requests set revision = revision + 1 where id = ${requestId}`;
        }
      }
      return fetch(input, init);
    };

    const { evaluationId } = await evaluate(requestId, deps({ calendar: fakeGoogleConfig(google, { fetch: changing }) }));

    expect(touched).toBe(true);
    expect(await readHostEvaluation(db, evaluationId)).toMatchObject({
      candidates: [],
      failureCategory: "revision_changed",
      state: "incomplete",
    });
  });

  it("publishes nothing for a request that closed", async () => {
    const host = await seedHost();
    const requestId = await seedRequest(host.hostAccountId);
    const { evaluationId } = await publish(requestId);
    await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${requestId}`;
    const [job] = await db<{ id: string }[]>`select id from app.jobs where payload ->> 'evaluationId' = ${evaluationId}`;
    await runJob(db, job!.id, createEvaluationHandler(() => deps()));

    expect((await readHostEvaluation(db, evaluationId))!.failureCategory).toBe("request_closed");
  });

  it("asks for details when the request has no windows", async () => {
    const host = await seedHost();
    const requestId = await seedRequest(host.hostAccountId, { windows: [] });
    const { evaluationId } = await evaluate(requestId);

    expect(await awaitEvaluation(db, evaluationId, 1_000)).toMatchObject({ candidates: [], failure: "needs_details", state: "completed" });
  });

  it("returns a pending evaluation when the wait ends first", async () => {
    const host = await seedHost();
    const requestId = await seedRequest(host.hostAccountId);
    const { evaluationId } = await publish(requestId);
    const started = Date.now();

    expect(await awaitEvaluation(db, evaluationId, 300)).toMatchObject({ candidates: [], failure: null, state: "pending" });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("request lifecycle on a completed evaluation", () => {
  async function requestState(requestId: string) {
    const [row] = await db<{ revision: number; state: string }[]>`select state, revision from app.requests where id = ${requestId}`;
    return row!;
  }

  it("moves a gathering request to negotiating when candidates exist, keeping the revision the evaluation read", async () => {
    const host = await seedHost();
    const requestId = await seedRequest(host.hostAccountId);
    const { result } = await evaluate(requestId);

    expect(result).toBe("completed");
    expect(await requestState(requestId)).toEqual({ revision: 1, state: "negotiating" });
  });

  it("leaves the request gathering when no candidate fits", async () => {
    const host = await seedHost({ events: [busyEvent("09:00", "14:00")] });
    const requestId = await seedRequest(host.hostAccountId);
    await evaluate(requestId);

    expect(await requestState(requestId)).toEqual({ revision: 1, state: "gathering" });
  });
});

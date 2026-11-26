import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConfirmedSettings } from "../../lib/contracts/setup";
import { createGrantedScopesFetcher } from "../../lib/server/google-token-info";
import { type GroupCloseDependencies, createGroupCloseHandler, readOptions } from "../../lib/server/group-close";
import {
  chooseGroupOptionForTool,
  closeGroupForTool,
  createGroupForTool,
  groupProgressForTool,
  type GroupToolDependencies,
  moreGroupOptionsForTool,
} from "../../lib/server/group-host-tools";
import { joinGroupForTool } from "../../lib/server/group-account-join";
import { GROUP_CLOSE_JOB, readGroup } from "../../lib/server/group-meetings";
import { startRequestForTool } from "../../lib/server/host-sent-requests";
import { outboxSealContext } from "../../lib/server/imessage-outbox";
import { openToken } from "../../lib/server/token-encryption";
import { assignHandle } from "../../lib/server/handles";
import { listHostRequests } from "../../lib/server/host-requests";
import { sessionIdHash } from "../../lib/server/model-limits";
import { recordGroupAnswersForTool } from "../../lib/server/request-tools";
import { REQUESTER_CALENDAR_SCOPES } from "../../lib/server/requester-calendar";
import { createGoogleCallbackHandler, createGoogleStartHandler, type RequesterGoogleDependencies } from "../../lib/server/requester-google";
import {
  createGroupReviewHandler,
  createGroupStartHandler,
  createRequesterCalendarsHandler,
  createRequesterCommandHandler,
  createRequesterStateHandler,
} from "../../lib/server/requester-routes";
import { createCalendarHost, fakeGoogleConfig } from "./support/calendar-host";
import { testDatabase } from "./support/database";
import { type FakeEvent, type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { call, guestDependencies, ORIGIN, SIGNING_KEY, sourceAddress } from "./support/guests";
import { imessageHarness, textOf } from "./support/imessage";
import { jobFor, runJob, testTokenKey } from "./support/requests";
import { calendarKey, futureMonday, indexRequesterSession, settingsFor } from "./support/scheduling";

// A group meeting end to end over the routes the browser calls and the tools
// the assistant calls (group-scheduling): a host creates the group from their
// linked messenger, five participants with dense, realistic calendars (classes
// over two calendars, shifts, an all-day offsite, a declined and a free event,
// an overnight lab session, a cancelled event, a stated trip) open the link,
// sign in with Google, choose calendars, answer the question, confirm their
// review, and the last one closes the group. The close job finds options,
// which an independent check verifies against the raw schedules and a
// distance-based travel model; the host books one, and exactly one event with
// every participant is created. Restarts along the way: a participant's
// reopened tab, a calendar changed under a shown review, a close job that
// fails and is retried or delivered twice, and a booking whose response is lost.

const db = testDatabase();
const guest = guestDependencies(db);
let google: FakeGoogle;
let photon: FakePhoton;
let geo: { url: string; server: Server; routeCalls: number };
let googleDeps: RequesterGoogleDependencies;
const im = imessageHarness(db, () => photon);
const saved: Record<string, string | undefined> = {};

// ---------------------------------------------------------------------------
// Seoul places and a distance-based travel model, served as Routes,
// Geocoding and Places would answer.

const PLACES: Record<string, readonly [number, number]> = {
  "강남역 스터디카페": [37.4979, 127.0276],
  "연세대학교 공학원": [37.5612, 126.9368],
  "홍대입구역": [37.5572, 126.9245],
  "판교 테크노밸리": [37.402, 127.1086],
  "서울대학교 301동": [37.45, 126.952],
  "성수동 카페거리": [37.5446, 127.0559],
  "잠실 롯데월드타워": [37.5126, 127.1025],
};
const STATIONS: Record<string, readonly [number, number]> = {
  "교대역": [37.4934, 127.0141],
  "신논현역": [37.5045, 127.0249],
  "선릉역": [37.5045, 127.049],
  "합정역": [37.5495, 126.9139],
  "왕십리역": [37.5612, 127.0371],
};

function km(a: readonly [number, number], b: readonly [number, number]) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Minutes between two known places by mode, or null when either is unknown.
function travelMinutes(from: string, to: string, mode: string) {
  const a = PLACES[from];
  const b = PLACES[to];
  if (!a || !b) return null;
  if (from === to) return 0;
  const distance = km(a, b);
  const minutes = mode === "DRIVE" ? 8 + distance * 2.2 : mode === "WALK" ? distance * 12 : 12 + distance * 3.2;
  return Math.ceil(minutes);
}

async function startGeo() {
  const state = { routeCalls: 0 };
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const url = new URL(request.url ?? "/", "http://geo");
    const json = (status: number, body: unknown) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (request.method === "POST" && url.pathname === "/directions/v2:computeRoutes") {
      state.routeCalls += 1;
      const body = JSON.parse(raw) as { origin?: { address?: string }; destination?: { address?: string }; travelMode?: string };
      const minutes = travelMinutes(body.origin?.address ?? "", body.destination?.address ?? "", body.travelMode ?? "");
      return json(200, minutes === null ? {} : { routes: [{ distanceMeters: minutes * 400, duration: `${minutes * 60}s` }] });
    }
    if (request.method === "GET" && url.pathname === "/maps/api/geocode/json") {
      const point = PLACES[url.searchParams.get("address") ?? ""];
      return json(200, point ? { results: [{ geometry: { location: { lat: point[0], lng: point[1] } } }], status: "OK" } : { results: [], status: "ZERO_RESULTS" });
    }
    if (request.method === "POST" && url.pathname === "/v1/places:searchNearby") {
      const body = JSON.parse(raw) as { locationRestriction: { circle: { center: { latitude: number; longitude: number }; radius: number } } };
      const center = [body.locationRestriction.circle.center.latitude, body.locationRestriction.circle.center.longitude] as const;
      const [name] = Object.entries(STATIONS)
        .filter(([, point]) => km(center, point) * 1000 <= body.locationRestriction.circle.radius)
        .sort((a, b) => km(center, a[1]) - km(center, b[1]))[0] ?? [];
      return json(200, name ? { places: [{ displayName: { text: name }, formattedAddress: "서울특별시" }] } : {});
    }
    json(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return Object.assign(state, { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
}

// ---------------------------------------------------------------------------
// Calendars

const MONDAY = futureMonday();
function day(offset: number) {
  const date = new Date(`${MONDAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
const at = (offset: number, clock: string) => new Date(`${day(offset)}T${clock}:00+09:00`).toISOString();

type Ev = {
  readonly day: number;
  readonly start: string;
  readonly end: string;
  readonly title: string;
  readonly location?: string;
  readonly endDay?: number;
  readonly allDay?: boolean;
  readonly transparent?: boolean;
  readonly declined?: boolean;
  readonly cancelled?: boolean;
};

function fakeEvent(ev: Ev, self: string): FakeEvent {
  const endDay = ev.endDay ?? ev.day;
  return {
    id: `ev${randomUUID().replaceAll("-", "")}`,
    start: ev.allDay ? { date: day(ev.day) } : { dateTime: at(ev.day, ev.start) },
    end: ev.allDay ? { date: day(endDay) } : { dateTime: at(endDay, ev.end) },
    status: ev.cancelled ? "cancelled" : "confirmed",
    summary: ev.title,
    ...(ev.location ? { location: ev.location } : {}),
    ...(ev.transparent ? { transparency: "transparent" } : {}),
    ...(ev.declined ? { attendees: [{ email: self, responseStatus: "declined", self: true }, { email: "lead@example.test", responseStatus: "accepted" }] } : {}),
  };
}

const weekdays = [0, 1, 2, 3, 4];
const every = (days: readonly number[], ev: Omit<Ev, "day">) => days.map((d) => ({ ...ev, day: d }));

type Person = {
  readonly key: string;
  readonly name: string;
  readonly usualPlace: string;
  readonly travelMode: "transit" | "driving" | "walking";
  readonly mode: string;
  readonly preferredHours: { start: string; end: string }[];
  // Calendar name → events; the first is primary.
  readonly calendars: Record<string, Ev[]>;
  readonly selected: readonly string[];
  readonly stated: { allDay: true; start: string; end: string }[] | { allDay: false; start: string; end: string }[];
};

const PEOPLE: Person[] = [
  {
    // A Yonsei student: classes on a separate calendar, a club and a shift.
    calendars: {
      "개인": [
        { day: 1, end: "22:00", location: "홍대입구역", start: "18:00", title: "카페 알바" },
        { day: 2, end: "21:00", location: "홍대입구역", start: "19:00", title: "밴드 동아리" },
      ],
      "수업 시간표": [
        ...every([0, 2, 4], { end: "10:15", location: "연세대학교 공학원", start: "09:00", title: "자료구조" }),
        ...every([0, 2, 4], { end: "11:45", location: "연세대학교 공학원", start: "10:30", title: "선형대수" }),
        ...every([1, 3], { end: "14:15", location: "연세대학교 공학원", start: "13:00", title: "운영체제" }),
        ...every([1, 3], { end: "15:45", location: "연세대학교 공학원", start: "14:30", title: "소프트웨어공학" }),
      ],
      // Not chosen: its all-day event must not count.
      "대한민국 공휴일": [{ allDay: true, day: 3, end: "", endDay: 4, start: "", title: "기념일" }],
    },
    key: "a",
    mode: "TRANSIT",
    name: "김민지",
    preferredHours: [{ end: "18:00", start: "12:00" }],
    selected: ["개인", "수업 시간표"],
    stated: [{ allDay: false, end: at(4, "18:00"), start: at(4, "16:00") }],
    travelMode: "transit",
    usualPlace: "연세대학교 공학원",
  },
  {
    // A Pangyo engineer who drives: stand-ups, an all-day offsite, a declined
    // meeting and free focus time.
    calendars: {
      "회사": [
        ...every(weekdays, { end: "10:00", location: "판교 테크노밸리", start: "09:30", title: "데일리 스탠드업" }),
        { day: 0, end: "16:00", location: "판교 테크노밸리", start: "14:00", title: "스프린트 플래닝" },
        { day: 1, end: "17:00", start: "13:00", title: "Focus time", transparent: true },
        { allDay: true, day: 2, end: "", endDay: 3, location: "판교 테크노밸리", start: "", title: "전사 워크숍" },
        { day: 3, end: "12:00", location: "판교 테크노밸리", start: "11:00", title: "1:1" },
        { day: 4, declined: true, end: "16:00", location: "판교 테크노밸리", start: "15:00", title: "회고" },
      ],
    },
    key: "b",
    mode: "DRIVE",
    name: "이준호",
    preferredHours: [{ end: "21:00", start: "19:00" }],
    selected: ["회사"],
    stated: [],
    travelMode: "driving",
    usualPlace: "판교 테크노밸리",
  },
  {
    // An SNU graduate student: a lab meeting, TA hours, an overnight run, a
    // cancelled event and a trip stated in words.
    calendars: {
      "연구실": [
        { day: 0, end: "12:00", location: "서울대학교 301동", start: "10:00", title: "랩미팅" },
        ...every([1, 3], { end: "17:00", location: "서울대학교 301동", start: "15:00", title: "조교 실습" }),
        { day: 3, end: "01:00", endDay: 4, location: "서울대학교 301동", start: "23:00", title: "야간 실험" },
        { cancelled: true, day: 2, end: "20:00", location: "서울대학교 301동", start: "18:00", title: "세미나(취소)" },
      ],
    },
    key: "c",
    mode: "TRANSIT",
    name: "박서연",
    preferredHours: [{ end: "18:00", start: "13:00" }],
    selected: ["연구실"],
    stated: [{ allDay: true, end: day(5), start: day(4) }],
    travelMode: "transit",
    usualPlace: "서울대학교 301동",
  },
  {
    // A Seongsu freelancer: online calls without a place, a late meetup.
    calendars: {
      "일정": [
        { day: 0, end: "14:00", start: "13:00", title: "클라이언트 콜" },
        { day: 1, end: "11:00", start: "10:00", title: "클라이언트 콜" },
        { day: 2, end: "16:30", start: "15:00", title: "디자인 리뷰" },
        { day: 3, end: "23:00", location: "성수동 카페거리", start: "21:30", title: "밋업" },
      ],
    },
    key: "d",
    mode: "TRANSIT",
    name: "최우진",
    preferredHours: [],
    selected: ["일정"],
    stated: [],
    travelMode: "transit",
    usualPlace: "성수동 카페거리",
  },
  {
    // A Jamsil office worker whose working hours are on the calendar.
    calendars: {
      "업무": [
        ...every(weekdays, { end: "18:00", location: "잠실 롯데월드타워", start: "09:00", title: "근무" }),
        { day: 0, end: "20:00", location: "잠실 롯데월드타워", start: "18:30", title: "헬스" },
        { day: 1, end: "21:00", location: "성수동 카페거리", start: "19:00", title: "저녁 약속" },
      ],
    },
    key: "e",
    mode: "TRANSIT",
    name: "정하은",
    preferredHours: [{ end: "21:00", start: "19:00" }],
    selected: ["업무"],
    stated: [],
    travelMode: "transit",
    usualPlace: "잠실 롯데월드타워",
  },
];

const VENUE = "강남역 스터디카페";
const HOST_EVENTS: Ev[] = [
  { day: 0, end: "11:00", start: "10:00", title: "주간 회의" },
  { day: 0, end: "14:30", location: "성수동 카페거리", start: "13:00", title: "고객 미팅" },
  { day: 1, end: "18:00", location: "판교 테크노밸리", start: "10:00", title: "외근" },
  { day: 2, end: "13:00", start: "12:00", title: "점심" },
  { day: 3, end: "17:00", location: VENUE, start: "14:00", title: "워크숍" },
  { allDay: true, day: 4, end: "", endDay: 5, start: "", title: "휴가" },
];
const HOST_SETTINGS: Partial<ConfirmedSettings> = {
  bufferAfterMinutes: 10,
  bufferBeforeMinutes: 10,
  location: { areas: [], kind: "places", venue: VENUE },
  meetingMode: "either",
  travelBufferMinutes: 10,
  travelMode: "transit",
  weeklyWindows: (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map((weekday) => ({ end: "21:00", start: "10:00", weekday })),
};

// ---------------------------------------------------------------------------
// Setup

beforeAll(async () => {
  google = await startFakeGoogle();
  photon = await startFakePhoton();
  geo = await startGeo();
  googleDeps = {
    appOrigin: ORIGIN,
    db,
    fetchGrantedScopes: createGrantedScopesFetcher(google.tokenInfoUrl),
    google: { authUrl: google.authUrl, clientId: "requester-client", clientSecret: "requester-secret", tokenUrl: google.tokenUrl },
    signingKey: SIGNING_KEY,
    tokenKey: testTokenKey,
  };
  // The routes that read a participant's calendar build their client from the environment.
  const env = {
    GOOGLE_CALENDAR_API_URL: google.apiBaseUrl,
    GOOGLE_OAUTH_TOKEN_URL: google.tokenUrl,
    GOOGLE_REQUESTER_CLIENT_ID: "requester-client",
    GOOGLE_REQUESTER_CLIENT_SECRET: "requester-secret",
  };
  for (const [name, value] of Object.entries(env)) {
    saved[name] = process.env[name];
    process.env[name] = value;
  }
});

afterAll(async () => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await google.close();
  await photon.close();
  await new Promise<void>((resolve) => geo.server.close(() => resolve()));
  await db.end();
});

function closeDeps(overrides: Partial<GroupCloseDependencies> = {}): GroupCloseDependencies {
  return {
    calendar: fakeGoogleConfig(google),
    db,
    places: { apiKey: "geo-key", geocodingUrl: geo.url, placesUrl: geo.url, timeoutMs: 5_000 },
    routes: { apiKey: "geo-key", baseUrl: geo.url, timeoutMs: 5_000 },
    tokenKeys: [testTokenKey, calendarKey],
    ...overrides,
  };
}

function toolDeps(close: () => GroupCloseDependencies = () => closeDeps()): GroupToolDependencies {
  return { close, db, origin: () => ORIGIN, tokenKey: () => testTokenKey };
}

// A ready host with a dense calendar on the fake Google, linked from iMessage.
async function linkedHost(events: Ev[] = HOST_EVENTS, overrides: Partial<ConfirmedSettings> = {}) {
  const host = await createCalendarHost(db, calendarKey);
  const settings = settingsFor(host.email, { ...HOST_SETTINGS, ...overrides });
  google.setFixture(host.refreshToken!, {
    calendars: [{ accessRole: "owner", conferenceSolutionTypes: ["hangoutsMeet"], id: host.email, primary: true, summary: "Work" }],
    events: { [host.email]: events.map((ev) => fakeEvent(ev, host.email)) },
  });
  await db`
    insert into app.host_settings (host_account_id, settings, draft_revision)
    values (${host.hostAccountId}, ${db.json(settings as never)}, 1)
  `;
  await db.begin((tx) => assignHandle(tx, host.hostAccountId, settings.handle));
  const { sender } = await im.link(host.hostAccountId);
  return { ...host, sender, settings };
}

// The host writes from iMessage; the session answering it makes the tool call.
async function hostSays(host: { hostAccountId: string; sender: string }, text: string) {
  expect((await im.deliver({ sender: host.sender, text })).outcome).toBe("forwarded");
  const [input] = await db<{ discussion_id: string; id: string; audience: string; request_id: string | null }[]>`
    select i.id, i.discussion_id, d.audience, d.request_id from app.conversation_inputs i
    join app.discussions d on d.id = i.discussion_id
    where d.principal_type = 'host_account' and d.principal_id = ${host.hostAccountId}
    order by i.accepted_at desc limit 1
  `;
  const [existing] = await db<{ session_id: string }[]>`
    select session_id from app.agent_sessions where discussion_id = ${input!.discussion_id} and state = 'active' order by generation desc limit 1
  `;
  let sessionId = existing?.session_id;
  if (sessionId) {
    await db`update app.agent_sessions set current_input_id = ${input!.id} where session_id = ${sessionId}`;
  } else {
    sessionId = `session_${randomUUID()}`;
    await db`
      insert into app.agent_sessions (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version, current_input_id)
      values (${sessionId}, ${sessionIdHash(sessionId)}, ${input!.discussion_id}, 'host_account', ${host.hostAccountId}, 1, 'test', ${input!.id})
    `;
  }
  const attributes: Record<string, string> = { audience: input!.audience, discussionId: input!.discussion_id, generation: "1" };
  if (input!.request_id) attributes.requestId = input!.request_id;
  return { auth: { attributes, principalId: host.hostAccountId, principalType: "user" as const }, callId: randomUUID(), sessionId };
}

// ---------------------------------------------------------------------------
// The participant's browser

const ALL_SCOPES = ["openid", "email", "profile", ...REQUESTER_CALENDAR_SCOPES];

type Joined = { person: Person; bookingId: string; requestId: string; email: string; refreshToken: string; calendarIds: Record<string, string> };

function startGroup(token: string, nonce: string) {
  return call(createGroupStartHandler(() => guest), {}, "/api/requests/start-group", {
    body: { group: token, language: "ko", nonce, timezone: "Asia/Seoul" },
  });
}

function command(bookingId: string, operation: string, input: unknown = {}) {
  return call(createRequesterCommandHandler(() => guest), { bookingId }, "/commands", {
    body: { expectedRevision: null, input, operation, retryKey: randomUUID() },
  });
}

async function threadOf(bookingId: string) {
  const response = await call(createRequesterStateHandler(() => guest), { bookingId }, "/state");
  expect(response.status).toBe(200);
  return (await response.json()) as { thread: { id: string; kind: string; status: string }[]; group?: { step: string | null; full: boolean } | null; state?: string };
}

const openCards = async (bookingId: string) => (await threadOf(bookingId)).thread.filter((card) => card.status === "open").map((card) => card.kind);

function fixtureOf(person: Person, email: string, extra: Ev[] = []) {
  const names = Object.keys(person.calendars);
  const ids = Object.fromEntries(names.map((name, index) => [name, index === 0 ? email : `${person.key}-${index}-${randomUUID().slice(0, 6)}@group.calendar.test`]));
  return {
    ids,
    fixture: (idsNow = ids) => ({
      calendars: names.map((name, index) => ({ accessRole: "owner", id: idsNow[name]!, primary: index === 0, summary: name })),
      events: Object.fromEntries(
        names.map((name, index) => [idsNow[name]!, [...person.calendars[name]!, ...(index === 0 ? extra : [])].map((ev) => fakeEvent(ev, email))]),
      ),
    }),
  };
}

// Opens the shared link, presses Continue with Google and comes back identified.
async function joinWithGoogle(token: string, person: Person, nonce = randomUUID()): Promise<Joined> {
  const started = await startGroup(token, nonce);
  expect(started.status).toBe(201);
  const { bookingId } = (await started.json()) as { bookingId: string };

  const email = `${person.key}-${randomUUID().slice(0, 8)}@example.test`;
  const refreshToken = `1//participant-${randomUUID()}`;
  const { fixture, ids } = fixtureOf(person, email);
  google.setConsent({ decision: "approve", identity: { email, email_verified: true, name: person.name, sub: `sub-${randomUUID()}` }, refreshToken, scopes: ALL_SCOPES });
  google.setFixture(refreshToken, fixture());

  const consentStart = await createGoogleStartHandler(() => googleDeps)(
    new Request(`${ORIGIN}/connections/google/start`, {
      body: new URLSearchParams({ bookingId, language: "ko", purpose: "request", timezone: "Asia/Seoul" }),
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "x-forwarded-for": sourceAddress() },
      method: "POST",
    }),
  );
  expect(consentStart.status).toBe(303);
  const cookie = (consentStart.headers.get("set-cookie") ?? "").split(";")[0]!;
  const screen = await fetch(consentStart.headers.get("location")!, { redirect: "manual" });
  const back = await createGoogleCallbackHandler(() => googleDeps)(
    new Request(screen.headers.get("location")!, { headers: { cookie, "x-forwarded-for": sourceAddress() } }),
  );
  expect(back.status).toBe(303);
  expect(back.headers.get("location")).toBe(`${ORIGIN}/booking/${bookingId}?google=identified`);

  const [row] = await db<{ id: string }[]>`
    select r.id from app.requests r join app.booking_links l on l.request_id = r.id
    where l.link_hash = encode(sha256(convert_to(${bookingId}, 'UTF8')), 'hex')
  `;
  return { bookingId, calendarIds: ids, email, person, refreshToken, requestId: row!.id };
}

async function chooseCalendars(joined: Joined) {
  const listed = await call(createRequesterCalendarsHandler(() => guest), { bookingId: joined.bookingId }, "/calendars");
  expect(listed.status).toBe(200);
  const { calendars } = (await listed.json()) as { calendars: { id: string; summary: string }[] };
  expect(calendars.map((entry) => entry.summary).sort()).toEqual(Object.keys(joined.person.calendars).sort());
  const ids = joined.person.selected.map((name) => joined.calendarIds[name]!);
  expect((await command(joined.bookingId, "calendar.select", { calendarIds: ids })).status).toBe(200);
}

// What the assistant records from the participant's answer to the one question.
async function answer(joined: Joined) {
  const session = await indexRequesterSession(db, joined.requestId);
  const outcome = await recordGroupAnswersForTool(db, { auth: session.auth, callId: randomUUID(), sessionId: session.sessionId }, {
    commitments: joined.person.stated,
    preferredHours: joined.person.preferredHours,
    travelMode: joined.person.travelMode,
    usualPlace: joined.person.usualPlace,
  });
  expect(outcome).toMatchObject({ recorded: true });
}

async function review(bookingId: string) {
  const response = await call(createGroupReviewHandler(() => guest), { bookingId }, `/api/requests/${bookingId}/group-review`);
  expect(response.status).toBe(200);
  return (await response.json()) as { fingerprint: string; times: { start: string; end: string; allDay: boolean; source: string }[] };
}

async function confirm(bookingId: string, fingerprint: string) {
  return command(bookingId, "request.group.confirm", { fingerprint });
}

// ---------------------------------------------------------------------------
// An independent check of an option against the raw schedules.

type Busy = { start: number; end: number; place: string | null };

function rawBusy(person: Person): Busy[] {
  const busy: Busy[] = [];
  for (const name of person.selected) {
    for (const ev of person.calendars[name]!) {
      if (ev.cancelled || ev.transparent || ev.declined) continue;
      const start = ev.allDay ? Date.parse(`${day(ev.day)}T00:00:00+09:00`) : Date.parse(at(ev.day, ev.start));
      const end = ev.allDay ? Date.parse(`${day(ev.endDay ?? ev.day + 1)}T00:00:00+09:00`) : Date.parse(at(ev.endDay ?? ev.day, ev.end));
      // An all-day event anchors no trip.
      busy.push({ end, place: ev.allDay ? null : (ev.location ?? person.usualPlace), start });
    }
  }
  for (const stated of person.stated) {
    const start = stated.allDay ? Date.parse(`${stated.start}T00:00:00+09:00`) : Date.parse(stated.start);
    const end = stated.allDay ? Date.parse(`${stated.end}T00:00:00+09:00`) : Date.parse(stated.end);
    busy.push({ end, place: null, start });
  }
  return busy;
}

// Why the person cannot make [start, end) at place, or null.
function conflict(person: Person, start: number, end: number, place: string | null) {
  for (const entry of rawBusy(person)) {
    if (entry.start < end && entry.end > start) return `overlaps ${new Date(entry.start).toISOString()}`;
    if (!place || !entry.place) continue;
    const sameDay = Math.abs(entry.end - start) < 12 * 3_600_000 || Math.abs(end - entry.start) < 12 * 3_600_000;
    if (!sameDay) continue;
    if (entry.end <= start && entry.end + travelMinutes(entry.place, place, person.mode)! * 60_000 > start) return `cannot arrive from ${entry.place}`;
    if (entry.start >= end && end + travelMinutes(place, entry.place, person.mode)! * 60_000 > entry.start) return `cannot reach ${entry.place}`;
  }
  return null;
}

const clock = (date: Date) => new Intl.DateTimeFormat("ko-KR", { day: "numeric", hour: "2-digit", hour12: false, minute: "2-digit", month: "numeric", timeZone: "Asia/Seoul", weekday: "short" }).format(date);

// ---------------------------------------------------------------------------

describe("a five-person group meeting over the web and the host's messenger", () => {
  it("collects realistic calendars, closes, survives restarts, and books one event for everyone", async () => {
    const host = await linkedHost();

    // The host creates the group in words from iMessage.
    const created = await createGroupForTool(toolDeps(), await hostSays(host, "다음 주에 팀 프로젝트 킥오프 5명 90분짜리 잡아줘"), {
      durationMinutes: 90,
      participants: 5,
      purpose: "팀 프로젝트 킥오프",
      rangeEnd: day(4),
      rangeStart: day(0),
    });
    expect(created).toMatchObject({ created: true });
    const { groupId, link } = created;
    if (!groupId || !link) throw new Error("not created");
    const token = new URL(link).pathname.split("/").at(-1)!;
    expect(link).toBe(`${ORIGIN}/g/${token}`);

    // A tool call from a typed web turn changes nothing.
    const webTurn = await hostSays(host, "또 하나 만들어줘");
    await db`update app.conversation_inputs set message = 'typed on the web' where id = (select current_input_id from app.agent_sessions where session_id = ${webTurn.sessionId})`;
    expect(await createGroupForTool(toolDeps(), webTurn, { durationMinutes: 30, participants: 2, purpose: "x", rangeEnd: day(1), rangeStart: day(0) })).toMatchObject({ created: false });

    const joined: Joined[] = [];
    for (const person of PEOPLE) {
      const nonce = randomUUID();
      const participant = await joinWithGoogle(token, person, nonce);
      joined.push(participant);

      // Calendar is the only open card, with no skip.
      expect(await openCards(participant.bookingId)).toEqual(["calendar"]);

      if (person.key === "d") {
        // Restart: the participant closes the tab and opens the link again in
        // the same tab session; the same draft answers, and the thread resumes.
        const again = await startGroup(token, nonce);
        expect(again.status).toBe(201);
        expect(((await again.json()) as { bookingId: string }).bookingId).toBe(participant.bookingId);
        expect(await openCards(participant.bookingId)).toEqual(["calendar"]);
        // Picking a time or skipping Calendar is not available to a participant.
        expect((await command(participant.bookingId, "request.evaluate")).status).not.toBe(200);
      }

      await chooseCalendars(participant);
      expect(await openCards(participant.bookingId)).toEqual(["group_question"]);
      await answer(participant);
      expect(await openCards(participant.bookingId)).toEqual(["group_review"]);

      let shown = await review(participant.bookingId);
      // No title of any event reaches the review.
      expect(JSON.stringify(shown)).not.toMatch(/알바|동아리|스탠드업|랩미팅|근무|헬스|Focus|회고|기념일|세미나/);

      if (person.key === "a") {
        // Classes on the second calendar count; the unchosen holiday calendar does not.
        expect(shown.times.some((time) => time.start === at(0, "09:00"))).toBe(true);
        expect(shown.times.some((time) => time.allDay)).toBe(false);
        expect(shown.times.filter((time) => time.source === "stated")).toEqual([{ allDay: false, end: at(4, "18:00"), source: "stated", start: at(4, "16:00") }]);
      }
      if (person.key === "b") {
        // Declined and free events are not unavailable times; the offsite is all day.
        expect(shown.times.some((time) => time.start === at(4, "15:00"))).toBe(false);
        expect(shown.times.some((time) => time.start === at(1, "13:00"))).toBe(false);
        expect(shown.times.filter((time) => time.allDay)).toEqual([{ allDay: true, end: day(3), source: "calendar", start: day(2) }]);

        // Restart: a new event lands while the review is on screen. The shown
        // list is refused, and the new one is confirmed instead.
        const { fixture } = fixtureOf(person, participant.email, [{ day: 4, end: "20:00", location: "판교 테크노밸리", start: "19:00", title: "저녁 약속" }]);
        google.setFixture(participant.refreshToken, fixture(participant.calendarIds));
        const stale = await confirm(participant.bookingId, shown.fingerprint);
        expect(stale.status).toBe(409);
        expect(await openCards(participant.bookingId)).toEqual(["group_review"]);
        shown = await review(participant.bookingId);
        expect(shown.times.some((time) => time.start === at(4, "19:00"))).toBe(true);
        person.calendars["회사"]!.push({ day: 4, end: "20:00", location: "판교 테크노밸리", start: "19:00", title: "저녁 약속" });
      }
      if (person.key === "c") {
        // The cancelled seminar is gone; the overnight run crosses midnight.
        expect(shown.times.some((time) => time.start === at(2, "18:00"))).toBe(false);
        expect(shown.times.some((time) => time.start === at(3, "23:00") && time.end === at(4, "01:00"))).toBe(true);
      }

      if (person.key === "e") {
        // Before the last one: the host asks how it is going. Only the done
        // ones are counted and named, and no participant is a host request.
        const progress = await groupProgressForTool(toolDeps(), await hostSays(host, "킥오프 몇 명 답했어?"));
        expect(progress.groups).toEqual([
          expect.objectContaining({ done: 4, doneNames: ["김민지", "이준호", "박서연", "최우진"], participants: 5, state: "collecting" }),
        ]);
        expect(await listHostRequests(db, host.hostAccountId)).toEqual([]);
      }

      const confirmed = await confirm(participant.bookingId, shown.fingerprint);
      expect(confirmed.status).toBe(200);
      expect(await openCards(participant.bookingId)).toEqual(["group_done"]);
      // A done participant's answers no longer change.
      const session = await indexRequesterSession(db, participant.requestId);
      expect(await recordGroupAnswersForTool(db, { auth: session.auth, callId: randomUUID(), sessionId: session.sessionId }, { usualPlace: "어딘가" })).toMatchObject({ recorded: false });
    }

    // The fifth confirmation closed the group; a sixth person is turned away.
    expect((await readGroup(db, groupId))!.state).toBe("closed");
    const late = await startGroup(token, randomUUID());
    expect(late.status).toBe(404);

    // Restart: the close job's first attempt fails (the host's calendar is
    // unreachable) and is retried; then it is delivered once more.
    const job = (await jobFor(db, GROUP_CLOSE_JOB, `group:${groupId}`))!;
    const broken = closeDeps({ calendar: fakeGoogleConfig(google, { apiBaseUrl: "http://127.0.0.1:9" }) });
    await runJob(db, job.id, createGroupCloseHandler(() => broken));
    const [failed] = await db<{ attempts: number; state: string }[]>`select state, attempts from app.jobs where id = ${job.id}`;
    expect(failed).toEqual({ attempts: 1, state: "pending" });
    expect(await readOptions(db, groupId)).toEqual([]);

    await db`update app.jobs set run_after = now() where id = ${job.id}`;
    expect(await runJob(db, job.id, createGroupCloseHandler(() => closeDeps()))).toBe("completed");
    const options = await readOptions(db, groupId);
    const callsAfterFirst = geo.routeCalls;

    await db`update app.jobs set state = 'pending', run_after = now() where id = ${job.id}`;
    expect(await runJob(db, job.id, createGroupCloseHandler(() => closeDeps()))).toBe("completed");
    expect(await readOptions(db, groupId)).toEqual(options);
    // Cached estimates: the repeated run asks Routes nothing new.
    expect(geo.routeCalls).toBe(callsAfterFirst);

    console.log(
      [
        `Options (${options.length}):`,
        ...options.map((option) => `  ${option.position}. ${clock(option.start)}–${clock(option.end)} ${option.mode} ${option.place ?? ""} missing=[${option.missing.join(", ")}]`),
      ].join("\n"),
    );

    // Every option fits each participant by the raw schedules and travel model.
    expect(options.length).toBeGreaterThanOrEqual(3);
    for (const option of options.filter((entry) => entry.missing.length === 0)) {
      for (const person of PEOPLE) {
        expect({ option: option.position, person: person.name, why: conflict(person, option.start.getTime(), option.end.getTime(), option.place) }).toEqual({
          option: option.position,
          person: person.name,
          why: null,
        });
      }
    }
    // The only evening everyone is free is Thursday, at the host's venue.
    expect(options.slice(0, 3).every((option) => option.missing.length === 0 && option.place === VENUE && option.start.toISOString().startsWith(day(3)))).toBe(true);

    // One message reaches the host, once, through the real outbox.
    const notices = (await im.outbox({ hostAccountId: host.hostAccountId, kind: "notice" })).filter((row) => row.state !== "cancelled");
    expect(notices).toHaveLength(1);
    const { sent } = await im.send(notices[0]!.id);
    const text = textOf(sent).join("\n");
    console.log(`Host notice:\n${text}`);
    expect(text).toContain("5명이 답했어요");
    // No participant's event or place reaches the host.
    expect(text).not.toMatch(/연세|판교|서울대|성수|잠실|홍대/);
    expect(text).toContain(VENUE);

    // Only three times fit everyone, so there is nothing more to show.
    expect(await moreGroupOptionsForTool(toolDeps(), await hostSays(host, "다른 시간도 보여줘"), {})).toMatchObject({ options: [], remaining: 0 });

    // Restart: Google creates the event but the response is lost.
    google.setFixture(host.refreshToken!, {
      calendars: [{ accessRole: "owner", conferenceSolutionTypes: ["hangoutsMeet"], id: host.email, primary: true, summary: "Work" }],
      events: { [host.email]: HOST_EVENTS.map((ev) => fakeEvent(ev, host.email)) },
      insertBehavior: { [host.email]: "lost_after_create" },
    });
    const choice = await chooseGroupOptionForTool(toolDeps(), await hostSays(host, "1번으로 해줘"), { position: 1 });
    expect(choice).toMatchObject({ attendees: 5, booked: true });
    const again = await chooseGroupOptionForTool(toolDeps(), await hostSays(host, "1번 예약된 거 맞지?"), { position: 1 });
    expect(again).toMatchObject({ already: true, booked: true });

    const events = google.createdEvents(host.email);
    expect(events).toHaveLength(1);
    const event = events[0]! as FakeEvent & { attendees: { email: string }[]; location?: string };
    expect(event.attendees.map((attendee) => attendee.email).sort()).toEqual(joined.map((entry) => entry.email).sort());
    expect(event.location).toBe(VENUE);
    expect(event.start.dateTime && Date.parse(event.start.dateTime)).toBe(options[0]!.start.getTime());

    const states = await db<{ state: string }[]>`select state from app.requests where group_meeting_id = ${groupId}`;
    expect(states.map((row) => row.state)).toEqual(Array(5).fill("booked"));
    expect((await readGroup(db, groupId))!.state).toBe("booked");
  });

  it("closes early with who is done, and tells the one still answering the meeting is full", async () => {
    const host = await linkedHost();
    const created = await createGroupForTool(toolDeps(), await hostSays(host, "3명 저녁 약속 잡아줘"), {
      durationMinutes: 60,
      participants: 3,
      purpose: "저녁",
      rangeEnd: day(4),
      rangeStart: day(0),
    });
    const { groupId, link } = created;
    if (!groupId || !link) throw new Error("not created");
    const token = new URL(link).pathname.split("/").at(-1)!;

    const first = await joinWithGoogle(token, PEOPLE[3]!);
    await chooseCalendars(first);
    await answer(first);
    const shown = await review(first.bookingId);

    // Closing with nobody done changes nothing.
    expect(await closeGroupForTool(toolDeps(), await hostSays(host, "그냥 마감해줘"), {})).toMatchObject({ closed: false, problem: "nobody_done" });
    expect((await confirm(first.bookingId, shown.fingerprint)).status).toBe(200);

    const second = await joinWithGoogle(token, PEOPLE[0]!);
    await chooseCalendars(second);

    expect(await closeGroupForTool(toolDeps(), await hostSays(host, "이제 마감해줘"), {})).toMatchObject({ closed: true });
    // The one still answering sees that the meeting is full.
    const view = await call(createRequesterStateHandler(() => guest), { bookingId: second.bookingId }, "/state");
    expect(await view.json()).toMatchObject({ groupFull: true, open: false, request: { state: "expired" } });

    const job = (await jobFor(db, GROUP_CLOSE_JOB, `group:${groupId}`))!;
    expect(await runJob(db, job.id, createGroupCloseHandler(() => closeDeps()))).toBe("completed");
    const options = await readOptions(db, groupId);
    expect(options.length).toBeGreaterThan(0);
    for (const option of options.filter((entry) => entry.missing.length === 0)) {
      expect(conflict(PEOPLE[3]!, option.start.getTime(), option.end.getTime(), option.place)).toBeNull();
    }
  });

  it("lets a host who uses the service answer from their own chat as usual, with one yes", async () => {
    const host = await linkedHost();
    const created = await createGroupForTool(toolDeps(), await hostSays(host, "2명이랑 스터디 잡아줘"), {
      durationMinutes: 60,
      participants: 2,
      purpose: "스터디",
      rangeEnd: day(4),
      rangeStart: day(0),
    });
    const { groupId, link } = created;
    if (!groupId || !link) throw new Error("not created");

    // Another host: meets weekdays 13:00–19:00 from Seongsu by transit, with a
    // client meeting on Monday and a day off on Friday.
    const joiner = await linkedHost(
      [
        { day: 0, end: "16:00", location: "성수동 카페거리", start: "14:00", title: "고객 미팅" },
        { allDay: true, day: 4, end: "", endDay: 5, start: "", title: "휴가" },
      ],
      {
        displayName: "한지수",
        location: { areas: [], kind: "places", venue: "성수동 카페거리" },
        weeklyWindows: (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map((weekday) => ({ end: "19:00", start: "13:00", weekday })),
      },
    );

    // The link is never a booking link, and the host's own link joins nothing.
    const started = await startRequestForTool({ appOrigin: ORIGIN, db, tokenKey: testTokenKey, tokenKeys: [testTokenKey] }, await hostSays(joiner, link), { another: false, to: link });
    expect(started).toMatchObject({ problem: expect.stringContaining("join_group_meeting"), started: false });
    expect(await joinGroupForTool(toolDeps(), await hostSays(host, link), { commitments: [], link })).toMatchObject({ joined: false, problem: expect.stringContaining("own group") });

    // The link alone: no question first, one picture of their usual open times.
    const images = async () =>
      (await db<{ id: string; text_ciphertext: string; sealed_key_id: string }[]>`
        select o.id, o.text_ciphertext, o.sealed_key_id from app.imessage_outbox o
        where o.host_account_id = ${joiner.hostAccountId} and o.kind = 'image' and o.dedupe_key like 'group-join:%' order by o.created_at, o.dedupe_key
      `).map((row) => JSON.parse(openToken([testTokenKey], { ciphertext: row.text_ciphertext, keyId: row.sealed_key_id }, outboxSealContext(row.id))) as { summary: string; preview: { group?: boolean; days: { date: string; open: { start: string; end: string }[] }[] } });
    const first = await joinGroupForTool(toolDeps(), await hostSays(joiner, `이거 참여할게 ${link}`), { commitments: [], link });
    if (!("queued" in first)) throw new Error(JSON.stringify(first));
    const [shown] = await images();
    expect(shown!.summary).toContain("하던 대로");
    expect(shown!.summary).toContain("맞으시죠");
    expect(shown!.summary).not.toContain("선호");
    expect(shown!.preview.group).toBe(true);
    const openOn = (offset: number) => shown!.preview.days.find((entry) => entry.date === day(offset))!.open;
    expect(openOn(0)).toEqual([{ end: "14:00", start: "13:00" }, { end: "19:00", start: "16:00" }]);
    expect(openOn(1)).toEqual([{ end: "19:00", start: "13:00" }]);
    expect(openOn(4)).toEqual([]);
    // Nothing reached the group yet.
    expect(await groupProgressForTool(toolDeps(), await hostSays(host, "몇 명 했어?"))).toMatchObject({ groups: [expect.objectContaining({ done: 0 })] });

    // A fixed commitment the calendar lacks gives a new picture; a yes to the old one only resends.
    const tutoring = [{ allDay: false as const, end: at(3, "19:00"), start: at(3, "17:00") }];
    const corrected = await joinGroupForTool(toolDeps(), await hostSays(joiner, "목요일 5시부터는 과외 있어"), { commitments: tutoring, link });
    if (!("queued" in corrected)) throw new Error(JSON.stringify(corrected));
    expect(corrected.fingerprint).not.toBe(first.fingerprint);
    expect((await images()).at(-1)!.preview.days.find((entry) => entry.date === day(3))!.open).toEqual([{ end: "17:00", start: "13:00" }]);
    expect(await joinGroupForTool(toolDeps(), await hostSays(joiner, "응"), { commitments: tutoring, confirm: first.fingerprint, link })).toMatchObject({ queued: true });

    const yes = await joinGroupForTool(toolDeps(), await hostSays(joiner, "응 맞아"), { commitments: tutoring, confirm: corrected.fingerprint, link });
    expect(yes).toMatchObject({ joined: true });
    expect(await joinGroupForTool(toolDeps(), await hostSays(joiner, link), { commitments: [], link })).toMatchObject({ joined: false, problem: expect.stringContaining("already answered") });

    // The host sees one done, by name, and no request of its own.
    const progress = await groupProgressForTool(toolDeps(), await hostSays(host, "몇 명 했어?"));
    expect(JSON.stringify(progress)).toContain("한지수");
    expect(await listHostRequests(db, host.hostAccountId)).toEqual([]);

    // A web participant fills the group; the options fit both.
    const web = await joinWithGoogle(new URL(link).pathname.split("/").at(-1)!, PEOPLE[0]!);
    await chooseCalendars(web);
    await answer(web);
    expect((await confirm(web.bookingId, (await review(web.bookingId)).fingerprint)).status).toBe(200);
    const job = (await jobFor(db, GROUP_CLOSE_JOB, `group:${groupId}`))!;
    expect(await runJob(db, job.id, createGroupCloseHandler(() => closeDeps()))).toBe("completed");
    const options = (await readOptions(db, groupId)).filter((entry) => entry.missing.length === 0);
    expect(options.length).toBeGreaterThan(0);
    const hour = (date: Date) => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Seoul" }).format(date));
    for (const option of options) {
      expect(conflict(PEOPLE[0]!, option.start.getTime(), option.end.getTime(), option.place)).toBeNull();
      expect(hour(option.start)).toBeGreaterThanOrEqual(13);
      expect(option.end.getTime()).toBeLessThanOrEqual(Date.parse(`${new Date(option.start).toISOString().slice(0, 10)}T10:00:00Z`));
      expect(option.start.getTime() < Date.parse(at(3, "19:00")) && option.end.getTime() > Date.parse(at(3, "17:00"))).toBe(false);
      expect(option.start.getTime() < Date.parse(at(0, "16:00")) && option.end.getTime() > Date.parse(at(0, "14:00"))).toBe(false);
      expect(option.start.getTime()).toBeLessThan(Date.parse(`${day(4)}T00:00:00+09:00`));
    }
  });
});

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for Google's OAuth token endpoint and the Calendar API (and, for the
// requester consent round trip, the consent screen, the authorization-code
// exchange with PKCE, token information and revocation), so tests drive
// the real Calendar client (and the browser tests the real app, pointed at it with
// GOOGLE_OAUTH_TOKEN_URL and GOOGLE_CALENDAR_API_URL) without a network call. Each
// refresh token has its own fixture; the refresh token "revoked", or a fixture
// marked revoked, answers invalid_grant as Google does after revocation.

export type FakeCalendar = {
  readonly id: string;
  readonly summary: string;
  readonly accessRole: string;
  readonly primary?: boolean;
  readonly timeZone?: string;
  // calendarList.get's conferenceProperties.allowedConferenceSolutionTypes.
  readonly conferenceSolutionTypes?: readonly string[];
};

export type FakeEvent = Record<string, unknown> & {
  readonly id: string;
  readonly start: { dateTime?: string; date?: string };
  readonly end: { dateTime?: string; date?: string };
};

export type FakeGoogleFixture = {
  readonly calendars: readonly FakeCalendar[];
  readonly events: Readonly<Record<string, readonly FakeEvent[]>>;
  // Calendars whose events read fails with a server error.
  readonly failingCalendars?: readonly string[];
  readonly revoked?: boolean;
  // An events page requested with this page token answers its headers and part of
  // its body, then never finishes, as a stalled Google response does.
  readonly stallPageToken?: string;
  // How events.insert answers, per calendar: created (default); created, then
  // the response is lost ("lost_after_create"); lost before anything is created
  // ("lost_before_create"); or an HTTP error status, creating nothing.
  readonly insertBehavior?: Readonly<Record<string, "created" | "lost_after_create" | "lost_before_create" | { readonly status: number }>>;
  // How events.get answers, per calendar, before falling back to the store.
  readonly getBehavior?: Readonly<Record<string, { readonly status: number }>>;
};

// The consent screen's answer for the next requester round trip: approve with
// this identity and these granted scopes (all requested ones by default), or
// deny as a cancelled consent does.
export type FakeConsent = {
  readonly decision: "approve" | "deny";
  readonly identity?: { readonly sub: string; readonly email: string; readonly email_verified?: boolean; readonly name?: string };
  readonly scopes?: readonly string[];
  // The refresh token the code exchange returns, so a test can set its fixture.
  readonly refreshToken?: string;
};

export type FakeGoogle = {
  readonly apiBaseUrl: string;
  readonly tokenUrl: string;
  readonly authUrl: string;
  readonly tokenInfoUrl: string;
  readonly revokeUrl: string;
  readonly origin: string;
  // Tokens posted to the revocation endpoint.
  readonly revocations: string[];
  setConsent(consent: FakeConsent): void;
  // Requests by method and path (no query), for assertions on what was read.
  readonly requests: { method: string; path: string }[];
  // Stalled responses whose connection the client closed.
  readonly abandoned: { count: number };
  setFixture(refreshToken: string, fixture: FakeGoogleFixture): void;
  // Events created through events.insert, by calendar.
  createdEvents(calendarId: string): FakeEvent[];
  // Marks a created event cancelled, as a host deleting it does.
  cancelEvent(calendarId: string, eventId: string): void;
  close(): Promise<void>;
};

const EMPTY: FakeGoogleFixture = { calendars: [], events: {} };
const ACCESS_PREFIX = "fake-access.";

function json(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function eventInstant(time: { dateTime?: string; date?: string }) {
  return Date.parse(time.dateTime ?? `${time.date}T00:00:00Z`);
}

// Pages a list by an index token, as Google pages with nextPageToken.
function page<T>(items: readonly T[], params: URLSearchParams) {
  const size = Number(params.get("maxResults") ?? "250");
  const offset = Number(params.get("pageToken") ?? "0");
  const slice = items.slice(offset, offset + size);
  return offset + size < items.length ? { items: slice, nextPageToken: String(offset + size) } : { items: slice };
}

export async function startFakeGoogle(
  options: { readonly port?: number; readonly defaultFixture?: FakeGoogleFixture } = {},
): Promise<FakeGoogle> {
  const fixtures = new Map<string, FakeGoogleFixture>();
  const requests: { method: string; path: string }[] = [];
  const abandoned = { count: 0 };
  const fixtureFor = (refreshToken: string) => fixtures.get(refreshToken) ?? options.defaultFixture ?? EMPTY;
  const revocations: string[] = [];
  let consent: FakeConsent = { decision: "approve" };
  const codes = new Map<string, { challenge: string; redirectUri: string; consent: FakeConsent; scopes: string[] }>();
  const scopesOf = new Map<string, string[]>();
  const created = new Map<string, FakeEvent[]>();
  const createdIn = (calendarId: string) => {
    if (!created.has(calendarId)) created.set(calendarId, []);
    return created.get(calendarId)!;
  };
  let issued = 0;

  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const url = new URL(request.url ?? "/", "http://fake-google");
    requests.push({ method: request.method ?? "GET", path: url.pathname });

    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { ok: true });
      return;
    }

    // Test control: POST /__fixture/:refreshToken sets a fixture from another process.
    const control = url.pathname.match(/^\/__fixture\/(.+)$/);
    if (request.method === "POST" && control) {
      fixtures.set(decodeURIComponent(control[1]!), JSON.parse(raw) as FakeGoogleFixture);
      response.writeHead(204).end();
      return;
    }

    // Test control: POST /__consent sets the next consent from another process.
    if (request.method === "POST" && url.pathname === "/__consent") {
      consent = JSON.parse(raw) as FakeConsent;
      response.writeHead(204).end();
      return;
    }

    // The consent screen: answers at once with the configured decision.
    if (request.method === "GET" && url.pathname === "/o/oauth2/v2/auth") {
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const back = new URL(redirectUri);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");

      if (consent.decision === "deny") {
        back.searchParams.set("error", "access_denied");
      } else {
        const code = `fake-code-${++issued}`;
        const requested = (url.searchParams.get("scope") ?? "").split(" ").filter(Boolean);
        codes.set(code, {
          challenge: url.searchParams.get("code_challenge") ?? "",
          consent,
          redirectUri,
          scopes: [...(consent.scopes ?? requested)],
        });
        back.searchParams.set("code", code);
      }

      response.writeHead(302, { location: back.toString() }).end();
      return;
    }

    if (request.method === "POST" && url.pathname === "/tokeninfo") {
      const accessToken = new URLSearchParams(raw).get("access_token") ?? "";
      const scopes = scopesOf.get(accessToken);
      if (scopes) json(response, 200, { scope: scopes.join(" ") });
      else json(response, 400, { error: "invalid_token" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/revoke") {
      revocations.push(new URLSearchParams(raw).get("token") ?? "");
      json(response, 200, {});
      return;
    }

    if (request.method === "POST" && url.pathname === "/token" && new URLSearchParams(raw).get("grant_type") === "authorization_code") {
      const form = new URLSearchParams(raw);
      const entry = codes.get(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");

      if (!entry || entry.challenge !== challenge || entry.redirectUri !== form.get("redirect_uri") || !form.get("client_secret")) {
        json(response, 400, { error: "invalid_grant" });
        return;
      }

      codes.delete(form.get("code")!);
      const identity = entry.consent.identity ?? { email: "guest@example.test", email_verified: true, name: "Guest", sub: "1001" };
      const refreshToken = entry.consent.refreshToken ?? `requester-refresh-${issued}`;
      const accessToken = `${ACCESS_PREFIX}${refreshToken}`;
      scopesOf.set(accessToken, entry.scopes);
      const claims = Buffer.from(JSON.stringify({ email_verified: true, ...identity })).toString("base64url");
      json(response, 200, {
        access_token: accessToken,
        expires_in: 3599,
        id_token: `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${claims}.signature`,
        refresh_token: refreshToken,
        scope: entry.scopes.join(" "),
        token_type: "Bearer",
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/token") {
      const form = new URLSearchParams(raw);
      const refreshToken = form.get("refresh_token") ?? "";

      if (form.get("grant_type") !== "refresh_token" || !form.get("client_id") || !form.get("client_secret")) {
        json(response, 400, { error: "invalid_request" });
      } else if (refreshToken === "revoked" || fixtureFor(refreshToken).revoked) {
        json(response, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      } else {
        json(response, 200, { access_token: `${ACCESS_PREFIX}${refreshToken}`, expires_in: 3599, token_type: "Bearer" });
      }
      return;
    }

    const authorization = request.headers.authorization ?? "";
    if (!authorization.startsWith(`Bearer ${ACCESS_PREFIX}`)) {
      json(response, 401, { error: { code: 401, message: "Invalid Credentials" } });
      return;
    }

    const fixture = fixtureFor(authorization.slice(`Bearer ${ACCESS_PREFIX}`.length));

    if (request.method === "GET" && url.pathname === "/calendar/v3/users/me/calendarList") {
      json(response, 200, page(fixture.calendars, url.searchParams));
      return;
    }

    const entry = url.pathname.match(/^\/calendar\/v3\/users\/me\/calendarList\/([^/]+)$/);
    if (request.method === "GET" && entry) {
      const calendar = fixture.calendars.find((candidate) => candidate.id === decodeURIComponent(entry[1]!));

      if (!calendar) {
        json(response, 404, { error: { code: 404, message: "Not Found" } });
      } else {
        json(response, 200, {
          conferenceProperties: { allowedConferenceSolutionTypes: calendar.conferenceSolutionTypes ?? [] },
        });
      }
      return;
    }

    const insert = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/);
    if (request.method === "POST" && insert) {
      const calendarId = decodeURIComponent(insert[1]!);
      const behavior = fixture.insertBehavior?.[calendarId] ?? "created";

      if (!fixture.calendars.some((calendar) => calendar.id === calendarId)) {
        json(response, 404, { error: { code: 404, message: "Not Found" } });
        return;
      }
      if (typeof behavior === "object") {
        json(response, behavior.status, { error: { code: behavior.status, message: "Refused" } });
        return;
      }
      if (behavior === "lost_before_create") {
        request.socket.destroy();
        return;
      }

      const body = JSON.parse(raw) as FakeEvent & { conferenceData?: unknown };
      const store = createdIn(calendarId);
      if (store.some((event) => event.id === body.id)) {
        json(response, 409, { error: { code: 409, message: "The requested identifier already exists." } });
        return;
      }

      const event: FakeEvent = {
        ...body,
        hangoutLink: body.conferenceData ? `https://meet.google.com/${String(body.id).slice(0, 3)}-fake-link` : undefined,
        htmlLink: `https://www.google.com/calendar/event?eid=${body.id}`,
        iCalUID: `${body.id}@google.com`,
        organizer: { displayName: "Ada Lovelace", email: calendarId, self: true },
        status: "confirmed",
      };
      store.push(event);

      if (behavior === "lost_after_create") {
        request.socket.destroy();
        return;
      }
      json(response, 200, event);
      return;
    }

    const single = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/);
    if (request.method === "GET" && single) {
      const calendarId = decodeURIComponent(single[1]!);
      const forced = fixture.getBehavior?.[calendarId];
      if (forced) {
        json(response, forced.status, { error: { code: forced.status, message: "Error" } });
        return;
      }
      const event = (created.get(calendarId) ?? []).find((entry) => entry.id === decodeURIComponent(single[2]!));
      if (event) json(response, 200, event);
      else json(response, 404, { error: { code: 404, message: "Not Found" } });
      return;
    }

    const events = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/);
    if (request.method === "GET" && events) {
      const calendarId = decodeURIComponent(events[1]!);

      if (fixture.failingCalendars?.includes(calendarId)) {
        json(response, 503, { error: { code: 503, message: "Backend Error" } });
        return;
      }

      if (!fixture.calendars.some((calendar) => calendar.id === calendarId)) {
        json(response, 404, { error: { code: 404, message: "Not Found" } });
        return;
      }

      if (fixture.stallPageToken && url.searchParams.get("pageToken") === fixture.stallPageToken) {
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"items":[');
        response.on("close", () => {
          abandoned.count += 1;
        });
        return;
      }

      const timeMin = Date.parse(url.searchParams.get("timeMin") ?? "");
      const timeMax = Date.parse(url.searchParams.get("timeMax") ?? "");
      const inRange = [...(fixture.events[calendarId] ?? []), ...(created.get(calendarId) ?? [])]
        .filter((event) => eventInstant(event.end) > timeMin && eventInstant(event.start) < timeMax)
        .sort((a, b) => eventInstant(a.start) - eventInstant(b.start));
      json(response, 200, page(inRange, url.searchParams));
      return;
    }

    json(response, 404, { error: { code: 404, message: "Not Found" } });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  return {
    abandoned,
    apiBaseUrl: `${origin}/calendar/v3`,
    authUrl: `${origin}/o/oauth2/v2/auth`,
    cancelEvent: (calendarId, eventId) => {
      const store = createdIn(calendarId);
      const index = store.findIndex((event) => event.id === eventId);
      if (index >= 0) store[index] = { ...store[index]!, status: "cancelled" };
    },
    createdEvents: (calendarId) => [...(created.get(calendarId) ?? [])],
    revocations,
    revokeUrl: `${origin}/revoke`,
    setConsent: (next) => {
      consent = next;
    },
    tokenInfoUrl: `${origin}/tokeninfo`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    origin,
    requests,
    setFixture: (refreshToken, fixture) => fixtures.set(refreshToken, fixture),
    tokenUrl: `${origin}/token`,
  };
}

// The Monday 00:00 UTC that starts the week of `now`.
function mondayUtc(now: Date) {
  const day = (now.getUTCDay() + 6) % 7;
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day);
}

function at(base: number, days: number, hourUtc: number, minutes = 0) {
  return new Date(base + days * 86_400_000 + hourUtc * 3_600_000 + minutes * 60_000).toISOString();
}

// A realistic host calendar over the four weeks ending with the week of `now`
// (always inside the scan's 28 days either side of `now`, whatever the weekday),
// in Asia/Seoul: 12
// counted meetings (three a week on Tuesday 10:00, Wednesday 14:00 and Thursday
// 16:00 local, internal and external), the Wednesday one each week except the last
// at one in-person venue, two note-like entries, a Team reader calendar, two
// calendars named "Shared" (one writer, one reader) and a holiday calendar.
export function defaultGoogleFixture(now = new Date(), hostEmail = "host@example.test"): FakeGoogleFixture {
  const base = mondayUtc(now);
  const colleague = "colleague@example.test";
  const client = "client@client.test";
  const primary: FakeEvent[] = [];

  for (let week = 1; week <= 4; week += 1) {
    const monday = -7 * (week - 1);
    const self = { email: hostEmail, responseStatus: "accepted", self: true };

    // Tuesday 10:00 KST (01:00 UTC), 30 minutes, internal, online.
    primary.push({
      attendees: [self, { email: colleague, responseStatus: "accepted" }],
      end: { dateTime: at(base, monday + 1, 1, 30) },
      hangoutLink: "https://meet.google.com/aaa-bbbb-ccc",
      iCalUID: `standup-${week}@google.com`,
      id: `standup-${week}`,
      start: { dateTime: at(base, monday + 1, 1) },
      status: "confirmed",
      summary: "Team sync",
      updated: "2026-10-01T00:00:00.000Z",
    });
    // Wednesday 14:00 KST (05:00 UTC), 60 minutes, external, in person for weeks 2-4.
    primary.push({
      attendees: [self, { email: client, responseStatus: "accepted" }],
      end: { dateTime: at(base, monday + 2, 6) },
      iCalUID: `client-${week}@google.com`,
      id: `client-${week}`,
      ...(week === 1 ? { hangoutLink: "https://meet.google.com/ddd-eeee-fff" } : { location: "Blue Bottle Coffee, Seongsu, Seoul" }),
      start: { dateTime: at(base, monday + 2, 5) },
      status: "confirmed",
      summary: "Client check-in",
      updated: "2026-10-01T00:00:00.000Z",
    });
    // Thursday 16:00 KST (07:00 UTC), 30 minutes, mixed attendees (external), online.
    primary.push({
      attendees: [self, { email: colleague, responseStatus: "accepted" }, { email: client, responseStatus: "needsAction" }],
      end: { dateTime: at(base, monday + 3, 7, 30) },
      hangoutLink: "https://meet.google.com/ggg-hhhh-iii",
      iCalUID: `review-${week}@google.com`,
      id: `review-${week}`,
      start: { dateTime: at(base, monday + 3, 7) },
      status: "confirmed",
      summary: "Project review",
      updated: "2026-10-01T00:00:00.000Z",
    });
  }

  primary.push(
    {
      end: { dateTime: at(base, -6, 0) },
      iCalUID: "focus@google.com",
      id: "focus",
      start: { dateTime: at(base, -6, -2) },
      status: "confirmed",
      summary: "Focus time",
      updated: "2026-10-02T00:00:00.000Z",
    },
    {
      end: { date: new Date(base - 2 * 86_400_000).toISOString().slice(0, 10) },
      iCalUID: "report@google.com",
      id: "report",
      start: { date: new Date(base - 3 * 86_400_000).toISOString().slice(0, 10) },
      status: "confirmed",
      summary: "Write quarterly report",
      transparency: "opaque",
      updated: "2026-10-03T00:00:00.000Z",
    },
  );

  return {
    calendars: [
      { accessRole: "owner", id: hostEmail, primary: true, summary: hostEmail, timeZone: "Asia/Seoul" },
      { accessRole: "reader", id: "team@group.calendar.google.com", summary: "Team", timeZone: "Asia/Seoul" },
      { accessRole: "writer", id: "shared-writer@group.calendar.google.com", summary: "Shared", timeZone: "Asia/Seoul" },
      { accessRole: "reader", id: "shared-reader@group.calendar.google.com", summary: "Shared", timeZone: "Asia/Seoul" },
      {
        accessRole: "reader",
        id: "en.south_korea#holiday@group.v.calendar.google.com",
        summary: "Holidays in South Korea",
        timeZone: "Asia/Seoul",
      },
    ],
    events: {
      [hostEmail]: primary,
      "en.south_korea#holiday@group.v.calendar.google.com": [],
      "shared-reader@group.calendar.google.com": [],
      "shared-writer@group.calendar.google.com": [],
      "team@group.calendar.google.com": [],
    },
  };
}

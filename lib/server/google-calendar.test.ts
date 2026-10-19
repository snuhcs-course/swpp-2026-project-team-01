import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "./database";
import {
  CalendarAccessError,
  GOOGLE_CALENDAR_API_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  type GoogleCalendarConfig,
  googleCalendarConfigFromEnvironment,
  openHostCalendar,
} from "./google-calendar";
import { parseTokenKey, sealToken } from "./token-encryption";

const hostAccountId = "5d0c3c5e-0000-4000-8000-000000000001";
const key = parseTokenKey(randomBytes(32).toString("base64"));
const refreshToken = "1//refresh-for-unit-tests";
const scopes = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

// A database stand-in answering the grant reads and recording every statement.
function grantDatabase(grant: { scopes?: string[]; invalidated?: boolean; token?: string | null } = {}) {
  const statements: string[] = [];
  const sealed = grant.token === null ? null : sealToken(key, grant.token ?? refreshToken, `provider_grant:google:${hostAccountId}`);
  const db = ((strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    statements.push(sql);

    if (sql.includes("invalidated_at is not null as invalidated")) {
      return Promise.resolve([{ granted_scopes: grant.scopes ?? scopes, invalidated: grant.invalidated ?? false }]);
    }

    if (sql.includes("select granted_scopes, refresh_token_ciphertext")) {
      return Promise.resolve([
        {
          granted_scopes: grant.scopes ?? scopes,
          refresh_token_ciphertext: sealed?.ciphertext ?? null,
          refresh_token_key_id: sealed?.keyId ?? null,
        },
      ]);
    }

    return Promise.resolve([]);
  }) as unknown as Queryable;

  return { db, statements };
}

function config(fetcher: typeof fetch, overrides: Partial<GoogleCalendarConfig> = {}): GoogleCalendarConfig {
  return {
    apiBaseUrl: "https://calendar.test/calendar/v3",
    clientId: "client-id",
    clientSecret: "client-secret",
    fetch: fetcher,
    timeoutMs: 50,
    tokenUrl: "https://oauth.test/token",
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

async function category(promise: Promise<unknown>) {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return error instanceof CalendarAccessError ? error.category : String(error);
  }
}

describe("googleCalendarConfigFromEnvironment", () => {
  it("honours the fake Google overrides outside production only", () => {
    const env = {
      GOOGLE_CALENDAR_API_URL: "http://127.0.0.1:3103/calendar/v3",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_OAUTH_TOKEN_URL: "http://127.0.0.1:3103/token",
    };

    expect(googleCalendarConfigFromEnvironment(env)).toMatchObject({
      apiBaseUrl: "http://127.0.0.1:3103/calendar/v3",
      clientId: "id",
      timeoutMs: 10_000,
      tokenUrl: "http://127.0.0.1:3103/token",
    });
    expect(googleCalendarConfigFromEnvironment({ ...env, VERCEL: "1", VERCEL_ENV: "production" })).toMatchObject({
      apiBaseUrl: GOOGLE_CALENDAR_API_URL,
      tokenUrl: GOOGLE_OAUTH_TOKEN_URL,
    });
  });
});

describe("openHostCalendar", () => {
  it.each([
    ["declined Calendar scopes", { scopes: ["https://www.googleapis.com/auth/calendar.events.freebusy"] }],
    ["an invalidated grant", { invalidated: true }],
    ["no refresh token", { token: null }],
  ])("refuses %s as not connected", async (_label, grant) => {
    const fetcher = vi.fn<typeof fetch>();
    const { db } = grantDatabase(grant);

    expect(await category(openHostCalendar({ config: config(fetcher), db, tokenKeys: [key] }, hostAccountId))).toBe(
      "calendar_not_connected",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("marks the grant invalid when Google answers invalid_grant", async () => {
    const { db, statements } = grantDatabase();
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(400, { error: "invalid_grant" }));
    const calendar = await openHostCalendar({ config: config(fetcher), db, tokenKeys: [key] }, hostAccountId);

    expect(await category(calendar.listCalendars())).toBe("calendar_access_revoked");
    expect(statements.some((sql) => sql.includes("set invalidated_at = now()"))).toBe(true);
  });

  it("reports a server error, a timeout or missing client credentials as unavailable without invalidating", async () => {
    const { db, statements } = grantDatabase();
    const serverError = vi.fn<typeof fetch>(async () => jsonResponse(500, { error: "backend" }));
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const open = (fetcher: typeof fetch, overrides: Partial<GoogleCalendarConfig> = {}) =>
      openHostCalendar({ config: config(fetcher, overrides), db, tokenKeys: [key] }, hostAccountId);

    expect(await category((await open(serverError)).listCalendars())).toBe("calendar_unavailable");
    expect(await category((await open(hanging)).listCalendars())).toBe("calendar_unavailable");
    expect(await category((await open(serverError, { clientSecret: "" })).listCalendars())).toBe("calendar_unavailable");
    expect(statements.some((sql) => sql.includes("set invalidated_at"))).toBe(false);
  });

  it("sends the token only in headers and bodies, reads minimal fields and stops after eight pages", async () => {
    const { db } = grantDatabase();
    const urls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      urls.push(url);

      if (url === "https://oauth.test/token") {
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        return jsonResponse(200, { access_token: "ya29.access", expires_in: 3599 });
      }

      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ya29.access");
      const pageToken = Number(new URL(url).searchParams.get("pageToken") ?? "0");
      return jsonResponse(200, {
        items: [{ end: { dateTime: "2026-10-13T02:00:00Z" }, id: `e${pageToken}`, start: { dateTime: "2026-10-13T01:00:00Z" } }],
        nextPageToken: String(pageToken + 1),
      });
    });
    const calendar = await openHostCalendar({ config: config(fetcher), db, tokenKeys: [key] }, hostAccountId);

    const events = await calendar.listEvents("me@example.test", {
      end: new Date("2026-11-16T00:00:00Z"),
      start: new Date("2026-09-21T00:00:00Z"),
    });

    expect(events).toHaveLength(8);
    expect(urls.filter((url) => url.includes("/events"))).toHaveLength(8);
    // One token exchange serves every page.
    expect(urls.filter((url) => url.includes("oauth.test"))).toHaveLength(1);
    const first = new URL(urls[1]!);
    expect(first.pathname).toBe("/calendar/v3/calendars/me%40example.test/events");
    expect(first.searchParams.get("singleEvents")).toBe("true");
    expect(first.searchParams.get("orderBy")).toBe("startTime");
    expect(first.searchParams.get("maxResults")).toBe("250");
    expect(first.searchParams.get("fields")).toMatch(/^nextPageToken,items\(/);
    expect(urls.join(" ")).not.toContain(refreshToken);
    expect(urls.join(" ")).not.toContain("ya29.access");
  });

  it("maps events, treating a meeting URL in the location as a link and dropping room resources", async () => {
    const { db } = grantDatabase();
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).includes("oauth.test")
        ? jsonResponse(200, { access_token: "ya29.access", expires_in: 3599 })
        : jsonResponse(200, {
            items: [
              {
                attendees: [
                  { email: "me@example.test", responseStatus: "accepted", self: true },
                  { email: "room@resource.calendar.google.com", resource: true },
                ],
                end: { dateTime: "2026-10-13T02:00:00Z" },
                id: "zoom",
                location: "https://zoom.us/j/123",
                start: { dateTime: "2026-10-13T01:00:00Z" },
              },
            ],
          }),
    );
    const calendar = await openHostCalendar({ config: config(fetcher), db, tokenKeys: [key] }, hostAccountId);

    const [event] = await calendar.listEvents("me@example.test", { end: new Date(), start: new Date(0) });

    expect(event).toMatchObject({
      attendees: [{ email: "me@example.test", responseStatus: "accepted", self: true }],
      calendarId: "me@example.test",
      hasConferenceLink: true,
      status: "confirmed",
    });
  });
});

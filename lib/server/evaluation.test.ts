import { afterEach, describe, expect, it, vi } from "vitest";
import { EvaluationDeadlineError, guestHostPreferences, hostPlaces, startDeadline, usualPlace, validateRanking } from "./evaluation";
import type { BusyInterval } from "./feasibility";
import { requesterCalendarConfigFromEnvironment } from "./requester-calendar";

afterEach(() => {
  vi.useRealTimers();
});

describe("the shared evaluation deadline", () => {
  it("runs work before the deadline and stops waiting for it at the deadline", async () => {
    vi.useFakeTimers();
    const deadline = startDeadline(18_000);

    expect(await deadline.run(async () => "first page")).toBe("first page");

    let seen: AbortSignal | undefined;
    const stalled = deadline.run((signal) => {
      seen = signal;
      return new Promise<never>(() => {});
    });
    const outcome = expect(stalled).rejects.toBeInstanceOf(EvaluationDeadlineError);

    await vi.advanceTimersByTimeAsync(18_000);
    await outcome;
    expect(seen?.aborted).toBe(true);
    expect(deadline.passed()).toBe(true);
  });

  it("starts no work once the deadline has passed, by the clock or the timer", async () => {
    let now = 1_000;
    const deadline = startDeadline(18_000, () => now);
    const work = vi.fn(async () => "never");

    now += 18_000;
    await expect(deadline.run(work)).rejects.toBeInstanceOf(EvaluationDeadlineError);
    expect(work).not.toHaveBeenCalled();
    expect(deadline.signal.aborted).toBe(true);
    deadline.clear();
  });

  it("reports work that failed because the deadline cancelled it as the deadline", async () => {
    vi.useFakeTimers();
    const deadline = startDeadline(100);
    const cancelled = deadline.run(
      (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted fetch")))),
    );
    const outcome = expect(cancelled).rejects.toBeInstanceOf(EvaluationDeadlineError);

    await vi.advanceTimersByTimeAsync(100);
    await outcome;
  });

  it("passes through a failure before the deadline", async () => {
    const deadline = startDeadline(18_000);
    await expect(deadline.run(async () => Promise.reject(new Error("calendar")))).rejects.toThrow("calendar");
    deadline.clear();
  });
});

describe("validateRanking", () => {
  const ids = ["c1-30", "c2-30", "c3-30"];

  it("accepts a reordering of the given IDs, whole or partial", () => {
    expect(validateRanking({ order: ["c3-30", "c1-30", "c2-30"] }, ids)).toEqual(["c3-30", "c1-30", "c2-30"]);
    expect(validateRanking({ order: ["c2-30"] }, ids)).toEqual(["c2-30"]);
  });

  it("discards unknown or repeated IDs and malformed output", () => {
    expect(validateRanking({ order: ["c9-30", "c1-30"] }, ids)).toBeNull();
    expect(validateRanking({ order: ["c1-30", "c1-30"] }, ids)).toBeNull();
    expect(validateRanking({ order: [] }, ids)).toBeNull();
    expect(validateRanking({ order: [1] }, ids)).toBeNull();
    expect(validateRanking(null, ids)).toBeNull();
  });
});

describe("requesterCalendarConfigFromEnvironment", () => {
  it("uses the requester OAuth client and the stand-in URLs outside production", () => {
    const env = {
      GOOGLE_CALENDAR_API_URL: "http://127.0.0.1:3103/calendar/v3",
      GOOGLE_CLIENT_ID: "host-client",
      GOOGLE_OAUTH_TOKEN_URL: "http://127.0.0.1:3103/token",
      GOOGLE_REQUESTER_CLIENT_ID: "requester-client",
      GOOGLE_REQUESTER_CLIENT_SECRET: "requester-secret",
    };

    expect(requesterCalendarConfigFromEnvironment(env)).toMatchObject({
      apiBaseUrl: "http://127.0.0.1:3103/calendar/v3",
      clientId: "requester-client",
      clientSecret: "requester-secret",
      tokenUrl: "http://127.0.0.1:3103/token",
    });
    expect(requesterCalendarConfigFromEnvironment({ ...env, VERCEL: "1", VERCEL_ENV: "production" })).toMatchObject({
      apiBaseUrl: "https://www.googleapis.com/calendar/v3",
      tokenUrl: "https://oauth2.googleapis.com/token",
    });
  });

  it("falls back to the host sign-in client when the requester client is unset", () => {
    const host = { GOOGLE_CLIENT_ID: "host-client", GOOGLE_CLIENT_SECRET: "host-secret" };

    for (const requester of [{}, { GOOGLE_REQUESTER_CLIENT_ID: " ", GOOGLE_REQUESTER_CLIENT_SECRET: "" }]) {
      expect(requesterCalendarConfigFromEnvironment({ ...host, ...requester })).toMatchObject({
        clientId: "host-client",
        clientSecret: "host-secret",
      });
    }
    expect(requesterCalendarConfigFromEnvironment({})).toMatchObject({ clientId: "", clientSecret: "" });
  });
});

describe("the host's places for time and place pairs", () => {
  it("lists the venue first, then the areas in order, without repeats", () => {
    expect(hostPlaces({ location: { areas: ["Seolleung Station", "AA Cafe", "Yeoksam"], kind: "places", venue: "AA Cafe" } })).toEqual([
      "AA Cafe",
      "Seolleung Station",
      "Yeoksam",
    ]);
  });

  it("lists nothing when the host decides per meeting or gave no answer", () => {
    expect(hostPlaces({ location: { kind: "decide_per_meeting" } })).toEqual([]);
    expect(hostPlaces({ location: null })).toEqual([]);
  });
});

describe("the host's usual place (#324)", () => {
  const hash = (text: string) => `h:${text}`;

  it("is the first named area, else the venue, whether or not trips are grouped", () => {
    expect(usualPlace({ location: { areas: ["Gwanak-gu", "Gangnam"], kind: "places", venue: "SNU 301" } } as never, hash)).toEqual({ key: "h:Gwanak-gu", text: "Gwanak-gu" });
    expect(usualPlace({ location: { areas: [], kind: "places", venue: "SNU 301" } } as never, hash)).toEqual({ key: "h:SNU 301", text: "SNU 301" });
    expect(usualPlace({ location: { kind: "decide_per_meeting" } } as never, hash)).toBeNull();
  });
});

describe("a guest-host's preferences (#60)", () => {
  const at = (iso: string) => Date.parse(iso);
  const meeting = (iso: string, isMeeting: boolean): BusyInterval => ({
    allDay: false,
    end: at(iso) + 30 * 60_000,
    endpoint: { kind: "unknown", reason: "no_location" },
    meeting: isMeeting,
    start: at(iso),
  });
  const settings = { timezone: "Asia/Seoul", weeklyLimit: 3, weeklyWindows: [] };

  it("counts their bookings by their own week, and their other meetings only when every meeting counts", () => {
    // Sunday 8 Nov 23:30 in Seoul is still the week of Monday 2 Nov.
    const booked = [at("2026-11-08T14:30:00Z"), at("2026-11-09T01:00:00Z")];
    const busy = [meeting("2026-11-03T01:00:00Z", true), meeting("2026-11-03T03:00:00Z", false)];

    expect(guestHostPreferences({ ...settings, weeklyLimitCounts: "bookings" }, booked, busy).weekCounts).toEqual({
      "2026-11-02": 1,
      "2026-11-09": 1,
    });
    expect(guestHostPreferences({ ...settings, weeklyLimitCounts: "all_meetings" }, booked, busy)).toEqual({
      timezone: "Asia/Seoul",
      weekCounts: { "2026-11-02": 2, "2026-11-09": 1 },
      weeklyLimit: 3,
      weeklyWindows: [],
    });
  });
});

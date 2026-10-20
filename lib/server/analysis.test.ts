import { describe, expect, it } from "vitest";
import type { AnalysisEvidence } from "../contracts/analysis";
import { STARTER_DEFAULTS } from "../contracts/setup";
import { analysisForModel, computeEvidence, countingZone, placeHintFromEvidence, suggestFromEvidence } from "./analysis";
import type { CalendarEvent } from "./google-calendar";

const host = "host@example.test";
const ctx = { calendars: [{ id: host, ok: true, summary: "Me" }], hostEmail: host, timezone: "Asia/Seoul" };
const self = { email: host, responseStatus: "accepted", self: true };
const colleague = { email: "colleague@example.test", responseStatus: "accepted", self: false };
const client = { email: "client@client.test", responseStatus: "accepted", self: false };

let sequence = 0;

// A timed event; times are UTC instants (Asia/Seoul is UTC+9).
function event(overrides: Partial<CalendarEvent> & { startUtc?: string; minutes?: number } = {}): CalendarEvent {
  const { minutes = 30, startUtc = "2026-10-13T01:00:00Z", ...rest } = overrides;
  const start = new Date(startUtc);
  sequence += 1;

  return {
    attendees: [self, colleague],
    calendarId: host,
    end: { dateTime: new Date(start.getTime() + minutes * 60_000).toISOString() },
    hasConferenceLink: true,
    iCalUID: `event-${sequence}@google.com`,
    id: `event-${sequence}`,
    location: null,
    recurringEventId: null,
    start: { dateTime: start.toISOString() },
    status: "confirmed",
    summary: `Meeting ${sequence}`,
    transparency: null,
    updated: "2026-10-01T00:00:00.000Z",
    ...rest,
  };
}

function allDay(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return event({ attendees: [], end: { date: "2026-10-15" }, hasConferenceLink: false, start: { date: "2026-10-14" }, ...overrides });
}

describe("computeEvidence", () => {
  it("counts preferred times by weekday and start hour in the host timezone", () => {
    const evidence = computeEvidence(
      [
        // Tuesday 10:00 and 10:30 KST, and Monday 23:30 UTC = Tuesday 08:30 KST.
        event({ startUtc: "2026-10-13T01:00:00Z" }),
        event({ startUtc: "2026-10-13T01:30:00Z", minutes: 60 }),
        event({ startUtc: "2026-10-12T23:30:00Z" }),
      ],
      ctx,
    );

    expect(evidence.preferredTimes.sampleSize).toBe(3);
    expect(evidence.preferredTimes.cells).toEqual([
      { count: 1, hour: 8, weekday: "tuesday" },
      { count: 2, hour: 10, weekday: "tuesday" },
    ]);
    expect(evidence.preferredTimes.spans).toEqual([{ endMinute: 11 * 60 + 30, startMinute: 8 * 60 + 30, weekday: "tuesday" }]);
    expect(evidence.timezone).toBe("Asia/Seoul");
  });

  it("splits weekly load into internal and external by attendee domain, weeks starting Monday locally", () => {
    const evidence = computeEvidence(
      [
        // Sunday 2026-10-18 23:00 UTC is Monday 2026-10-19 08:00 KST: the next week.
        event({ attendees: [self, colleague], startUtc: "2026-10-18T23:00:00Z" }),
        event({ attendees: [self, colleague], startUtc: "2026-10-13T01:00:00Z" }),
        event({ attendees: [self, colleague, client], startUtc: "2026-10-14T01:00:00Z" }),
        event({ attendees: [self, client], startUtc: "2026-10-15T01:00:00Z" }),
      ],
      ctx,
    );

    expect(evidence.meetingLoad).toEqual({
      max: 3,
      min: 1,
      sampleSize: 4,
      weeks: [
        { external: 2, internal: 1, weekStart: "2026-10-12" },
        { external: 0, internal: 1, weekStart: "2026-10-19" },
      ],
    });
  });

  it("counts a full week without meetings inside the range as the minimum load", () => {
    const meetings = [event({ startUtc: "2026-10-13T01:00:00Z" }), event({ startUtc: "2026-10-27T01:00:00Z" })];
    // Monday 2026-10-12 to Monday 2026-11-02 KST: three full weeks, the middle one empty.
    const range = { end: new Date("2026-11-02T00:00:00+09:00"), start: new Date("2026-10-11T12:00:00+09:00") };

    expect(computeEvidence(meetings, { ...ctx, range }).meetingLoad).toMatchObject({ max: 1, min: 0 });
    // Without the empty week the quietest week had one meeting.
    expect(computeEvidence(meetings, ctx).meetingLoad).toMatchObject({ max: 1, min: 1 });
    expect(
      computeEvidence(meetings, { ...ctx, range: { end: new Date("2026-10-19T12:00:00+09:00"), start: range.start } }).meetingLoad.min,
    ).toBe(1);
  });

  it("records the primary calendar's zone apart from the counting zone", () => {
    expect(computeEvidence([], { ...ctx, primaryTimeZone: "Europe/Paris" })).toMatchObject({
      primaryTimeZone: "Europe/Paris",
      timezone: "Asia/Seoul",
    });
    expect(computeEvidence([], ctx).primaryTimeZone).toBeNull();
  });

  it("treats cancelled, transparent and self-declined events as not busy", () => {
    const evidence = computeEvidence(
      [
        event({ status: "cancelled" }),
        event({ transparency: "transparent" }),
        event({ attendees: [{ ...self, responseStatus: "declined" }, colleague] }),
        // The host's address without the self flag still identifies the host.
        event({ attendees: [{ email: "HOST@example.test", responseStatus: "declined", self: false }, colleague] }),
        event(),
      ],
      ctx,
    );

    expect(evidence.preferredTimes.sampleSize).toBe(1);
  });

  it("does not count a meeting whose every other attendee declined, nor all-day events", () => {
    const evidence = computeEvidence(
      [
        event({ attendees: [self, { ...colleague, responseStatus: "declined" }] }),
        allDay({ attendees: [self, colleague] }),
      ],
      ctx,
    );

    expect(evidence.preferredTimes.sampleSize).toBe(0);
    expect(evidence.durations).toEqual({ medianMinutes: null, sampleSize: 0 });
    expect(evidence.noteLike.entries).toEqual([]);
  });

  it("merges copies of one event across calendars by provider identity only", () => {
    const original = event({ iCalUID: "same@google.com", startUtc: "2026-10-13T01:00:00Z" });
    const copy = { ...original, calendarId: "team@group.calendar.google.com", start: { dateTime: "2026-10-13T10:00:00+09:00" } };
    const nextInstance = event({ iCalUID: "same@google.com", startUtc: "2026-10-20T01:00:00Z" });
    const sameTitleOtherEvent = event({ startUtc: "2026-10-13T01:00:00Z", summary: original.summary });
    const noUid = event({ iCalUID: null, id: "plain" });
    const noUidCopy = { ...noUid, calendarId: "team@group.calendar.google.com" };

    const evidence = computeEvidence([original, copy, nextInstance, sameTitleOtherEvent, noUid, noUidCopy], ctx);

    expect(evidence.preferredTimes.sampleSize).toBe(4);
  });

  it("lists note-like entries, timed or all-day, with their identity, title and fingerprint", () => {
    const evidence = computeEvidence(
      [
        event({ attendees: [], hasConferenceLink: false, id: "focus", summary: "Focus time", updated: "2026-10-02T00:00:00Z" }),
        allDay({ id: "report", summary: "Write report", updated: "2026-10-03T00:00:00Z" }),
        // Not note-like: a location, a link, or another attendee.
        event({ attendees: [], hasConferenceLink: false, location: "Office" }),
        event({ attendees: [], hasConferenceLink: true }),
        event({ attendees: [self, { ...colleague, responseStatus: "declined" }], hasConferenceLink: false }),
        // Not busy, so not listed.
        allDay({ id: "free", transparency: "transparent" }),
      ],
      ctx,
    );

    expect(evidence.noteLike.entries).toEqual([
      {
        allDay: false,
        calendarId: host,
        eventId: "focus",
        fingerprint: "2026-10-02T00:00:00Z",
        start: "2026-10-13T01:00:00.000Z",
        title: "Focus time",
      },
      { allDay: true, calendarId: host, eventId: "report", fingerprint: "2026-10-03T00:00:00Z", start: "2026-10-14", title: "Write report" },
    ]);
    expect(evidence.preferredTimes.sampleSize).toBe(0);
  });

  it("takes places only from events with a location and no conference link", () => {
    const place = (location: string, hasConferenceLink = false) => event({ hasConferenceLink, location });
    const evidence = computeEvidence(
      [
        place("Blue Bottle Coffee, Seongsu, Seoul"),
        place("blue bottle coffee, Seongsu"),
        place("Office"),
        // A place and a link on one event decides nothing.
        place("Office", true),
        place("Office", true),
        place("Office", true),
      ],
      ctx,
    );

    expect(evidence.places).toEqual({
      area: { count: 2, name: "Seongsu" },
      sampleSize: 3,
      venue: { count: 2, name: "Blue Bottle Coffee" },
    });
    expect(placeHintFromEvidence(evidence)).toEqual({ area: "Seongsu", sampleSize: 3, venue: "Blue Bottle Coffee" });
  });

  it("reports the median length of counted meetings", () => {
    const evidence = computeEvidence(
      [event({ minutes: 30 }), event({ minutes: 45 }), event({ minutes: 60 }), event({ minutes: 90 })],
      ctx,
    );

    expect(evidence.durations).toEqual({ medianMinutes: 53, sampleSize: 4 });
  });

  it("stores no attendee address", () => {
    const evidence = computeEvidence([event({ attendees: [self, colleague, client] })], ctx);

    expect(JSON.stringify(evidence)).not.toContain("colleague@example.test");
    expect(JSON.stringify(evidence)).not.toContain("client@client.test");
  });
});

function evidenceWith(meetings: CalendarEvent[]) {
  return computeEvidence(meetings, ctx);
}

// n meetings on Tuesdays and Thursdays across two weeks, 10:00-11:00 KST and
// 14:00-14:30 KST.
function busyWeeks(n: number) {
  const starts = [
    ["2026-10-13T01:00:00Z", 60],
    ["2026-10-15T05:00:00Z", 30],
    ["2026-10-20T01:00:00Z", 60],
    ["2026-10-22T05:00:00Z", 30],
  ] as const;

  return Array.from({ length: n }, (_, index) => {
    const [startUtc, minutes] = starts[index % starts.length]!;
    return event({ minutes, startUtc });
  });
}

describe("suggestFromEvidence", () => {
  it("falls back to labeled starter defaults with the small-sample reason below five meetings", () => {
    const suggestions = suggestFromEvidence(evidenceWith(busyWeeks(2)), "Asia/Seoul");

    expect(suggestions.weeklyWindows).toMatchObject({
      sampleSize: 2,
      source: "starter_default",
      value: STARTER_DEFAULTS.weeklyWindows,
    });
    expect(suggestions.weeklyWindows!.reason).toContain("too few");
    expect(suggestions.durationMinutes).toMatchObject({ source: "starter_default", value: 30 });
    expect(suggestions.durationMinutes!.reason).toContain("too few");
    expect(suggestions.weeklyLimit).toMatchObject({ source: "starter_default", value: null });
  });

  it("infers windows, the weekly limit and duration from enough meetings", () => {
    const suggestions = suggestFromEvidence(evidenceWith(busyWeeks(8)), "Asia/Seoul");

    expect(suggestions.weeklyWindows).toMatchObject({
      sampleSize: 8,
      source: "inferred",
      value: [
        { end: "11:00", start: "10:00", weekday: "tuesday" },
        { end: "15:00", start: "14:00", weekday: "thursday" },
      ],
    });
    expect(suggestions.weeklyLimit).toMatchObject({ sampleSize: 8, source: "inferred", value: 4 });
    // Median of 30 and 60 minutes is 45.
    expect(suggestions.durationMinutes).toMatchObject({ sampleSize: 8, source: "inferred", value: 45 });
    expect(suggestions.timezone).toMatchObject({ source: "inferred", value: "Asia/Seoul" });
  });

  it("requires at least two weeks before inferring a weekly limit", () => {
    const oneWeek = Array.from({ length: 6 }, (_, index) => event({ startUtc: `2026-10-1${3 + (index % 3)}T0${index}:00:00Z` }));
    const suggestions = suggestFromEvidence(evidenceWith(oneWeek), null);

    expect(suggestions.weeklyLimit).toMatchObject({ source: "starter_default", value: null });
    expect(suggestions.weeklyWindows!.source).toBe("inferred");
    expect(suggestions.timezone).toBeUndefined();
  });

  it("keeps buffers, travel buffer and note exclusions as starter defaults and never suggests host answers", () => {
    const suggestions = suggestFromEvidence(evidenceWith(busyWeeks(8)), "Asia/Seoul");

    expect(suggestions.bufferBeforeMinutes).toMatchObject({ source: "starter_default", value: 10 });
    expect(suggestions.bufferAfterMinutes).toMatchObject({ source: "starter_default", value: 10 });
    expect(suggestions.travelBufferMinutes).toMatchObject({ source: "starter_default", value: 15 });
    expect(suggestions.noteExclusions).toMatchObject({ source: "starter_default", value: [] });
    expect(suggestions).not.toHaveProperty("meetingMode");
    expect(suggestions).not.toHaveProperty("location");
    expect(suggestions).not.toHaveProperty("travelMode");
  });

  it("keeps an overnight window's real next-day end", () => {
    const late = Array.from({ length: 5 }, (_, week) =>
      // Friday 22:00 KST for three hours (until Saturday 01:00), five weeks running.
      event({ minutes: 180, startUtc: new Date(Date.UTC(2026, 8, 18 + week * 7, 13)).toISOString() }),
    );
    const midnight = Array.from({ length: 5 }, (_, week) =>
      // Friday 22:00 KST for two hours, ending exactly at midnight.
      event({ minutes: 120, startUtc: new Date(Date.UTC(2026, 8, 18 + week * 7, 13)).toISOString() }),
    );

    expect(suggestFromEvidence(evidenceWith(late), "Asia/Seoul").weeklyWindows!.value).toEqual([
      { end: "01:00", start: "22:00", weekday: "friday" },
    ]);
    expect(suggestFromEvidence(evidenceWith(midnight), "Asia/Seoul").weeklyWindows!.value).toEqual([
      { end: "00:00", start: "22:00", weekday: "friday" },
    ]);
  });

  it("ends a window of a whole day or more a minute before its start hour", () => {
    // Tuesday 10:00 KST for 25 hours, five times.
    const long = Array.from({ length: 5 }, () => event({ minutes: 25 * 60, startUtc: "2026-10-13T01:00:00Z" }));

    expect(suggestFromEvidence(evidenceWith(long), null).weeklyWindows!.value).toEqual([
      { end: "09:59", start: "10:00", weekday: "tuesday" },
    ]);
  });

  it("rounds the median duration to 15 minutes, at least 15", () => {
    const short = Array.from({ length: 5 }, () => event({ minutes: 5 }));

    expect(suggestFromEvidence(evidenceWith(short), null).durationMinutes!.value).toBe(15);
  });
});

describe("countingZone", () => {
  it("counts in the zone setup will propose", () => {
    const zones = { chosen: null, settings: null, starter: "Asia/Seoul" };

    // The primary calendar's zone replaces the browser's unaccepted starter zone.
    expect(countingZone(zones, "Europe/Paris")).toBe("Europe/Paris");
    expect(countingZone(zones, null)).toBe("Asia/Seoul");
    expect(countingZone({ ...zones, chosen: "America/New_York" }, "Europe/Paris")).toBe("America/New_York");
    expect(countingZone({ ...zones, settings: "Asia/Tokyo" }, "Europe/Paris")).toBe("Asia/Tokyo");
    expect(countingZone({ chosen: null, settings: null, starter: null }, null)).toBe("UTC");
  });
});

describe("analysisForModel", () => {
  it("gives counts and quoted calendar names but no titles, identities or place names", () => {
    const evidence: AnalysisEvidence = computeEvidence(
      [event({ attendees: [], hasConferenceLink: false, id: "secret-event", summary: "Therapy appointment" }), ...busyWeeks(5)],
      ctx,
    );
    const projection = analysisForModel({
      calendars: [{ id: host, ok: true, summary: "Me" }],
      completedAt: "2026-10-19T00:01:00.000Z",
      createdAt: "2026-10-19T00:00:00.000Z",
      evidence,
      failureCategory: null,
      id: "analysis",
      range: { end: "2026-11-16T00:00:00.000Z", start: "2026-09-21T00:00:00.000Z" },
      state: "completed",
    });
    const text = JSON.stringify(projection);

    expect(projection.evidence!.noteLikeCount).toBe(1);
    expect(projection.calendars).toEqual([{ name: '"Me"', ok: true }]);
    expect(projection.evidence!.places).toEqual({ sampleSize: evidence.places.sampleSize });
    expect(text).not.toContain("Therapy appointment");
    expect(text).not.toContain("secret-event");
    expect(text).not.toContain(host);
  });
});

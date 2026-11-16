import { describe, expect, it } from "vitest";
import type { AnalysisEvidence } from "../contracts/analysis";
import { STARTER_DEFAULTS, WEEKDAYS } from "../contracts/setup";
import { analysisForModel, computeEvidence, countingZone, hoursSuggestion, placeHintFromEvidence, suggestFromEvidence } from "./analysis";
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

  it("lists note candidates, timed or all-day, with their identity, title, fingerprint and shape", () => {
    const evidence = computeEvidence(
      [
        event({ attendees: [], hasConferenceLink: false, id: "focus", summary: "Focus time", updated: "2026-10-02T00:00:00Z" }),
        allDay({ id: "report", summary: "Write report", updated: "2026-10-03T00:00:00Z" }),
        // A location or a link no longer rules an entry out: "헬스" at a gym may be a note.
        event({ attendees: [], hasConferenceLink: false, id: "gym", location: "Gym", summary: "헬스" }),
        event({ attendees: [self], hasConferenceLink: true, id: "solo-call" }),
      ],
      ctx,
    );

    expect(evidence.noteLike.entries.map((entry) => entry.eventId)).toEqual(["focus", "report", "gym", "solo-call"]);
    expect(evidence.noteLike.entries[0]).toEqual({
      allDay: false,
      calendarId: host,
      end: "2026-10-13T01:30:00.000Z",
      eventId: "focus",
      fingerprint: "2026-10-02T00:00:00Z",
      hasConferenceLink: false,
      hasLocation: false,
      seriesId: null,
      start: "2026-10-13T01:00:00.000Z",
      title: "Focus time",
    });
    expect(evidence.noteLike.entries[1]).toMatchObject({ allDay: true, end: "2026-10-15", start: "2026-10-14", title: "Write report" });
    expect(evidence.noteLike.entries[2]).toMatchObject({ hasConferenceLink: false, hasLocation: true, title: "헬스" });
    // The location text itself is never part of a candidate.
    expect(JSON.stringify(evidence.noteLike.entries)).not.toContain("Gym");
    expect(evidence.noteLike.entries[3]).toMatchObject({ hasConferenceLink: true, hasLocation: false });
  });

  it("never lists an event with a guest, a transparent event or one the host declined", () => {
    const evidence = computeEvidence(
      [
        event({ attendees: [self, colleague], hasConferenceLink: false, id: "with-guest" }),
        event({ attendees: [colleague], hasConferenceLink: false, id: "guest-without-self" }),
        // An invited guest, even one who declined, makes it a real event.
        event({ attendees: [self, { ...colleague, responseStatus: "declined" }], hasConferenceLink: false, id: "declined-guest" }),
        allDay({ id: "free-day", transparency: "transparent" }),
        event({ attendees: [], hasConferenceLink: false, id: "free-time", transparency: "transparent" }),
        event({ attendees: [{ ...self, responseStatus: "declined" }], hasConferenceLink: false, id: "declined" }),
        event({ attendees: [], hasConferenceLink: false, id: "cancelled", status: "cancelled" }),
        // Opaque is Google's default, written out or absent.
        allDay({ id: "birthday", summary: "엄마 생일", transparency: "opaque" }),
      ],
      ctx,
    );

    expect(evidence.noteLike.entries.map((entry) => entry.eventId)).toEqual(["birthday"]);
  });

  it("leaves out entries the host answered while their fingerprint matches", () => {
    const answer = (calendarId: string, eventId: string, fingerprint: string, scope: "series" | "occurrence" = "occurrence") =>
      ({ calendarId, eventId, fingerprint, scope });
    const answers = [
      answer(host, "kept", "2026-10-02T00:00:00Z"),
      answer(host, "edited", "2026-10-02T00:00:00Z"),
      answer(host, "recycling", "2026-10-05T00:00:00Z", "series"),
      // The same event ID on another calendar is another event.
      answer("team@group.calendar.google.com", "other-calendar", "2026-10-02T00:00:00Z"),
    ];
    const note = (overrides: Parameters<typeof event>[0]) =>
      event({ attendees: [], hasConferenceLink: false, updated: "2026-10-02T00:00:00Z", ...overrides });
    const evidence = computeEvidence(
      [
        note({ id: "kept", summary: "헬스" }),
        // Edited after the answer: a new candidate.
        note({ id: "edited", updated: "2026-10-09T00:00:00Z" }),
        // Every occurrence of a series answered as a whole.
        note({ id: "recycling_20261013", recurringEventId: "recycling", updated: "2026-10-05T00:00:00Z" }),
        note({ id: "recycling_20261020", recurringEventId: "recycling", startUtc: "2026-10-20T01:00:00Z", updated: "2026-10-05T00:00:00Z" }),
        // Google gives occurrences of one series their own updated times: an earlier
        // one is still answered, one edited after the answer is asked again.
        note({ id: "recycling_20261027", recurringEventId: "recycling", startUtc: "2026-10-27T01:00:00Z", updated: "2026-09-20T00:00:00Z" }),
        note({ id: "recycling_20261103", recurringEventId: "recycling", startUtc: "2026-11-03T01:00:00Z", updated: "2026-10-06T00:00:00Z" }),
        note({ id: "other-calendar" }),
        note({ id: "unanswered" }),
      ],
      { ...ctx, answers },
    );

    expect(evidence.noteLike.entries.map((entry) => entry.eventId)).toEqual(["edited", "recycling_20261103", "other-calendar", "unanswered"]);
  });

  // The scan reads four weeks back and ahead, but only entries still ahead are
  // note candidates: freeing a past entry opens no time.
  describe("only entries that have not ended", () => {
    // Tuesday 2026-10-13 10:30 KST.
    const now = new Date("2026-10-13T01:30:00Z");
    const note = (overrides: Parameters<typeof event>[0]) => event({ attendees: [], hasConferenceLink: false, ...overrides });
    const candidates = (events: CalendarEvent[]) => computeEvidence(events, { ...ctx, now }).noteLike.entries.map((entry) => entry.eventId);

    it("leaves out a past entry", () => {
      expect(
        candidates([
          note({ id: "yesterday", startUtc: "2026-10-12T01:00:00Z" }),
          // Ended exactly now.
          note({ id: "just-ended", minutes: 30, startUtc: "2026-10-13T01:00:00Z" }),
          allDay({ end: { date: "2026-10-13" }, id: "past-day", start: { date: "2026-10-12" } }),
          note({ id: "tomorrow", startUtc: "2026-10-14T01:00:00Z" }),
        ]),
      ).toEqual(["tomorrow"]);
    });

    it("keeps an entry in progress, timed or all-day", () => {
      expect(
        candidates([
          note({ id: "now", minutes: 60, startUtc: "2026-10-13T01:00:00Z" }),
          // Today in Seoul, ending at tomorrow's start.
          allDay({ end: { date: "2026-10-14" }, id: "today", start: { date: "2026-10-13" } }),
        ]),
      ).toEqual(["now", "today"]);
    });

    it("leaves out a series whose listed occurrences have all passed, and keeps the next one of a running series", () => {
      expect(
        candidates([
          note({ id: "old_1", recurringEventId: "old", startUtc: "2026-09-29T01:00:00Z" }),
          note({ id: "old_2", recurringEventId: "old", startUtc: "2026-10-06T01:00:00Z" }),
          note({ id: "weekly_1", recurringEventId: "weekly", startUtc: "2026-10-06T01:00:00Z" }),
          note({ id: "weekly_2", recurringEventId: "weekly", startUtc: "2026-10-20T01:00:00Z" }),
        ]),
      ).toEqual(["weekly_2"]);
    });

    it("still counts past meetings toward the hours and the load", () => {
      const evidence = computeEvidence([event({ startUtc: "2026-10-06T01:00:00Z" })], { ...ctx, now });
      expect(evidence.preferredTimes.sampleSize).toBe(1);
      expect(evidence.noteLike.entries).toEqual([]);
    });
  });

  it("keeps the series of a recurring candidate", () => {
    const evidence = computeEvidence(
      [event({ attendees: [], hasConferenceLink: false, id: "recycling_20261013", recurringEventId: "recycling", summary: "분리수거" })],
      ctx,
    );

    expect(evidence.noteLike.entries[0]).toMatchObject({ eventId: "recycling_20261013", seriesId: "recycling" });
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

    expect(evidence.places).toMatchObject({
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

  it("infers windows and duration but keeps no weekly limit even with enough meetings", () => {
    const suggestions = suggestFromEvidence(evidenceWith(busyWeeks(8)), "Asia/Seoul");

    expect(suggestions.weeklyWindows).toMatchObject({
      sampleSize: 8,
      source: "inferred",
      value: WEEKDAYS.slice(0, 5).map(weekday => ({ end: "15:00", start: "10:00", weekday })),
    });
    expect(suggestions.weeklyLimit).toEqual({
      reason: "No limit unless you set one.",
      sampleSize: null,
      source: "starter_default",
      value: null,
    });
    // Median of 30 and 60 minutes is 45.
    expect(suggestions.durationMinutes).toMatchObject({ sampleSize: 8, source: "inferred", value: 45 });
    expect(suggestions.timezone).toMatchObject({ source: "inferred", value: "Asia/Seoul" });
  });

  it("keeps no weekly limit with meetings in only one week", () => {
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

    expect(suggestFromEvidence(evidenceWith(late), "Asia/Seoul").weeklyWindows!.value).toEqual(WEEKDAYS.slice(0, 5).map(weekday => ({ end: "01:00", start: "22:00", weekday })));
    expect(suggestFromEvidence(evidenceWith(midnight), "Asia/Seoul").weeklyWindows!.value).toEqual(WEEKDAYS.slice(0, 5).map(weekday => ({ end: "00:00", start: "22:00", weekday })));
  });

  it("ends a window of a whole day or more a minute before its start hour", () => {
    // Tuesday 10:00 KST for 25 hours, five times.
    const long = Array.from({ length: 5 }, () => event({ minutes: 25 * 60, startUtc: "2026-10-13T01:00:00Z" }));

    expect(suggestFromEvidence(evidenceWith(long), null).weeklyWindows!.value).toEqual(WEEKDAYS.slice(0, 5).map(weekday => ({ end: "09:59", start: "10:00", weekday })));
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

describe("chat hours", () => {
  it("counts located appointments and ignores a single early and late outlier across weekdays", () => {
    const events = [
      event({ startUtc: "2026-10-12T00:30:00Z", minutes: 750 }),
      event({ startUtc: "2026-10-13T00:30:00Z", minutes: 750 }),
      event({ startUtc: "2026-10-14T02:00:00Z" }),
      event({ startUtc: "2026-10-15T02:00:00Z", attendees: [], location: "Station", hasConferenceLink: false }),
      event({ startUtc: "2026-10-16T02:00:00Z" }),
      event({ startUtc: "2026-10-16T00:00:00Z", minutes: 900 }),
    ];
    const evidence = computeEvidence(events, ctx);
    expect(evidence.preferredTimes.sampleSize).toBe(6);
    expect(suggestFromEvidence(evidence, null).weeklyWindows).toMatchObject({ source: "inferred", value:
      ["monday", "tuesday", "wednesday", "thursday", "friday"].map(weekday => ({ weekday, start: "09:00", end: "22:00" })) });
  });

  it("uses 10–20 for fewer than five counted events", () => {
    expect(STARTER_DEFAULTS.weeklyWindows).toEqual(
      ["monday", "tuesday", "wednesday", "thursday", "friday"].map(weekday => ({ weekday, start: "10:00", end: "20:00" })));
    expect(hoursSuggestion(evidenceWith(busyWeeks(4)))).toEqual({
      weekdays: { start: "10:00", end: "20:00" }, weekend: [], source: "starter_default", sampleSize: 4,
    });
  });

  it("uses the earliest start and latest end for exactly two weekday events without inverting", () => {
    const events = [
      event({ startUtc: "2026-10-13T00:15:00Z", minutes: 45 }),
      event({ startUtc: "2026-10-14T09:00:00Z", minutes: 45 }),
      ...Array.from({ length: 3 }, () => event({ startUtc: "2026-10-17T01:30:00Z", minutes: 120 })),
    ];
    expect(hoursSuggestion(evidenceWith(events))).toEqual({
      weekdays: { start: "09:00", end: "19:00" },
      weekend: [{ weekday: "saturday", start: "10:00", end: "13:00" }], source: "inferred", sampleSize: 5,
    });
  });

  it.each([0, 1])("keeps weekday defaults with %i weekday events and weekend evidence", (weekdayCount) => {
    const events = [
      ...busyWeeks(weekdayCount),
      ...Array.from({ length: 3 }, () => event({ startUtc: "2026-10-17T01:30:00Z", minutes: 120 })),
      event({ startUtc: "2026-10-18T00:15:00Z", minutes: 45 }),
      event({ startUtc: "2026-10-25T09:00:00Z", minutes: 45 }),
    ];
    const evidence = evidenceWith(events);
    expect(hoursSuggestion(evidence)).toEqual({
      weekdays: { start: "10:00", end: "20:00" },
      weekend: [
        { weekday: "saturday", start: "10:00", end: "13:00" },
        { weekday: "sunday", start: "09:00", end: "19:00" },
      ], source: "inferred", sampleSize: 5 + weekdayCount,
    });
    expect(suggestFromEvidence(evidence, null).weeklyWindows).toMatchObject({
      source: "inferred", value: [
        ...WEEKDAYS.slice(0, 5).map(weekday => ({ weekday, start: "10:00", end: "20:00" })),
        { weekday: "saturday", start: "10:00", end: "13:00" },
        { weekday: "sunday", start: "09:00", end: "19:00" },
      ],
    });
  });
});

it("includes a weekend day only with two counted events, and exports the fixed question shape", () => {
  const weekday = busyWeeks(8);
  const saturday = [event({ startUtc: "2026-10-17T01:30:00Z", minutes: 120 }), event({ startUtc: "2026-10-24T02:30:00Z", minutes: 120 })];
  const sunday = event({ startUtc: "2026-10-18T01:00:00Z" });
  expect(hoursSuggestion(computeEvidence([...weekday, ...saturday, sunday], ctx))).toEqual({
    weekdays: { start: "10:00", end: "15:00" }, weekend: [{ weekday: "saturday", start: "10:00", end: "14:00" }], source: "inferred", sampleSize: 11,
  });
  expect(hoursSuggestion(null)).toEqual({ weekdays: { start: "10:00", end: "20:00" }, weekend: [], source: "starter_default", sampleSize: 0 });
});

it("keeps the complete location strings as the five most frequent candidates", () => {
  const events = ["A", "B", "C", "D", "E", "F", "F"].map(location => event({ location, hasConferenceLink: false, attendees: [] }));
  expect(computeEvidence(events, ctx).places.candidates).toEqual([
    { name: "F", count: 2 }, ...["A", "B", "C", "D"].map(name => ({ name, count: 1 })),
  ]);
});

it("does not widen the end for a lone 22:00 event when the next latest end is 18:30", () => {
  const events = [510, 510, 480, 480, 720].map(minutes => event({ minutes }));
  expect(hoursSuggestion(computeEvidence(events, ctx)).weekdays).toEqual({ start: "10:00", end: "19:00" });
});

describe("trips that could share a day", () => {
  // An in-person event at a place on a Seoul local day (09:00 KST at 00:00Z).
  const at = (location: string, day: string, extra: Parameters<typeof event>[0] = {}) =>
    event({ hasConferenceLink: false, location, startUtc: `${day}T01:00:00Z`, ...extra });

  it("counts days away at a place that recurs on another day, never naming it", () => {
    const evidence = computeEvidence(
      [
        at("Cafe A, Yeoksam", "2026-10-13"),
        at("Office, Yeoksam", "2026-10-14"),
        at("Bakery, Yeoksam", "2026-10-15"),
        // Pangyo on two separate days: those trips could have shared one.
        at("Client HQ, Pangyo", "2026-10-13", { startUtc: "2026-10-13T06:00:00Z" }),
        at("Lab, Pangyo", "2026-10-16"),
        // Once only: nothing to share.
        at("Studio, Hongdae", "2026-10-17"),
        // A link decides nothing.
        at("Room, Pangyo", "2026-10-19", { hasConferenceLink: true }),
      ],
      ctx,
    );

    expect(evidence.trips).toEqual({ inPersonDays: 5, repeatedAwayDays: 2 });
    expect(JSON.stringify(analysisForModel({
      calendars: [], completedAt: null, createdAt: "", evidence, failureCategory: null, id: "a",
      range: { end: "", start: "" }, state: "completed",
    }).evidence?.trips)).not.toMatch(/Pangyo|Yeoksam/);
  });

  it("suggests grouping trips only when such days exist, and otherwise the starter default off", () => {
    const repeated = suggestFromEvidence(
      evidenceWith([at("A, Yeoksam", "2026-10-13"), at("B, Yeoksam", "2026-10-14"), at("C, Pangyo", "2026-10-15"), at("D, Pangyo", "2026-10-20")]),
      "Asia/Seoul",
    );
    expect(repeated.groupTrips).toMatchObject({ sampleSize: 4, source: "inferred", value: true });
    expect(repeated.groupTrips!.reason).not.toMatch(/Pangyo|Yeoksam/);

    const local = suggestFromEvidence(evidenceWith([at("A, Yeoksam", "2026-10-13"), at("B, Yeoksam", "2026-10-14")]), "Asia/Seoul");
    expect(local.groupTrips).toMatchObject({ source: "starter_default", value: false });

    // A scan stored before the dimension existed.
    const { trips: _trips, ...older } = evidenceWith(busyWeeks(8));
    expect(suggestFromEvidence(older, "Asia/Seoul").groupTrips).toMatchObject({ source: "starter_default", value: false });
  });
});

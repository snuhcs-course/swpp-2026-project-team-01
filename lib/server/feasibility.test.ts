import { describe, expect, it } from "vitest";
import type { WeeklyWindow } from "../contracts/setup";
import { computeEvidence } from "./analysis";
import {
  applyRanking,
  type BusyInterval,
  CANDIDATE_LIMIT,
  displayTime,
  type Endpoint,
  evaluateFeasibility,
  type FeasibilityInput,
  type HostRules,
  legQueryKey,
  normalizeBusy,
  requesterProjection,
  resolveLocalTime,
  type RouteOutcome,
  travelQueries,
  tripQueries,
} from "./feasibility";
import type { CalendarEvent } from "./google-calendar";

// Fixtures in Asia/Seoul (no clock changes) unless a test is about clock changes.
// The fake clock is the input's `now`; nothing reads the real time.

const NOW = new Date("2026-10-30T00:00:00Z");

function kst(date: string, clock: string) {
  return new Date(`${date}T${clock}:00+09:00`);
}

const weekdays = (start: string, end: string): WeeklyWindow[] =>
  (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map((weekday) => ({ end, start, weekday }));

const HOST: HostRules = {
  bufferAfterMinutes: 10,
  bufferBeforeMinutes: 10,
  meetingMode: "either",
  timezone: "Asia/Seoul",
  travelBufferMinutes: 15,
  travelMode: "transit",
  weeklyLimit: null,
  weeklyLimitCounts: "bookings",
  weeklyWindows: weekdays("10:00", "17:00"),
};

// Stands in for the evaluation's keyed hash: opaque, and different per text.
const hashed = (text: string) => `h:${Buffer.from(text).toString("hex")}`;
const place = (text: string): Endpoint => ({ key: hashed(text), kind: "place", text });
const MEETING = { key: hashed("Cafe Onion, Seongsu"), text: "Cafe Onion, Seongsu" };

function busy(start: Date, end: Date, endpoint: Endpoint = { kind: "unknown", reason: "no_location" }): BusyInterval {
  return { allDay: false, end: end.getTime(), endpoint, meeting: false, start: start.getTime() };
}

function input(
  overrides: Partial<Omit<FeasibilityInput, "request">> & { request?: Partial<FeasibilityInput["request"]> } = {},
): FeasibilityInput {
  const { request, ...rest } = overrides;
  return {
    hostBusy: [],
    now: NOW,
    requesterBusy: null,
    ...rest,
    host: { ...HOST, ...overrides.host },
    request: {
      durationMinutes: 30,
      linkPlan: null,
      location: null,
      mode: "online",
      timezone: "Asia/Seoul",
      travelMode: null,
      windows: [{ end: kst("2026-11-02", "13:00"), start: kst("2026-11-02", "10:00") }],
      ...request,
    },
  };
}

const starts = (result: ReturnType<typeof evaluateFeasibility>) => result.candidates.map((candidate) => candidate.start);
// The offered times in time order, for tests about which times pass rather
// than the order they are offered in.
const timeline = (result: ReturnType<typeof evaluateFeasibility>) => [...starts(result)].sort();

function routes(minutes: Record<string, number | "none" | "failed">) {
  return (query: { origin: string; destination: string }): RouteOutcome => {
    const value = minutes[`${query.origin} -> ${query.destination}`];
    if (value === undefined) return { outcome: "failed" };
    if (value === "none") return { outcome: "no_route" };
    if (value === "failed") return { outcome: "failed" };
    return { durationSeconds: value * 60, outcome: "route" };
  };
}

describe("local times", () => {
  it("resolves one instant normally, none in a spring gap and two in a fall overlap", () => {
    expect(resolveLocalTime("2026-11-02", "10:00", "Asia/Seoul")).toEqual([kst("2026-11-02", "10:00").getTime()]);
    expect(resolveLocalTime("2027-03-14", "02:30", "America/New_York")).toEqual([]);
    expect(resolveLocalTime("2026-11-01", "01:30", "America/New_York")).toEqual([
      Date.parse("2026-11-01T05:30:00Z"),
      Date.parse("2026-11-01T06:30:00Z"),
    ]);
  });

  it("shows the same instants with each zone's date-specific offset", () => {
    const start = new Date("2026-11-02T01:00:00Z");
    expect(displayTime(start, "Asia/Seoul")).toBe("Mon 2 Nov, 10:00 GMT+9");
    expect(displayTime(start, "America/New_York")).toBe("Sun 1 Nov, 20:00 GMT-5");
    // A week earlier New York was still on daylight time.
    expect(displayTime(new Date("2026-10-26T01:00:00Z"), "America/New_York")).toBe("Sun 25 Oct, 21:00 GMT-4");
  });
});

describe("deterministic intervals", () => {
  it("offers full intervals inside both the host hours and the requested windows on a 15-minute grid", () => {
    const result = evaluateFeasibility(
      input({ request: { windows: [{ end: kst("2026-11-02", "11:10"), start: kst("2026-11-02", "09:05") }] } }),
    );

    expect(starts(result)).toEqual(
      ["10:00", "10:15", "10:30"].map((clock) => kst("2026-11-02", clock).toISOString()),
    );
    expect(result.candidates[0]!.basis[0]).toBe("Inside your Monday hours 10:00–17:00 in Asia/Seoul.");
  });

  it("orders preferred afternoon times first while keeping other feasible times", () => {
    const result = evaluateFeasibility(input({ request: {
      windows: [{ start: kst("2026-11-02", "10:00"), end: kst("2026-11-02", "17:00") }],
      preferredWindows: [{ start: kst("2026-11-02", "12:00"), end: kst("2026-11-02", "17:00") }],
    } }));
    expect(starts(result)[0]).toBe(kst("2026-11-02", "12:00").toISOString());
    expect(starts(result)).toContain(kst("2026-11-02", "10:00").toISOString());
  });

  it("still offers morning when all preferred afternoon times are busy", () => {
    const day = "2026-11-02";
    const result = evaluateFeasibility(input({
      hostBusy: [busy(kst(day, "12:00"), kst(day, "17:00"))],
      request: {
        windows: [{ start: kst(day, "10:00"), end: kst(day, "17:00") }],
        preferredWindows: [{ start: kst(day, "12:00"), end: kst(day, "17:00") }],
      },
    }));
    expect(starts(result)).toContain(kst(day, "10:00").toISOString());
    expect(starts(result).every((start) => new Date(start) < kst(day, "12:00"))).toBe(true);
  });

  it("keeps non-preferred alternatives when preferred candidates fill the limit", () => {
    const windows = ["2026-11-02", "2026-11-03", "2026-11-04"].map((date) => ({ start: kst(date, "10:00"), end: kst(date, "17:00") }));
    const preferredWindows = ["2026-11-02", "2026-11-03", "2026-11-04"].map((date) => ({ start: kst(date, "12:00"), end: kst(date, "17:00") }));
    const result = evaluateFeasibility(input({ request: { windows, preferredWindows } }));
    expect(result.candidates.length).toBe(40);
    expect(starts(result)[0]).toBe(kst("2026-11-02", "12:00").toISOString());
    expect(starts(result)).toContain(kst("2026-11-02", "10:00").toISOString());
  });

  it("prioritizes a weekly preference without excluding other feasible times", () => {
    const windows = ["2026-11-02", "2026-11-03"].map((date) => ({ start: kst(date, "10:00"), end: kst(date, "17:00") }));
    const result = evaluateFeasibility(input({ request: { windows, preferredWeeklyWindows: [{ weekday: "tuesday", start: "12:00", end: "17:00" }] } }));
    expect(starts(result)[0]).toBe(kst("2026-11-03", "12:00").toISOString());
    expect(starts(result)).toContain(kst("2026-11-02", "10:00").toISOString());
  });

  it("recognizes a weekly preference crossing midnight", () => {
    const result = evaluateFeasibility(input({
      host: { ...HOST, weeklyWindows: [{ weekday: "monday", start: "21:00", end: "03:00" }] },
      request: { windows: [{ start: kst("2026-11-02", "21:00"), end: kst("2026-11-03", "03:00") }], preferredWeeklyWindows: [{ weekday: "monday", start: "23:00", end: "02:00" }] },
    }));
    expect(starts(result)[0]).toBe(kst("2026-11-02", "23:00").toISOString());
    expect(starts(result)).toContain(kst("2026-11-03", "01:00").toISOString());
    expect(starts(result)).toContain(kst("2026-11-02", "21:00").toISOString());
  });

  it("never offers a start at or before the clock", () => {
    const result = evaluateFeasibility(input({ now: kst("2026-11-02", "12:20") }));
    expect(starts(result)).toEqual([kst("2026-11-02", "12:30").toISOString()]);
  });

  it("applies the buffers before and after busy time", () => {
    const result = evaluateFeasibility(
      input({ hostBusy: [busy(kst("2026-11-02", "11:00"), kst("2026-11-02", "11:30"))] }),
    );

    // 10:30 would end at 11:00, 10 minutes short of the buffer; 11:30 starts inside it.
    expect(timeline(result)).toEqual(
      ["10:00", "10:15", "11:45", "12:00", "12:15", "12:30"].map((clock) => kst("2026-11-02", clock).toISOString()),
    );
    expect(result.exclusionCounts.host_busy).toBe(5);
  });

  it("excludes a candidate overlapping a host focus block", () => {
    const focus = normalizeBusy(
      [event({ end: "2026-11-02T03:00:00Z", id: "focus", start: "2026-11-02T01:00:00Z", summary: "Focus time" })],
      { endpointKey: hashed, selfEmail: "host@example.test", timezone: "Asia/Seoul" },
    );
    const result = evaluateFeasibility(input({ hostBusy: focus }));

    expect(starts(result)[0]).toBe(kst("2026-11-02", "12:15").toISOString());
  });

  it("excludes a busy requester interval without telling the host about the event", () => {
    const result = evaluateFeasibility(
      input({ requesterBusy: [busy(kst("2026-11-02", "10:00"), kst("2026-11-02", "12:00"), place("Private clinic"))] }),
    );

    expect(starts(result)[0]).toBe(kst("2026-11-02", "12:00").toISOString());
    expect(result.exclusions.filter((entry) => entry.reason === "requester_unavailable")).toHaveLength(8);
    expect(JSON.stringify(result)).not.toContain("clinic");
  });

  it("does not let a declined, cancelled or transparent event block time", () => {
    const events = normalizeBusy(
      [
        event({ attendees: [{ email: "guest@example.test", responseStatus: "declined", self: true }], id: "declined" }),
        event({ id: "cancelled", status: "cancelled" }),
        event({ id: "free", transparency: "transparent" }),
      ],
      { endpointKey: hashed, selfEmail: "guest@example.test", timezone: "Asia/Seoul" },
    );

    expect(events).toEqual([]);
  });

  it("merges copies, removes confirmed note-like entries and blocks all-day dates", () => {
    const events = normalizeBusy(
      [
        event({ calendarId: "a", iCalUID: "same@google.com", id: "one" }),
        event({ calendarId: "b", iCalUID: "same@google.com", id: "two" }),
        event({ calendarId: "a", id: "note", updated: "2026-10-01T00:00:00Z" }),
        event({ calendarId: "a", id: "changed-note", updated: "2026-10-05T00:00:00Z" }),
        event({ end: { date: "2026-11-03" }, id: "holiday", start: { date: "2026-11-02" } }),
      ],
      {
        endpointKey: hashed,
        noteExclusions: [
          { calendarId: "a", eventId: "note", fingerprint: "2026-10-01T00:00:00Z" },
          { calendarId: "a", eventId: "changed-note", fingerprint: "2026-10-01T00:00:00Z" },
        ],
        selfEmail: null,
        timezone: "Asia/Seoul",
      },
    );

    expect(events).toHaveLength(3);
    expect(events.find((entry) => entry.allDay)).toMatchObject({
      end: kst("2026-11-03", "00:00").getTime(),
      start: kst("2026-11-02", "00:00").getTime(),
    });
  });

  it("skips every occurrence of a series excluded as a whole until it is edited", () => {
    const events = normalizeBusy(
      [
        event({ calendarId: "birthdays", id: "mom_2026", recurringEventId: "mom", updated: "2026-10-01T00:00:00Z" }),
        event({ calendarId: "birthdays", id: "mom_2027", recurringEventId: "mom", updated: "2026-09-01T00:00:00Z" }),
        event({ calendarId: "birthdays", id: "mom_2028", recurringEventId: "mom", updated: "2026-10-20T00:00:00Z" }),
      ],
      {
        endpointKey: hashed,
        noteExclusions: [{ calendarId: "birthdays", eventId: "mom", fingerprint: "2026-10-01T00:00:00Z", scope: "series" }],
        selfEmail: null,
        timezone: "Asia/Seoul",
      },
    );

    expect(events).toHaveLength(1);
  });

  it("offers nothing when the host and requested modes conflict", () => {
    const result = evaluateFeasibility(input({ host: { ...HOST, meetingMode: "online" }, request: { mode: "in_person" } }));
    expect(result.mode).toBeNull();
    expect(result.candidates).toEqual([]);
  });

  it("plans Google Meet for an online meeting only when the destination allows it", () => {
    expect(evaluateFeasibility(input({ meetAvailable: true })).linkPlan).toEqual({ kind: "google_meet" });
    expect(evaluateFeasibility(input({ meetAvailable: false })).linkPlan).toBeNull();
    const link = { kind: "requester_link" as const, url: "https://example.test/room" };
    expect(evaluateFeasibility(input({ meetAvailable: true, request: { linkPlan: link } })).linkPlan).toEqual(link);
  });
});

describe("overnight windows and clock changes", () => {
  const overnight = (weekday: WeeklyWindow["weekday"]): WeeklyWindow[] => [{ end: "02:00", start: "22:00", weekday }];

  it("finds a request that only names the following morning inside the starting day's window", () => {
    const tuesday = { end: kst("2026-11-03", "01:30"), start: kst("2026-11-03", "01:00") };
    const wednesday = { end: kst("2026-11-04", "01:30"), start: kst("2026-11-04", "01:00") };
    const result = evaluateFeasibility(
      input({ host: { ...HOST, weeklyWindows: overnight("monday") }, request: { windows: [tuesday, wednesday] } }),
    );

    expect(starts(result)).toEqual([tuesday.start.toISOString()]);
  });

  it("lets the starting Saturday own the window while the requester is on another date", () => {
    const window = { end: new Date("2026-11-07T17:00:00Z"), start: new Date("2026-11-07T14:00:00Z") };
    const result = evaluateFeasibility(
      input({
        host: { ...HOST, weeklyWindows: [{ end: "01:00", start: "23:00", weekday: "saturday" }] },
        request: { timezone: "America/Los_Angeles", windows: [window] },
      }),
    );

    // Saturday 23:00 to Sunday 01:00 in Seoul is Saturday 06:00 to 08:00 in Los Angeles.
    expect(starts(result)[0]).toBe("2026-11-07T14:00:00.000Z");
    expect(result.candidates.at(-1)!.end).toBe("2026-11-07T16:00:00.000Z");
    expect(result.candidates[0]!.basis[0]).toContain("Saturday hours 23:00–01:00 (next day)");
  });

  it("uses the actual elapsed time of a night with a clock change", () => {
    const host = { ...HOST, timezone: "America/New_York", weeklyWindows: [{ end: "03:00", start: "23:00", weekday: "saturday" as const }] };
    const window = { end: new Date("2026-11-01T12:00:00Z"), start: new Date("2026-10-31T12:00:00Z") };
    const result = evaluateFeasibility(input({ host, request: { durationMinutes: 60, windows: [window] } }));

    // 23:00 EDT to 03:00 EST is five hours, so 17 one-hour starts on the 15-minute grid.
    expect(result.candidates).toHaveLength(17);
    expect(result.candidates.map((candidate) => candidate.end).sort().at(-1)).toBe("2026-11-01T08:00:00.000Z");
  });

  it("yields nothing for a window whose end is ambiguous or does not exist", () => {
    const fallBack = evaluateFeasibility(
      input({
        host: { ...HOST, timezone: "America/New_York", weeklyWindows: [{ end: "01:30", start: "22:00", weekday: "saturday" }] },
        request: { windows: [{ end: new Date("2026-11-01T12:00:00Z"), start: new Date("2026-10-31T12:00:00Z") }] },
      }),
    );
    const springForward = evaluateFeasibility(
      input({
        host: { ...HOST, timezone: "America/New_York", weeklyWindows: [{ end: "02:30", start: "22:00", weekday: "saturday" }] },
        now: new Date("2027-03-01T00:00:00Z"),
        request: { windows: [{ end: new Date("2027-03-14T12:00:00Z"), start: new Date("2027-03-13T12:00:00Z") }] },
      }),
    );

    expect(fallBack.candidates).toEqual([]);
    expect(fallBack.unresolvedWindows).toEqual([{ boundary: "end", date: "2026-10-31", problem: "ambiguous", weekday: "saturday" }]);
    expect(springForward.candidates).toEqual([]);
    expect(springForward.unresolvedWindows[0]).toMatchObject({ boundary: "end", problem: "nonexistent" });
  });
});

describe("weekly limit", () => {
  it("prioritizes the host's weekly limit over the guest's preferred time", () => {
    const thisWeek = { end: kst("2026-11-02", "11:00"), start: kst("2026-11-02", "10:00") };
    const nextWeek = { end: kst("2026-11-09", "11:00"), start: kst("2026-11-09", "10:00") };
    const result = evaluateFeasibility(input({ bookedStarts: [kst("2026-11-03", "15:00").getTime()], host: { ...HOST, weeklyLimit: 1 }, request: { windows: [thisWeek, nextWeek], preferredWindows: [thisWeek] } }));
    expect(starts(result)[0]).toBe(nextWeek.start.toISOString());
    expect(starts(result)).toContain(thisWeek.start.toISOString());
  });

  it("places a less preferred day after other available days without excluding it", () => {
    const monday = { start: kst("2026-11-02", "10:00"), end: kst("2026-11-02", "11:00") };
    const tuesday = { start: kst("2026-11-03", "10:00"), end: kst("2026-11-03", "11:00") };
    const result = evaluateFeasibility(input({ request: { windows: [monday, tuesday], lessPreferredWindows: [monday] } }));
    expect(starts(result)[0]).toBe(tuesday.start.toISOString());
    expect(starts(result)).toContain(monday.start.toISOString());
  });

  it("offers weeks below the limit first without explaining the limit to the requester", () => {
    const thisWeek = { end: kst("2026-11-02", "11:00"), start: kst("2026-11-02", "10:00") };
    const nextWeek = { end: kst("2026-11-09", "11:00"), start: kst("2026-11-09", "10:00") };
    const bookedStarts = [3, 4].map((day) => kst(`2026-11-0${day}`, "15:00").getTime());
    const result = evaluateFeasibility(
      input({ bookedStarts, host: { ...HOST, weeklyLimit: 2 }, request: { windows: [thisWeek, nextWeek] } }),
    );

    expect(starts(result)[0]).toBe(nextWeek.start.toISOString());
    expect(result.candidates.at(-1)!.belowWeeklyLimit).toBe(false);
    expect(result.candidates.at(-1)!.basis).toContain(
      "That week already has 2 Find Me a Time bookings, at or over your limit of 2, so it comes after weeks below the limit.",
    );

    const projected = requesterProjection(result.candidates, { displayTimezone: "Asia/Seoul", id: "e", state: "completed" });
    expect(projected.candidates[0]!.start).toBe(nextWeek.start.toISOString());
    expect(JSON.stringify(projected)).not.toMatch(/limit|week/i);
  });

  // The week of Mon 2 Nov: a holiday, a class, a focus block, a routine and a
  // task block time without being meetings; a guest who declined leaves a busy
  // event that is no meeting, and neither an invitation the host declined nor a
  // zero-length one is busy.
  const hostEmail = "host@example.test";
  const hostSelf = { email: hostEmail, responseStatus: "accepted", self: true };
  const guest = (responseStatus: string | null) => ({ email: "guest@client.test", responseStatus, self: false });
  const mixedWeek = [
    event({ end: { date: "2026-11-05" }, id: "holiday", start: { date: "2026-11-04" }, summary: "Holiday" }),
    event({
      end: "2026-11-02T06:15:00Z",
      id: "class",
      location: "Engineering Bldg 302",
      recurringEventId: "algorithms",
      start: "2026-11-02T05:00:00Z",
      summary: "Algorithms",
    }),
    event({ end: "2026-11-03T03:00:00Z", id: "focus", start: "2026-11-03T00:00:00Z", summary: "Focus time" }),
    event({ end: "2026-11-03T11:00:00Z", id: "gym", start: "2026-11-03T10:00:00Z", summary: "Gym" }),
    event({ attendees: [hostSelf], end: "2026-11-05T00:30:00Z", id: "task", start: "2026-11-05T00:00:00Z", summary: "Grade reports" }),
    event({ attendees: [hostSelf, guest("accepted")], end: "2026-11-03T05:30:00Z", id: "accepted", start: "2026-11-03T05:00:00Z" }),
    event({ attendees: [guest(null)], end: "2026-11-05T05:30:00Z", id: "invited", start: "2026-11-05T05:00:00Z" }),
    event({ attendees: [hostSelf, guest("accepted")], end: "2026-11-05T07:00:00Z", id: "zero-length", start: "2026-11-05T07:00:00Z" }),
    ...["primary", "work"].map((calendarId) =>
      event({
        attendees: [hostSelf, guest("tentative")],
        calendarId,
        end: "2026-11-06T02:30:00Z",
        iCalUID: "copied@google.com",
        id: `copied-${calendarId}`,
        start: "2026-11-06T02:00:00Z",
      }),
    ),
    event({ attendees: [hostSelf, guest("declined")], end: "2026-11-06T06:30:00Z", id: "guest-declined", start: "2026-11-06T06:00:00Z" }),
    event({
      attendees: [{ ...hostSelf, responseStatus: "declined" }, guest("accepted")],
      end: "2026-11-06T08:30:00Z",
      id: "host-declined",
      start: "2026-11-06T08:00:00Z",
    }),
  ];
  const mondayMorning = { end: kst("2026-11-02", "11:00"), start: kst("2026-11-02", "10:00") };
  const everyMeeting = { ...HOST, weeklyLimitCounts: "all_meetings" as const };

  it("by default fills a week with Find Me a Time bookings only, not the host's other meetings", () => {
    const hostBusy = normalizeBusy(mixedWeek, { endpointKey: hashed, selfEmail: hostEmail, timezone: "Asia/Seoul" });
    const result = evaluateFeasibility(
      input({
        bookedStarts: [kst("2026-11-04", "15:00").getTime()],
        host: { ...HOST, weeklyLimit: 2 },
        hostBusy,
        request: { windows: [mondayMorning] },
      }),
    );

    expect(result.candidates[0]).toMatchObject({ belowWeeklyLimit: true, weekCount: 1, weekStart: "2026-11-02" });
    expect(result.candidates[0]!.basis).toContain("That week has 1 of your 2 weekly Find Me a Time bookings.");
  });

  it("when every meeting counts, fills a week with its meetings only, never with all-day events, classes, focus blocks or routines", () => {
    const hostBusy = normalizeBusy(mixedWeek, { endpointKey: hashed, selfEmail: hostEmail, timezone: "Asia/Seoul" });
    expect(hostBusy).toHaveLength(9);
    expect(hostBusy.filter((interval) => interval.meeting)).toHaveLength(3);

    const result = evaluateFeasibility(
      input({ host: { ...everyMeeting, weeklyLimit: 4 }, hostBusy, request: { windows: [mondayMorning] } }),
    );

    expect(result.candidates[0]).toMatchObject({ belowWeeklyLimit: true, weekCount: 3, weekStart: "2026-11-02" });
    expect(result.candidates[0]!.basis).toContain("That week has 3 of your 4 weekly meetings.");
  });

  it("counts a booking once when its event is also on a conflict calendar", () => {
    const booked = event({ attendees: [hostSelf, guest("accepted")], end: "2026-11-04T06:30:00Z", id: "fmatbooking1", start: "2026-11-04T06:00:00Z" });
    const hostBusy = normalizeBusy([...mixedWeek, booked], {
      bookedEventIds: new Set(["fmatbooking1"]),
      endpointKey: hashed,
      selfEmail: hostEmail,
      timezone: "Asia/Seoul",
    });
    expect(hostBusy.filter((interval) => interval.meeting)).toHaveLength(3);

    const bookedStarts = [Date.parse("2026-11-04T06:00:00Z")];
    const every = evaluateFeasibility(
      input({ bookedStarts, host: { ...everyMeeting, weeklyLimit: 5 }, hostBusy, request: { windows: [mondayMorning] } }),
    );
    const bookingsOnly = evaluateFeasibility(
      input({ bookedStarts, host: { ...HOST, weeklyLimit: 5 }, hostBusy, request: { windows: [mondayMorning] } }),
    );

    expect(every.candidates[0]!.weekCount).toBe(4);
    expect(bookingsOnly.candidates[0]!.weekCount).toBe(1);
  });

  it("counts the same meetings that setup inferred the limit from when every meeting counts", () => {
    const evidence = computeEvidence(mixedWeek, {
      calendars: [{ id: "primary", ok: true, summary: "Me" }],
      hostEmail,
      timezone: "Asia/Seoul",
    });
    const hostBusy = normalizeBusy(mixedWeek, { endpointKey: hashed, selfEmail: hostEmail, timezone: "Asia/Seoul" });
    const result = evaluateFeasibility(
      input({ host: { ...everyMeeting, weeklyLimit: 3 }, hostBusy, request: { windows: [mondayMorning] } }),
    );
    const [week] = evidence.meetingLoad.weeks;

    expect(evidence.meetingLoad.weeks).toHaveLength(1);
    expect(week!.internal + week!.external).toBe(result.candidates[0]!.weekCount);
    expect(result.candidates[0]!.belowWeeklyLimit).toBe(false);
  });
});

describe("spread across the range", () => {
  // spread-offered-times design 1: within each rank, each day's first time
  // comes before any day's second, and a day's later time is at least
  // SPREAD_MINUTES from its earlier ones, so the first few offered times are
  // never one cluster.
  const twoWeeks = { end: new Date(NOW.getTime() + 14 * 86_400_000), start: NOW };

  it("keeps candidates across the default range's days, earliest day first", () => {
    const spread = evaluateFeasibility(input({ request: { windows: [twoWeeks] } }));
    const days = spread.candidates.slice(0, 10).map((candidate) => candidate.start.slice(0, 10));

    // Ten weekdays from Friday 30 October (Seoul): 30 Oct, 2 to 6 Nov, 9 to 12 Nov.
    expect(new Set(days).size).toBe(10);
    expect(spread.candidates[0]!.start).toBe(kst("2026-10-30", "10:00").toISOString());
    expect(spread.candidates[1]!.start).toBe(kst("2026-11-02", "10:00").toISOString());
    // The first day's second time follows every day's first, two hours on.
    expect(spread.candidates[10]!.start).toBe(kst("2026-10-30", "12:00").toISOString());
  });

  it("offers a week's first three times on three days, not 15 minutes apart (#242)", () => {
    // Any weekday next week; Monday is free only from 12:45.
    const week = { end: kst("2026-11-07", "00:00"), start: kst("2026-11-02", "00:00") };
    const result = evaluateFeasibility(
      input({ hostBusy: [busy(kst("2026-11-02", "10:00"), kst("2026-11-02", "12:25"))], request: { windows: [week] } }),
    );
    const projection = requesterProjection(result.candidates, { displayTimezone: "Asia/Seoul", id: "e1", state: "completed" });

    expect(projection.candidates.slice(0, 3).map((candidate) => candidate.start)).toEqual([
      kst("2026-11-02", "12:45").toISOString(),
      kst("2026-11-03", "10:00").toISOString(),
      kst("2026-11-04", "10:00").toISOString(),
    ]);
    // Every time still passes; only the order changed.
    expect(result.candidates).toHaveLength(new Set(starts(result)).size);
    expect(starts(result)).toContain(kst("2026-11-02", "13:00").toISOString());
  });

  it("spreads one day's times across the day before offering the rest in time order", () => {
    const day = { end: kst("2026-11-02", "17:00"), start: kst("2026-11-02", "10:00") };
    const result = evaluateFeasibility(input({ request: { windows: [day] } }));

    expect(starts(result).slice(0, 6)).toEqual(
      ["10:00", "12:00", "14:00", "16:00", "10:15", "10:30"].map((clock) => kst("2026-11-02", clock).toISOString()),
    );
  });

  it("never lifts a time over a week the host prefers", () => {
    const thisWeek = { end: kst("2026-11-07", "00:00"), start: kst("2026-11-02", "00:00") };
    const nextWeek = { end: kst("2026-11-14", "00:00"), start: kst("2026-11-09", "00:00") };
    const result = evaluateFeasibility(
      input({ bookedStarts: [kst("2026-11-03", "15:00").getTime()], host: { ...HOST, weeklyLimit: 1 }, request: { windows: [thisWeek, nextWeek] } }),
    );
    const below = result.candidates.filter((candidate) => candidate.belowWeeklyLimit).length;

    expect(result.candidates.slice(0, below).every((candidate) => candidate.belowWeeklyLimit)).toBe(true);
    expect(result.candidates.slice(0, 3).map((candidate) => candidate.start.slice(0, 10))).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
  });

  it("keeps a time's place pairs together", () => {
    const day = { end: kst("2026-11-02", "17:00"), start: kst("2026-11-02", "10:00") };
    const result = evaluateFeasibility(
      input({
        request: { location: null, mode: "in_person", places: [MEETING, { key: hashed("Seolleung Station"), text: "Seolleung Station" }], windows: [day] },
      }),
    );

    expect(result.candidates.slice(0, 4).map((candidate) => [candidate.start, candidate.location])).toEqual([
      [kst("2026-11-02", "10:00").toISOString(), MEETING.text],
      [kst("2026-11-02", "10:00").toISOString(), "Seolleung Station"],
      [kst("2026-11-02", "12:00").toISOString(), MEETING.text],
      [kst("2026-11-02", "12:00").toISOString(), "Seolleung Station"],
    ]);
  });
});

describe("travel legs", () => {
  const office = place("Gangnam office");
  const inPerson = { location: MEETING, mode: "in_person" as const, travelMode: "transit" as const };
  const at = (clock: string) => kst("2026-11-02", clock);
  const only = (clock: string) => ({ windows: [{ end: new Date(at(clock).getTime() + 30 * 60_000), start: at(clock) }] });

  it("excludes a candidate when the inbound trip plus buffers exceeds the gap", () => {
    const result = evaluateFeasibility(
      input({
        estimate: routes({ "Gangnam office -> Cafe Onion, Seongsu": 40 }),
        hostBusy: [busy(at("10:00"), at("11:00"), office)],
        request: { ...inPerson, ...only("12:00") },
      }),
    );

    // 40 minutes plus 10 before and 15 travel buffer is 65, over the 60-minute gap.
    expect(result.candidates).toEqual([]);
    expect(result.exclusions[0]!.explanation).toBe(
      "Travel from your previous commitment: 40 minutes by public transit plus 25 minutes of buffers does not fit the 60-minute gap.",
    );
  });

  it("excludes a candidate when the outbound trip does not fit even though the inbound one does", () => {
    const result = evaluateFeasibility(
      input({
        estimate: routes({ "Cafe Onion, Seongsu -> Gangnam office": 40, "Gangnam office -> Cafe Onion, Seongsu": 20 }),
        hostBusy: [busy(at("10:00"), at("11:00"), office), busy(at("13:30"), at("14:00"), office)],
        request: { ...inPerson, ...only("12:30") },
      }),
    );

    expect(result.candidates).toEqual([]);
    expect(result.exclusionCounts.host_travel).toBe(1);
  });

  it("offers a candidate whose legs both fit and explains each", () => {
    const result = evaluateFeasibility(
      input({
        estimate: routes({ "Cafe Onion, Seongsu -> Gangnam office": 20, "Gangnam office -> Cafe Onion, Seongsu": 20 }),
        hostBusy: [busy(at("10:00"), at("11:00"), office), busy(at("14:00"), at("15:00"), office)],
        request: { ...inPerson, ...only("12:00") },
      }),
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.status).toBe("offered");
    expect(result.candidates[0]!.legs.map((leg) => [leg.direction, leg.status, leg.travelMinutes])).toEqual([
      ["inbound", "fits", 20],
      ["outbound", "fits", 20],
    ]);
    expect(JSON.stringify(result.candidates[0]!.legs)).not.toContain("Gangnam");
  });

  it("checks a commitment that ended hours earlier the same day", () => {
    const queries = travelQueries(
      input({ hostBusy: [busy(at("07:00"), at("08:00"), office)], request: { ...inPerson, ...only("13:00") } }),
    );
    expect(queries).toEqual([
      expect.objectContaining({ departure: at("08:00"), destination: MEETING.text, mode: "transit", origin: "Gangnam office" }),
    ]);
  });

  it("checks an overnight candidate against a commitment from the window's starting day", () => {
    const host = { ...HOST, weeklyWindows: [{ end: "02:00", start: "22:00", weekday: "monday" as const }] };
    const candidate = { end: kst("2026-11-03", "01:30"), start: kst("2026-11-03", "01:00") };
    const commitment = busy(kst("2026-11-02", "23:00"), kst("2026-11-02", "23:30"), office);
    const queries = travelQueries(input({ host, hostBusy: [commitment], request: { ...inPerson, windows: [candidate] } }));

    expect(queries).toHaveLength(1);
    expect(queries[0]!.departure).toEqual(kst("2026-11-02", "23:30"));
  });

  it("does not look past the candidate's local day", () => {
    const queries = travelQueries(
      input({ hostBusy: [busy(kst("2026-11-01", "20:00"), kst("2026-11-01", "21:00"), office)], request: { ...inPerson, ...only("12:00") } }),
    );
    expect(queries).toEqual([]);
  });

  it.each([
    ["no route", "none", "no_route"],
    ["a provider failure", "failed", "route_failed"],
  ] as const)("keeps a leg with %s unresolved and out of the requester's list", (_name, outcome, reason) => {
    const result = evaluateFeasibility(
      input({
        estimate: routes({ "Gangnam office -> Cafe Onion, Seongsu": outcome }),
        hostBusy: [busy(at("10:00"), at("11:00"), office)],
        request: { ...inPerson, ...only("12:00") },
      }),
    );

    expect(result.candidates[0]).toMatchObject({ status: "host_unresolved" });
    expect(result.candidates[0]!.legs[0]).toMatchObject({ status: "unresolved", unresolvedReason: reason });
    expect(requesterProjection(result.candidates, { displayTimezone: "Asia/Seoul", id: "e", state: "completed" }).candidates).toEqual([]);
  });

  it.each([
    ["only a conference link", { kind: "unknown", reason: "conference_only" }, "conference_only"],
    ["both a place and a link", { kind: "unknown", reason: "place_and_link" }, "place_and_link"],
    ["no location", { kind: "unknown", reason: "no_location" }, "no_location"],
  ] as const)("leaves the leg from a previous meeting with %s unresolved", (_name, endpoint, reason) => {
    const result = evaluateFeasibility(
      input({ hostBusy: [busy(at("10:00"), at("11:00"), endpoint)], request: { ...inPerson, ...only("12:00") } }),
    );

    expect(result.candidates[0]!.status).toBe("host_unresolved");
    expect(result.candidates[0]!.legs[0]!.unresolvedReason).toBe(reason);
  });

  it("leaves legs unresolved while the host's mode is Depends on the trip", () => {
    const result = evaluateFeasibility(
      input({
        estimate: routes({ "Gangnam office -> Cafe Onion, Seongsu": 5 }),
        host: { ...HOST, travelMode: "depends" },
        hostBusy: [busy(at("10:00"), at("11:00"), office)],
        request: { ...inPerson, ...only("12:00") },
      }),
    );

    expect(result.candidates[0]!.legs[0]!.unresolvedReason).toBe("travel_mode_depends");
    expect(result.candidates[0]!.basis.join(" ")).toContain("your travel mode is Depends on the trip");
  });

  it("uses a host allowance for exactly one leg of one candidate", () => {
    const allowance = {
      candidateEnd: at("12:30"),
      candidateStart: at("12:00"),
      destinationKey: MEETING.key,
      direction: "inbound" as const,
      minutes: 30,
      mode: "transit" as const,
      originKey: office.kind === "place" ? office.key : "",
      party: "host" as const,
    };
    const result = evaluateFeasibility(
      input({
        allowances: [allowance],
        estimate: routes({ "Gangnam office -> Cafe Onion, Seongsu": "none" }),
        hostBusy: [busy(at("10:00"), at("11:00"), office)],
        request: { ...inPerson, windows: [{ end: at("12:45"), start: at("12:00") }] },
      }),
    );

    expect(result.candidates.map((candidate) => [candidate.start, candidate.status])).toEqual([
      [at("12:00").toISOString(), "offered"],
      [at("12:15").toISOString(), "host_unresolved"],
    ]);
    expect(result.candidates[0]!.basis.join(" ")).toContain("the 30 minutes you allowed plus 25 minutes of buffers fits");
    const projected = requesterProjection(result.candidates, { displayTimezone: "Asia/Seoul", id: "e", state: "completed" });
    expect(JSON.stringify(projected)).not.toMatch(/allow|30 minutes/);
  });

  it("voids an allowance when the adjacent event's location changes", () => {
    const allowance = {
      candidateEnd: at("12:30"),
      candidateStart: at("12:00"),
      destinationKey: MEETING.key,
      direction: "inbound" as const,
      minutes: 30,
      mode: "transit" as const,
      originKey: hashed("Gangnam office"),
      party: "host" as const,
    };
    const result = evaluateFeasibility(
      input({
        allowances: [allowance],
        hostBusy: [busy(at("10:00"), at("11:00"), place("Jamsil office"))],
        request: { ...inPerson, ...only("12:00") },
      }),
    );

    expect(result.candidates[0]!.legs[0]).toMatchObject({ status: "unresolved", unresolvedReason: "not_estimated" });
  });

  it("keys a changed location as a different trip", () => {
    const before = travelQueries(input({ hostBusy: [busy(at("10:00"), at("11:00"), office)], request: { ...inPerson, ...only("12:00") } }));
    const after = travelQueries(
      input({ hostBusy: [busy(at("10:00"), at("11:00"), place("Jamsil office"))], request: { ...inPerson, ...only("12:00") } }),
    );
    expect(legQueryKey(before[0]!)).not.toBe(legQueryKey(after[0]!));
  });

  it("excludes a candidate when the requester cannot get there, telling the host nothing about the event", () => {
    const result = evaluateFeasibility(
      input({
        estimate: routes({ "Requester's dentist -> Cafe Onion, Seongsu": 50 }),
        requesterBusy: [busy(at("13:30"), at("14:00"), place("Requester's dentist"))],
        request: { ...inPerson, ...only("14:30") },
      }),
    );

    expect(result.candidates).toEqual([]);
    expect(result.exclusions).toEqual([
      expect.objectContaining({ explanation: "The requester is not available then.", reason: "requester_unavailable" }),
    ]);
    expect(JSON.stringify(result)).not.toContain("dentist");
  });

  it("holds back a candidate whose requester leg is unresolved until the requester allows minutes for it", () => {
    const next = busy(at("13:30"), at("14:00"));
    const held = evaluateFeasibility(input({ requesterBusy: [next], request: { ...inPerson, ...only("12:00") } }));

    expect(held.candidates[0]!.status).toBe("requester_unresolved");
    expect(
      requesterProjection(held.candidates, { displayTimezone: "Asia/Seoul", id: "e", state: "completed" }).candidates[0]!
        .unresolvedRequesterLeg,
    ).toBe("outbound");

    const located = busy(at("13:30"), at("14:00"), place("Requester's school"));
    const allowed = evaluateFeasibility(
      input({
        allowances: [
          {
            candidateEnd: at("12:30"),
            candidateStart: at("12:00"),
            destinationKey: hashed("Requester's school"),
            direction: "outbound",
            minutes: 45,
            mode: "transit",
            originKey: MEETING.key,
            party: "requester",
          },
        ],
        requesterBusy: [located],
        request: { ...inPerson, ...only("12:00") },
      }),
    );

    expect(allowed.candidates[0]!.status).toBe("offered");
    expect(allowed.candidates[0]!.basis).toContain("The requester's own trip fits.");
  });

  it("estimates the requester's own trip by public transit when they named no travel mode", () => {
    const result = evaluateFeasibility(
      input({
        estimate: routes({ "Requester's office -> Cafe Onion, Seongsu": 20 }),
        host: { ...HOST, travelMode: "driving" },
        requesterBusy: [busy(at("11:30"), at("12:00"), place("Requester's office"))],
        request: { ...inPerson, travelMode: null, ...only("12:30") },
      }),
    );

    const leg = result.candidates[0]!.legs.find((entry) => entry.party === "requester")!;
    expect(result.candidates[0]!.status).toBe("offered");
    expect(leg).toEqual(expect.objectContaining({ mode: "transit", status: "fits", unresolvedReason: null }));
  });

  it("estimates the requester's own trip in the mode they named", () => {
    const result = evaluateFeasibility(
      input({
        estimate: routes({ "Requester's office -> Cafe Onion, Seongsu": 20 }),
        requesterBusy: [busy(at("11:30"), at("12:00"), place("Requester's office"))],
        request: { ...inPerson, travelMode: "walking", ...only("12:30") },
      }),
    );

    expect(result.candidates[0]!.legs.find((entry) => entry.party === "requester")!.mode).toBe("walking");
  });

  it("still leaves a host leg unresolved without a host travel mode", () => {
    const result = evaluateFeasibility(
      input({
        host: { ...HOST, travelMode: null },
        hostBusy: [busy(at("10:00"), at("11:00"), office)],
        request: { ...inPerson, travelMode: null, ...only("12:00") },
      }),
    );

    expect(result.candidates[0]!.status).toBe("host_unresolved");
    expect(result.candidates[0]!.legs[0]!.unresolvedReason).toBe("travel_mode_unknown");
  });

  it("uses no host buffer for the requester's own trip", () => {
    const result = evaluateFeasibility(
      input({
        estimate: routes({ "Requester's office -> Cafe Onion, Seongsu": 30 }),
        requesterBusy: [busy(at("11:30"), at("12:00"), place("Requester's office"))],
        request: { ...inPerson, ...only("12:30") },
      }),
    );

    expect(result.candidates[0]!.status).toBe("offered");
  });

  it("checks no requester leg without a requester calendar", () => {
    const result = evaluateFeasibility(input({ requesterBusy: null, request: { ...inPerson, ...only("12:00") } }));
    expect(result.candidates[0]!.legs).toEqual([]);
    expect(result.candidates[0]!.status).toBe("offered");
  });

  it("checks nothing when no commitment is near that day", () => {
    const result = evaluateFeasibility(input({ request: { ...inPerson, ...only("12:00") } }));
    expect(result.candidates[0]!.basis).toContain("No commitment that day needs a trip checked.");
  });
});

describe("same-day trips", () => {
  // same-day-trips: the meeting place is 45 minutes from the preferred area.
  // Monday's morning commitment is 10 minutes from it, Tuesday's is in the
  // preferred area, and Wednesday has none.
  const AREA = { key: hashed("Gangnam"), text: "Gangnam" };
  const day = (date: string) => ({ end: kst(date, "15:00"), start: kst(date, "14:00") });
  const inPerson = {
    location: MEETING,
    mode: "in_person" as const,
    travelMode: "transit" as const,
    windows: [day("2026-11-02"), day("2026-11-03"), day("2026-11-04")],
  };
  const hostBusy = [
    busy(kst("2026-11-02", "09:00"), kst("2026-11-02", "10:00"), place("Seongsu office")),
    busy(kst("2026-11-03", "09:00"), kst("2026-11-03", "10:00"), place("Gangnam studio")),
  ];
  const minutes = {
    "Gangnam -> Cafe Onion, Seongsu": 45,
    "Gangnam studio -> Cafe Onion, Seongsu": 50,
    "Gangnam studio -> Gangnam": 5,
    "Seongsu office -> Cafe Onion, Seongsu": 10,
    "Seongsu office -> Gangnam": 40,
  } as const;
  const trips = ({
    host,
    request,
    ...rest
  }: Partial<Omit<FeasibilityInput, "host" | "request">> & {
    host?: Partial<HostRules>;
    request?: Partial<FeasibilityInput["request"]>;
  } = {}) =>
    input({
      estimate: routes(minutes),
      hostBusy,
      ...rest,
      host: { ...HOST, preferredArea: AREA, ...host },
      request: { ...inPerson, ...request },
    });
  const days = (result: ReturnType<typeof evaluateFeasibility>) =>
    [...new Set(result.candidates.map((candidate) => candidate.start.slice(0, 10)))];
  const sorted = (result: ReturnType<typeof evaluateFeasibility>) => [...starts(result)].sort();

  it("offers days already out that way first and days in the preferred area last, removing nothing", () => {
    const ranked = evaluateFeasibility(trips());
    const plain = evaluateFeasibility(trips({ host: { preferredArea: null } }));

    expect(days(plain)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(days(ranked)).toEqual(["2026-11-02", "2026-11-04", "2026-11-03"]);
    expect(sorted(ranked)).toEqual(sorted(plain));
    expect(ranked.candidates.every((candidate) => candidate.status === "offered")).toBe(true);
  });

  it("moves a later day with a nearby commitment ahead of earlier days, and not without one", () => {
    const wednesday = busy(kst("2026-11-04", "09:00"), kst("2026-11-04", "10:00"), place("Seongsu office"));
    const withNearby = evaluateFeasibility(trips({ hostBusy: [hostBusy[1]!, wednesday] }));
    const without = evaluateFeasibility(trips({ hostBusy: [hostBusy[1]!] }));

    expect(days(withNearby)).toEqual(["2026-11-04", "2026-11-02", "2026-11-03"]);
    expect(days(without)).toEqual(["2026-11-02", "2026-11-04", "2026-11-03"]);
  });

  it("explains the rank to the host in minutes, without naming an event or a place", () => {
    const result = evaluateFeasibility(trips());
    const basisOf = (date: string) => result.candidates.find((candidate) => candidate.start.startsWith(date))!.basis;

    expect(basisOf("2026-11-02")).toContain(
      "That day you are already 10 minutes from the meeting place, which is 45 minutes from your usual area, so days like it come first.",
    );
    expect(basisOf("2026-11-03")).toContain(
      "That day you stay near your usual area, 45 minutes from the meeting place, so it comes after days you are already out that way.",
    );
    expect(basisOf("2026-11-04")).toContain(
      "The meeting place is 45 minutes from your usual area, so days you are already out that way come first.",
    );
    expect(result.candidates.flatMap((candidate) => candidate.basis).join(" ")).not.toMatch(/Gangnam|Seongsu office/);
  });

  it("keeps the weekly limit ahead of the trip rank", () => {
    const result = evaluateFeasibility(
      trips({
        bookedStarts: [kst("2026-11-02", "08:00").getTime()],
        host: { weeklyLimit: 1 },
        request: { windows: [...inPerson.windows, day("2026-11-09")] },
      }),
    );
    expect(days(result)).toEqual(["2026-11-09", "2026-11-02", "2026-11-04", "2026-11-03"]);
  });

  it("leaves the order alone when the meeting place is near the preferred area", () => {
    const near = evaluateFeasibility(trips({ estimate: routes({ ...minutes, "Gangnam -> Cafe Onion, Seongsu": 20 }) }));
    expect(days(near)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(near.candidates[0]!.basis.join(" ")).not.toContain("usual area");
  });

  it("leaves the order alone without estimates, while naming the trips it needs", () => {
    const unestimated = trips({ estimate: undefined });
    expect(days(evaluateFeasibility(unestimated))).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(tripQueries(unestimated).map((query) => `${query.origin} -> ${query.destination}`).sort()).toEqual(
      Object.keys(minutes).sort(),
    );
  });

  it("does nothing for an online meeting or a per-trip travel mode", () => {
    const online = trips({ request: { location: null, mode: "online", travelMode: null } });
    expect(tripQueries(online)).toEqual([]);
    expect(days(evaluateFeasibility(online))).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);

    const depends = trips({ host: { travelMode: "depends" } });
    expect(tripQueries(depends)).toEqual([]);
    expect(days(evaluateFeasibility(depends))).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
  });

  it("shows the requester only the times", () => {
    const result = evaluateFeasibility(trips());
    const projection = requesterProjection(result.candidates, { displayTimezone: "Asia/Seoul", id: "e1", state: "completed" });
    const text = JSON.stringify(projection);

    expect(projection.candidates.map((candidate) => candidate.start)).toEqual(starts(result));
    expect(text).not.toMatch(/Gangnam|Seongsu office|usual area|minutes/);
  });
});

describe("time and place pairs", () => {
  // guest-time-place-pairs: the host meets at a venue or in one area.
  const office = place("Gangnam office");
  const VENUE = { key: hashed("AA Cafe, Yeoksam"), text: "AA Cafe, Yeoksam" };
  const AREA = { key: hashed("Seolleung Station"), text: "Seolleung Station" };
  const at = (clock: string) => kst("2026-11-02", clock);
  const pairs = (request: Partial<FeasibilityInput["request"]> = {}, rest: Partial<Omit<FeasibilityInput, "request">> = {}) =>
    input({
      ...rest,
      request: {
        mode: "in_person",
        places: [VENUE, AREA],
        travelMode: "transit",
        windows: [{ end: at("11:00"), start: at("10:00") }],
        ...request,
      },
    });

  it("pairs each free time with each host place, venue first, each with its own place and ID", () => {
    const result = evaluateFeasibility(pairs());

    expect(result.candidates.map((candidate) => [candidate.start, candidate.location, candidate.id])).toEqual([
      [at("10:00").toISOString(), VENUE.text, `c${at("10:00").getTime() / 60_000}-30-p0`],
      [at("10:00").toISOString(), AREA.text, `c${at("10:00").getTime() / 60_000}-30-p1`],
      [at("10:15").toISOString(), VENUE.text, `c${at("10:15").getTime() / 60_000}-30-p0`],
      [at("10:15").toISOString(), AREA.text, `c${at("10:15").getTime() / 60_000}-30-p1`],
      [at("10:30").toISOString(), VENUE.text, `c${at("10:30").getTime() / 60_000}-30-p0`],
      [at("10:30").toISOString(), AREA.text, `c${at("10:30").getTime() / 60_000}-30-p1`],
    ]);
    expect(result.candidates.every((candidate) => candidate.status === "offered")).toBe(true);
  });

  it("lets travel decide which pair of a time is offered", () => {
    const result = evaluateFeasibility(
      pairs(
        { windows: [{ end: at("12:30"), start: at("12:00") }] },
        {
          estimate: routes({ "Gangnam office -> AA Cafe, Yeoksam": 40, "Gangnam office -> Seolleung Station": 10 }),
          hostBusy: [busy(at("10:00"), at("11:00"), office)],
        },
      ),
    );

    // 40 + 25 of buffers is over the 60-minute gap; 10 + 25 fits.
    expect(result.candidates.map((candidate) => candidate.location)).toEqual([AREA.text]);
    expect(result.exclusionCounts.host_travel).toBe(1);
    expect(travelQueries(pairs({ windows: [{ end: at("12:30"), start: at("12:00") }] }, { hostBusy: [busy(at("10:00"), at("11:00"), office)] }))
      .map((query) => query.destination)).toEqual([VENUE.text, AREA.text]);
  });

  it("keeps one place, its IDs and its order when the request names a place", () => {
    const named = evaluateFeasibility(pairs({ location: MEETING }));
    const plain = evaluateFeasibility(pairs({ location: MEETING, places: [] }));

    expect(named.candidates).toEqual(plain.candidates);
    expect(named.candidates.every((candidate) => candidate.location === MEETING.text && !candidate.id.includes("-p"))).toBe(true);
  });

  it("makes no pairs for an online meeting", () => {
    const result = evaluateFeasibility(pairs({ mode: "online" }));
    expect(result.candidates.every((candidate) => candidate.location === null && !candidate.id.includes("-p"))).toBe(true);
    expect(result.candidates).toHaveLength(3);
  });

  it("counts pairs, not times, toward the candidate cut", () => {
    const result = evaluateFeasibility(pairs({ windows: [{ end: at("17:00"), start: at("10:00") }] }));
    expect(result.candidates).toHaveLength(CANDIDATE_LIMIT);
    expect(new Set(result.candidates.map((candidate) => candidate.start)).size).toBe(CANDIDATE_LIMIT / 2);
  });

  it("shows the requester each time's first pair before any time's second", () => {
    const result = evaluateFeasibility(pairs());
    const projection = requesterProjection(result.candidates, { displayTimezone: "Asia/Seoul", id: "e1", state: "completed" });

    expect(projection.candidates.map((candidate) => [candidate.start, candidate.location])).toEqual([
      [at("10:00").toISOString(), VENUE.text],
      [at("10:15").toISOString(), VENUE.text],
      [at("10:30").toISOString(), VENUE.text],
      [at("10:00").toISOString(), AREA.text],
      [at("10:15").toISOString(), AREA.text],
      [at("10:30").toISOString(), AREA.text],
    ]);
  });

  it("keeps a host-unresolved pair from the requester without saying why", () => {
    const result = evaluateFeasibility(
      pairs({ windows: [{ end: at("12:30"), start: at("12:00") }] }, {
        estimate: routes({ "Gangnam office -> Seolleung Station": 10 }),
        hostBusy: [busy(at("10:00"), at("11:00"), office)],
      }),
    );
    const projection = requesterProjection(result.candidates, { displayTimezone: "Asia/Seoul", id: "e1", state: "completed" });

    expect(result.candidates.map((candidate) => [candidate.location, candidate.status])).toEqual([
      [VENUE.text, "host_unresolved"],
      [AREA.text, "offered"],
    ]);
    expect(projection.candidates.map((candidate) => candidate.location)).toEqual([AREA.text]);
    expect(JSON.stringify(projection)).not.toMatch(/Gangnam|estimated|minutes/);
  });
});

describe("ranking order", () => {
  it("puts ranked candidates first and keeps the rest in their deterministic order", () => {
    const result = evaluateFeasibility(input());
    const ids = result.candidates.map((candidate) => candidate.id);
    const ordered = applyRanking(result.candidates, [ids[3]!, ids[1]!]).map((candidate) => candidate.id);

    expect(ordered).toEqual([ids[3], ids[1], ids[0], ids[2], ...ids.slice(4)]);
    expect(applyRanking(result.candidates, null).map((candidate) => candidate.id)).toEqual(ids);
  });

  it("spreads a ranking that puts one day's times first (#242)", () => {
    const week = { end: kst("2026-11-07", "00:00"), start: kst("2026-11-02", "00:00") };
    const result = evaluateFeasibility(input({ request: { windows: [week] } }));
    const at = (date: string, clock: string) => result.candidates.find((candidate) => candidate.start === kst(date, clock).toISOString())!.id;
    // A model favouring sooner dates: three Monday times, then Tuesday.
    const ranking = [at("2026-11-02", "10:00"), at("2026-11-02", "10:15"), at("2026-11-02", "10:30"), at("2026-11-03", "10:00")];
    const ordered = applyRanking(result.candidates, ranking, "Asia/Seoul").map((candidate) => candidate.id);

    expect(ordered.slice(0, 4)).toEqual([ranking[0], ranking[3], ranking[1], ranking[2]]);
    // Without a zone the ranking's order stands.
    expect(applyRanking(result.candidates, ranking).slice(0, 4).map((candidate) => candidate.id)).toEqual(ranking);
  });
});

function event(overrides: Partial<CalendarEvent> & { id: string; start?: CalendarEvent["start"] | string; end?: CalendarEvent["end"] | string }): CalendarEvent {
  const time = (value: CalendarEvent["start"] | string | undefined, fallback: string) =>
    typeof value === "string" ? { dateTime: value } : (value ?? { dateTime: fallback });

  return {
    attendees: [],
    calendarId: "primary",
    hasConferenceLink: false,
    iCalUID: null,
    location: null,
    recurringEventId: null,
    status: "confirmed",
    summary: "Event",
    transparency: null,
    updated: null,
    ...overrides,
    end: time(overrides.end, "2026-11-02T03:00:00Z"),
    start: time(overrides.start, "2026-11-02T01:00:00Z"),
  };
}

describe("in-person requests in the host's area (#324)", () => {
  // The issue's first case: the host's commitments that day have no location,
  // the meeting place is inside their usual area, and every time was held back.
  const AREA = { key: hashed("Gwanak-gu"), text: "Gwanak-gu" };
  const NEAR_SNU = { key: hashed("Near SNU"), text: "Near SNU" };
  const inPerson = { location: NEAR_SNU, mode: "in_person" as const, travelMode: "transit" as const };
  const at = (clock: string) => kst("2026-11-02", clock);
  const only = (clock: string) => ({ windows: [{ end: new Date(at(clock).getTime() + 30 * 60_000), start: at(clock) }] });
  const projected = (result: ReturnType<typeof evaluateFeasibility>) =>
    requesterProjection(result.candidates, { displayTimezone: "Asia/Seoul", id: "e", state: "completed" }).candidates;

  it("takes a host commitment with no location to be at the host's usual place and offers the time", () => {
    const result = evaluateFeasibility(
      input({
        estimate: routes({ "Gwanak-gu -> Near SNU": 15, "Near SNU -> Gwanak-gu": 15 }),
        host: { ...HOST, usualPlace: AREA },
        hostBusy: [busy(at("10:00"), at("11:00")), busy(at("13:30"), at("14:30"))],
        request: { ...inPerson, ...only("12:00") },
      }),
    );

    expect(result.candidates[0]!.status).toBe("offered");
    expect(result.candidates[0]!.legs.map((leg) => [leg.direction, leg.status, leg.travelMinutes, leg.usualPlace])).toEqual([
      ["inbound", "fits", 15, true],
      ["outbound", "fits", 15, true],
    ]);
    // 15 minutes plus 10 before and the 15-minute travel buffer fits the hour.
    expect(result.candidates[0]!.basis).toContain(
      "Travel from your previous commitment, which has no location, so from your usual area: 15 minutes by public transit plus 25 minutes of buffers fits the 60-minute gap.",
    );
    expect(projected(result).map((candidate) => candidate.start)).toEqual([at("12:00").toISOString()]);
    expect(JSON.stringify(result.candidates[0]!.legs)).not.toContain("Gwanak");
  });

  it("asks Routes for the trip from the usual place", () => {
    const queries = travelQueries(
      input({ host: { ...HOST, usualPlace: AREA }, hostBusy: [busy(at("10:00"), at("11:00"))], request: { ...inPerson, ...only("12:00") } }),
    );
    expect(queries).toEqual([
      expect.objectContaining({ departure: at("11:00"), destination: "Near SNU", mode: "transit", origin: "Gwanak-gu", originKey: AREA.key }),
    ]);
  });

  it("needs no trip when the meeting is at the usual place itself", () => {
    const result = evaluateFeasibility(
      input({
        host: { ...HOST, usualPlace: AREA },
        hostBusy: [busy(at("11:00"), at("11:20"))],
        request: { ...inPerson, location: AREA, ...only("12:00") },
      }),
    );

    expect(result.candidates[0]!.status).toBe("offered");
    expect(result.candidates[0]!.legs[0]).toMatchObject({ source: "same_place", status: "fits", travelMinutes: 0 });
  });

  it("still applies the travel buffers to a trip from the usual place", () => {
    const result = evaluateFeasibility(
      input({
        estimate: routes({ "Gwanak-gu -> Near SNU": 15 }),
        host: { ...HOST, usualPlace: AREA },
        hostBusy: [busy(at("11:00"), at("11:45"))],
        request: { ...inPerson, ...only("12:00") },
      }),
    );

    // 15 minutes plus 25 minutes of buffers does not fit a 15-minute gap.
    expect(result.candidates).toEqual([]);
    expect(result.exclusionCounts.host_travel).toBe(1);
  });

  it.each([
    ["only a conference link", "conference_only"],
    ["both a place and a link", "place_and_link"],
  ] as const)("keeps a commitment with %s unresolved even with a usual place", (_name, reason) => {
    const result = evaluateFeasibility(
      input({
        host: { ...HOST, usualPlace: AREA },
        hostBusy: [busy(at("10:00"), at("11:00"), { kind: "unknown", reason })],
        request: { ...inPerson, ...only("12:00") },
      }),
    );

    expect(result.candidates[0]!.status).toBe("host_unresolved");
    expect(result.candidates[0]!.legs[0]!.unresolvedReason).toBe(reason);
    expect(result.candidates[0]!.legs[0]!.usualPlace).toBeUndefined();
  });

  it("keys a leg to a commitment without a place, so it can take an allowance", () => {
    const result = evaluateFeasibility(
      input({ requesterBusy: [busy(at("13:30"), at("14:00"))], request: { ...inPerson, ...only("12:00") } }),
    );
    const leg = result.candidates[0]!.legs.find((entry) => entry.party === "requester")!;

    expect(result.candidates[0]!.status).toBe("requester_unresolved");
    expect(leg).toMatchObject({ destinationKey: "unknown:no_location", mode: "transit", originKey: NEAR_SNU.key, status: "unresolved" });
  });

  it("offers a time once the requester allows minutes for a trip to an event with no location", () => {
    const allowance = {
      candidateEnd: at("12:30"),
      candidateStart: at("12:00"),
      destinationKey: "unknown:no_location",
      direction: "outbound" as const,
      minutes: 30,
      mode: "transit" as const,
      originKey: NEAR_SNU.key,
      party: "requester" as const,
    };
    const allowed = evaluateFeasibility(
      input({ allowances: [allowance], requesterBusy: [busy(at("13:30"), at("14:00"))], request: { ...inPerson, ...only("12:00") } }),
    );

    expect(allowed.candidates[0]!.status).toBe("offered");
    expect(allowed.candidates[0]!.legs[0]).toMatchObject({ source: "allowance", status: "fits", travelMinutes: 30 });
    expect(projected(allowed)[0]!.unresolvedRequesterLeg).toBeNull();

    // The allowance is void once the event gains a place.
    const located = evaluateFeasibility(
      input({
        allowances: [allowance],
        requesterBusy: [busy(at("13:30"), at("14:00"), place("Requester's school"))],
        request: { ...inPerson, ...only("12:00") },
      }),
    );
    expect(located.candidates[0]!.status).toBe("requester_unresolved");
  });

  it("lets the host allow minutes for a trip from an online meeting", () => {
    const result = evaluateFeasibility(
      input({
        allowances: [
          {
            candidateEnd: at("12:30"),
            candidateStart: at("12:00"),
            destinationKey: NEAR_SNU.key,
            direction: "inbound",
            minutes: 20,
            mode: "transit",
            originKey: "unknown:conference_only",
            party: "host",
          },
        ],
        hostBusy: [busy(at("10:00"), at("11:00"), { kind: "unknown", reason: "conference_only" })],
        request: { ...inPerson, ...only("12:00") },
      }),
    );

    expect(result.candidates[0]!.status).toBe("offered");
    expect(result.candidates[0]!.basis.join(" ")).toContain("the 20 minutes you allowed plus 25 minutes of buffers fits");
  });
});

describe("a guest-host's own preferences (#60)", () => {
  const monday = { end: kst("2026-11-02", "13:00"), start: kst("2026-11-02", "10:00") };
  const nextMonday = { end: kst("2026-11-09", "11:00"), start: kst("2026-11-09", "10:00") };
  const thisMonday = { end: kst("2026-11-02", "11:00"), start: kst("2026-11-02", "10:00") };
  const preferences = (overrides: Partial<NonNullable<FeasibilityInput["requesterPreferences"]>> = {}) => ({
    timezone: "Asia/Seoul",
    weekCounts: {},
    weeklyLimit: null,
    weeklyWindows: [{ end: "13:00", start: "12:00", weekday: "monday" as const }],
    ...overrides,
  });

  it("never removes a candidate", () => {
    const without = evaluateFeasibility(input({ request: { windows: [monday] } }));
    const withPreferences = evaluateFeasibility(
      input({ request: { windows: [monday] }, requesterPreferences: preferences({ weekCounts: { "2026-11-02": 9 }, weeklyLimit: 1 }) }),
    );

    expect(timeline(withPreferences)).toEqual(timeline(without));
  });

  it("offers times inside the guest-host's weekly windows first", () => {
    const result = evaluateFeasibility(input({ request: { windows: [monday] }, requesterPreferences: preferences() }));

    expect(starts(result).slice(0, 3)).toEqual(["12:00", "12:15", "12:30"].map((clock) => kst("2026-11-02", clock).toISOString()));
    // Without them the morning comes first.
    expect(starts(evaluateFeasibility(input({ request: { windows: [monday] } })))[0]).toBe(kst("2026-11-02", "10:00").toISOString());
  });

  it("offers weeks below the guest-host's weekly limit first", () => {
    const result = evaluateFeasibility(
      input({
        request: { windows: [thisMonday, nextMonday] },
        requesterPreferences: preferences({ weekCounts: { "2026-11-02": 2 }, weeklyLimit: 2, weeklyWindows: [] }),
      }),
    );

    expect(starts(result)[0]).toBe(nextMonday.start.toISOString());
    expect(starts(result)).toContain(thisMonday.start.toISOString());
  });

  it("puts the guest-host's hours ahead of their weekly limit", () => {
    const result = evaluateFeasibility(
      input({
        request: { windows: [thisMonday, { end: kst("2026-11-09", "13:00"), start: kst("2026-11-09", "10:00") }] },
        requesterPreferences: preferences({
          weekCounts: { "2026-11-02": 2 },
          weeklyLimit: 2,
          weeklyWindows: [{ end: "11:00", start: "10:00", weekday: "monday" }],
        }),
      }),
    );

    // Inside the hours in a week below the limit, then inside the hours in a
    // full week, then outside the hours.
    expect(starts(result)[0]).toBe(kst("2026-11-09", "10:00").toISOString());
    const ordered = starts(result);
    expect(ordered.indexOf(kst("2026-11-02", "10:00").toISOString())).toBeLessThan(ordered.indexOf(kst("2026-11-09", "12:00").toISOString()));
  });

  it("keeps the host's own weekly limit ahead of the guest-host's preferences", () => {
    const result = evaluateFeasibility(
      input({
        bookedStarts: [kst("2026-11-10", "15:00").getTime()],
        host: { ...HOST, weeklyLimit: 1 },
        request: { windows: [thisMonday, nextMonday] },
        requesterPreferences: preferences({ weekCounts: { "2026-11-02": 5 }, weeklyLimit: 1, weeklyWindows: [] }),
      }),
    );

    // Next week is full for the host, so this week comes first even though it is full for the guest.
    expect(starts(result)[0]).toBe(thisMonday.start.toISOString());
    expect(result.candidates.at(-1)!.belowWeeklyLimit).toBe(false);
  });

  it("keeps the request's stated preferences ahead of the guest-host's standing ones", () => {
    const morning = { end: kst("2026-11-02", "10:30"), start: kst("2026-11-02", "10:00") };
    const result = evaluateFeasibility(
      input({ request: { preferredWindows: [morning], windows: [monday] }, requesterPreferences: preferences() }),
    );

    expect(starts(result)[0]).toBe(kst("2026-11-02", "10:00").toISOString());
    expect(starts(result)[1]).toBe(kst("2026-11-02", "12:00").toISOString());
  });

  it("explains the preferences to the guest only", () => {
    const result = evaluateFeasibility(
      input({
        request: { windows: [monday] },
        requesterPreferences: preferences({ weekCounts: { "2026-11-02": 1 }, weeklyLimit: 3 }),
      }),
    );
    const projection = requesterProjection(result.candidates, {
      displayTimezone: "Asia/Seoul",
      id: "e",
      notes: result.requesterNotes,
      state: "completed",
    });

    expect(projection.candidates[0]!.notes).toEqual(["Inside your usual Monday hours 12:00–13:00.", "That week has 1 of your 3 weekly meetings."]);
    expect(projection.candidates.at(-1)!.notes).toEqual([
      "Outside your usual hours, so it comes after times inside them.",
      "That week has 1 of your 3 weekly meetings.",
    ]);
    // The host's record carries none of it.
    expect(JSON.stringify(result.candidates)).not.toMatch(/usual|weekly meetings/);
  });

  it("adds no notes and changes nothing without preferences", () => {
    const result = evaluateFeasibility(input({ request: { windows: [monday] } }));
    expect(result.requesterNotes.size).toBe(0);
    const projection = requesterProjection(result.candidates, { displayTimezone: "Asia/Seoul", id: "e", notes: result.requesterNotes, state: "completed" });
    expect(projection.candidates.every((candidate) => candidate.notes === undefined)).toBe(true);
  });
});

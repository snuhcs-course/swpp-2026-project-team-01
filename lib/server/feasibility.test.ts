import { describe, expect, it } from "vitest";
import type { WeeklyWindow } from "../contracts/setup";
import {
  applyRanking,
  type BusyInterval,
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
  weeklyWindows: weekdays("10:00", "17:00"),
};

// Stands in for the evaluation's keyed hash: opaque, and different per text.
const hashed = (text: string) => `h:${Buffer.from(text).toString("hex")}`;
const place = (text: string): Endpoint => ({ key: hashed(text), kind: "place", text });
const MEETING = { key: hashed("Cafe Onion, Seongsu"), text: "Cafe Onion, Seongsu" };

function busy(start: Date, end: Date, endpoint: Endpoint = { kind: "unknown", reason: "no_location" }): BusyInterval {
  return { allDay: false, end: end.getTime(), endpoint, start: start.getTime() };
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

  it("never offers a start at or before the clock", () => {
    const result = evaluateFeasibility(input({ now: kst("2026-11-02", "12:20") }));
    expect(starts(result)).toEqual([kst("2026-11-02", "12:30").toISOString()]);
  });

  it("applies the buffers before and after busy time", () => {
    const result = evaluateFeasibility(
      input({ hostBusy: [busy(kst("2026-11-02", "11:00"), kst("2026-11-02", "11:30"))] }),
    );

    // 10:30 would end at 11:00, 10 minutes short of the buffer; 11:30 starts inside it.
    expect(starts(result)).toEqual(
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
    expect(result.candidates.at(-1)!.end).toBe("2026-11-01T08:00:00.000Z");
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
  it("offers weeks below the limit first without explaining the limit to the requester", () => {
    const thisWeek = { end: kst("2026-11-02", "11:00"), start: kst("2026-11-02", "10:00") };
    const nextWeek = { end: kst("2026-11-09", "11:00"), start: kst("2026-11-09", "10:00") };
    const meetings = [3, 4].map((day) => busy(kst(`2026-11-0${day}`, "15:00"), kst(`2026-11-0${day}`, "15:30")));
    const result = evaluateFeasibility(
      input({ host: { ...HOST, weeklyLimit: 2 }, hostBusy: meetings, request: { windows: [thisWeek, nextWeek] } }),
    );

    expect(starts(result)[0]).toBe(nextWeek.start.toISOString());
    expect(result.candidates.at(-1)!.belowWeeklyLimit).toBe(false);
    expect(result.candidates.at(-1)!.basis.join(" ")).toContain("at or over your limit of 2");

    const projected = requesterProjection(result.candidates, { displayTimezone: "Asia/Seoul", id: "e", state: "completed" });
    expect(projected.candidates[0]!.start).toBe(nextWeek.start.toISOString());
    expect(JSON.stringify(projected)).not.toMatch(/limit|week/i);
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

describe("ranking order", () => {
  it("puts ranked candidates first and keeps the rest in their deterministic order", () => {
    const result = evaluateFeasibility(input());
    const ids = result.candidates.map((candidate) => candidate.id);
    const ordered = applyRanking(result.candidates, [ids[3]!, ids[1]!]).map((candidate) => candidate.id);

    expect(ordered).toEqual([ids[3], ids[1], ids[0], ids[2], ...ids.slice(4)]);
    expect(applyRanking(result.candidates, null).map((candidate) => candidate.id)).toEqual(ids);
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

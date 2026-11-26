import { describe, expect, it, vi } from "vitest";
import type { WeeklyWindow } from "../contracts/setup";
import type { BusyInterval, HostRules, LegQuery, RouteOutcome } from "./feasibility";
import { findGroupOptions, type GroupParticipantInput, type GroupSearch, OPTIONS_SHOWN } from "./group-options";

// The group meeting search (group-scheduling: Host told when the group closes).

function kst(date: string, clock: string) {
  return new Date(`${date}T${clock}:00+09:00`);
}

const weekdays = (start: string, end: string): WeeklyWindow[] =>
  (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map((weekday) => ({ end, start, weekday }));

const HOST: HostRules = {
  bufferAfterMinutes: 0,
  bufferBeforeMinutes: 0,
  meetingMode: "either",
  timezone: "Asia/Seoul",
  travelBufferMinutes: 0,
  travelMode: "transit",
  weeklyLimit: null,
  weeklyLimitCounts: "bookings",
  weeklyWindows: weekdays("10:00", "17:00"),
};

const hash = (text: string) => `h:${Buffer.from(text).toString("hex")}`;
const ref = (text: string) => ({ key: hash(text), text });

function busy(start: Date, end: Date, place: string | null = null): BusyInterval {
  return {
    allDay: false,
    end: end.getTime(),
    endpoint: place ? { key: hash(place), kind: "place", text: place } : { kind: "unknown", reason: "no_location" },
    meeting: false,
    start: start.getTime(),
  };
}

function participant(requestId: string, overrides: Partial<GroupParticipantInput> = {}): GroupParticipantInput {
  return { busy: [], preferredHours: [], requestId, timezone: "Asia/Seoul", travelMode: "transit", usualPlace: null, ...overrides };
}

function search(overrides: Partial<GroupSearch> = {}): GroupSearch {
  return {
    bookedStarts: [],
    durationMinutes: 60,
    host: HOST,
    hostBusy: [],
    hostPlaces: [ref("강남역")],
    meetAvailable: true,
    now: new Date("2026-11-01T00:00:00Z"),
    participants: [participant("a"), participant("b")],
    range: { end: kst("2026-11-04", "00:00"), start: kst("2026-11-02", "00:00") },
    timezone: "Asia/Seoul",
    ...overrides,
  };
}

// Every trip takes the given minutes.
function routes(minutes: number) {
  return vi.fn(async (queries: readonly LegQuery[]) => {
    const { legQueryKey } = await import("./feasibility");
    return new Map<string, RouteOutcome>(queries.map((query) => [legQueryKey(query), { durationSeconds: minutes * 60, outcome: "route" }]));
  });
}

describe("group meeting options", () => {
  it("offers times at the host's place that fit everyone, without looking further", async () => {
    const between = vi.fn(async () => "Middle Station");
    const options = await findGroupOptions(search(), { between, estimate: routes(10), hash });

    expect(options.length).toBeGreaterThanOrEqual(OPTIONS_SHOWN);
    expect(options.every((option) => option.mode === "in_person" && option.place === "강남역" && option.missing.length === 0)).toBe(true);
    expect(between).not.toHaveBeenCalled();
  });

  it("leaves out a time a participant confirmed they cannot meet", async () => {
    const options = await findGroupOptions(
      search({ participants: [participant("a", { busy: [busy(kst("2026-11-02", "00:00"), kst("2026-11-03", "00:00"))] }), participant("b")] }),
      { between: async () => null, estimate: routes(10), hash },
    );

    expect(options.length).toBeGreaterThan(0);
    expect(options.every((option) => option.start >= kst("2026-11-03", "00:00"))).toBe(true);
  });

  it("names who cannot make each option when no time fits everyone", async () => {
    const options = await findGroupOptions(
      search({ participants: [participant("a", { busy: [busy(kst("2026-11-02", "00:00"), kst("2026-11-04", "00:00"))] }), participant("b")] }),
      { between: async () => null, estimate: routes(10), hash },
    );

    expect(options.length).toBeGreaterThan(0);
    expect(options.every((option) => option.missing.length === 1 && option.missing[0] === "a")).toBe(true);
  });

  it("checks a participant's trip from the event before, at its stored place", async () => {
    // Busy at Suwon until 12:00 on Monday: with a 90-minute trip, 12:00 and
    // 13:00 at Gangnam do not fit them, 14:00 does.
    const a = participant("a", { busy: [busy(kst("2026-11-02", "11:00"), kst("2026-11-02", "12:00"), "수원역")] });
    const options = await findGroupOptions(
      search({ participants: [a], range: { end: kst("2026-11-03", "00:00"), start: kst("2026-11-02", "00:00") } }),
      { between: async () => null, estimate: routes(90), hash },
    );
    const starts = options.map((option) => option.start.getTime());

    expect(starts).not.toContain(kst("2026-11-02", "12:00").getTime());
    expect(starts).not.toContain(kst("2026-11-02", "13:00").getTime());
    expect(starts).toContain(kst("2026-11-02", "14:00").getTime());
  });

  it("tries the participants' usual places, then a place between them, when the host has none", async () => {
    const between = vi.fn(async () => "Middle Station");
    const options = await findGroupOptions(
      search({
        hostPlaces: [],
        participants: [participant("a", { usualPlace: ref("신촌") }), participant("b", { usualPlace: ref("잠실") })],
      }),
      { between, estimate: routes(10), hash },
    );

    expect(options[0]?.place).toMatch(/신촌|잠실/);
    expect(between).not.toHaveBeenCalled();
  });

  it("looks for a place between the participants while fewer than three options fit everyone", async () => {
    // One two-hour opening in the range gives one time at each place.
    const between = vi.fn(async () => "Middle Station");
    await findGroupOptions(
      search({
        durationMinutes: 120,
        host: { ...HOST, weeklyWindows: weekdays("10:00", "12:00") },
        participants: [participant("a", { usualPlace: ref("신촌") }), participant("b", { usualPlace: ref("잠실") })],
        range: { end: kst("2026-11-03", "00:00"), start: kst("2026-11-02", "00:00") },
      }),
      { between, estimate: routes(10), hash },
    );

    expect(between).toHaveBeenCalledWith(["신촌", "잠실"]);
  });

  it("offers online times when there is no place to meet", async () => {
    const options = await findGroupOptions(search({ hostPlaces: [] }), { between: async () => null, estimate: routes(10), hash });

    expect(options.length).toBeGreaterThan(0);
    expect(options.every((option) => option.mode === "online" && option.place === null)).toBe(true);
  });

  it("offers nothing online without Google Meet", async () => {
    const options = await findGroupOptions(search({ hostPlaces: [], meetAvailable: false }), { between: async () => null, estimate: routes(10), hash });

    expect(options).toEqual([]);
  });

  it("orders times inside the participants' preferred hours first", async () => {
    const options = await findGroupOptions(
      search({ participants: [participant("a", { preferredHours: [{ end: "17:00", start: "15:00" }] }), participant("b", { preferredHours: [{ end: "17:00", start: "15:00" }] })] }),
      { between: async () => null, estimate: routes(10), hash },
    );
    const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });

    expect(clock.format(options[0]!.start) >= "15:00").toBe(true);
  });

  it("finds the one evening everyone is free in a long range the host is mostly free in", async () => {
    // Two weeks, the host free 10:00–21:00 every weekday: far more host times
    // than the engine keeps. Only the second Thursday evening is free for both.
    const range = { end: kst("2026-11-16", "00:00"), start: kst("2026-11-02", "00:00") };
    const everyDay = (until: Date) => [busy(range.start, until), busy(new Date(until.getTime() + 2 * 3_600_000), range.end)];
    const options = await findGroupOptions(
      search({
        host: { ...HOST, weeklyWindows: weekdays("10:00", "21:00") },
        hostPlaces: [ref("강남역"), ref("역삼역")],
        participants: [participant("a", { busy: everyDay(kst("2026-11-12", "19:00")) }), participant("b", { busy: everyDay(kst("2026-11-12", "19:00")) })],
        range,
      }),
      { between: async () => null, estimate: routes(10), hash },
    );

    expect(options.length).toBeGreaterThan(0);
    expect(options.every((option) => option.missing.length === 0 && option.start >= kst("2026-11-12", "19:00") && option.end <= kst("2026-11-12", "21:00"))).toBe(true);
  });

  it("keeps one place per time", async () => {
    const options = await findGroupOptions(search({ hostPlaces: [ref("강남역"), ref("역삼역")] }), { between: async () => null, estimate: routes(10), hash });
    const starts = options.map((option) => option.start.getTime());

    expect(new Set(starts).size).toBe(starts.length);
  });
});

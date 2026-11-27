import type { DashboardData } from "@lib/server/host-dashboard";
import { describe, expect, it, vi } from "vitest";
import { createDashboardCache, dateAt, FRESH_MS, periodRange, shiftPeriod, weekHours } from "./host-dashboard-data";

function answer(timeZone: string): DashboardData {
  return { events: [], googleWarning: null, timeZone } as unknown as DashboardData;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, reject, resolve };
}

describe("dashboard periods", () => {
  it("asks for a week from the day before Monday to two days after Sunday", () => {
    expect(periodRange(dateAt("2026-11-25"), "week")).toBe("2026-11-22T12:00:00.000Z|2026-12-01T12:00:00.000Z");
  });

  it("moves a week by seven days and a month to the first of the next or previous one", () => {
    expect(shiftPeriod(dateAt("2026-11-25"), "week", 1).toISOString()).toBe("2026-12-02T12:00:00.000Z");
    expect(shiftPeriod(dateAt("2026-11-25"), "month", -1).toISOString()).toBe("2026-10-01T12:00:00.000Z");
  });
});

describe("dashboard cache", () => {
  it("keeps a loaded week, so returning to it needs no new request before it shows", async () => {
    const fetchRange = vi.fn(async () => answer("Asia/Seoul"));
    const cache = createDashboardCache(fetchRange);
    const week = periodRange(dateAt("2026-11-25"), "week");

    expect(cache.peek(week)).toBeNull();
    await cache.load(week);
    expect(cache.peek(week)?.timeZone).toBe("Asia/Seoul");
    expect(fetchRange).toHaveBeenCalledWith("2026-11-22T12:00:00.000Z", "2026-12-01T12:00:00.000Z");
  });

  it("sends one request for a range at a time and prefetches only ranges not yet loaded", async () => {
    const fetchRange = vi.fn(async () => answer("UTC"));
    const cache = createDashboardCache(fetchRange);
    const next = periodRange(dateAt("2026-12-02"), "week");

    const first = cache.load(next);
    cache.prefetch(next);
    await first;
    cache.prefetch(next);
    expect(fetchRange).toHaveBeenCalledTimes(1);
  });

  it("files a late answer under its own week, so the week on screen keeps its own events", async () => {
    const slow = deferred<DashboardData>();
    const fast = deferred<DashboardData>();
    const cache = createDashboardCache((from) => (from.startsWith("2026-11-22") ? slow.promise : fast.promise));
    const left = periodRange(dateAt("2026-11-25"), "week");
    const shown = periodRange(dateAt("2026-12-02"), "week");

    const leftLoad = cache.load(left);
    const shownLoad = cache.load(shown);
    fast.resolve(answer("shown"));
    await shownLoad;
    slow.resolve(answer("left"));
    await leftLoad;

    expect(cache.peek(shown)?.timeZone).toBe("shown");
    expect(cache.peek(left)?.timeZone).toBe("left");
  });

  it("reuses a fresh answer and asks again once it is older than FRESH_MS", async () => {
    let clock = 0;
    const fetchRange = vi.fn(async () => answer("UTC"));
    const cache = createDashboardCache(fetchRange, () => clock);
    const week = periodRange(dateAt("2026-11-25"), "week");

    await cache.load(week);
    clock = FRESH_MS - 1;
    await cache.load(week);
    expect(fetchRange).toHaveBeenCalledTimes(1);
    clock = 2 * FRESH_MS;
    await cache.load(week);
    expect(fetchRange).toHaveBeenCalledTimes(2);
  });

  it("caches no failure, keeps an earlier answer and lets the range load again", async () => {
    let clock = 0;
    let fail = false;
    const fetchRange = vi.fn(async () => {
      if (fail) throw new Error("down");
      return answer("UTC");
    });
    const cache = createDashboardCache(fetchRange, () => clock);
    const week = periodRange(dateAt("2026-11-25"), "week");

    await cache.load(week);
    clock = 2 * FRESH_MS;
    fail = true;
    await expect(cache.load(week)).rejects.toThrow("down");
    expect(cache.peek(week)?.timeZone).toBe("UTC");
    fail = false;
    await cache.load(week);
    expect(fetchRange).toHaveBeenCalledTimes(3);
  });
});

describe("weekHours", () => {
  const open = (start: string, end: string) => ({ start, end });

  it("covers the host's open hours, not a fixed day (#482)", () => {
    expect(weekHours([open("10:00", "20:00")], [])).toEqual({ start: 10, end: 20 });
  });

  it("runs from the earliest opening to the latest closing, rounding out to whole hours", () => {
    expect(weekHours([open("09:30", "12:00"), open("13:00", "18:15")], [])).toEqual({ start: 9, end: 19 });
  });

  it("widens to hold a timed event outside the open hours", () => {
    expect(weekHours([open("10:00", "20:00")], [{ start: 7 * 60, end: 8 * 60 }, { start: 21 * 60, end: 21 * 60 + 30 }])).toEqual({ start: 7, end: 22 });
  });

  it("runs an overnight window and an event past midnight to the day's edges", () => {
    expect(weekHours([open("22:00", "02:00")], [])).toEqual({ start: 0, end: 24 });
    expect(weekHours([open("10:00", "18:00")], [{ start: 23 * 60, end: 60 }])).toEqual({ start: 10, end: 24 });
  });

  it("keeps an event that starts and ends at the same moment in its own hour, not to midnight", () => {
    expect(weekHours([open("08:00", "18:00")], [{ start: 9 * 60, end: 9 * 60 }])).toEqual({ start: 8, end: 18 });
    expect(weekHours([open("08:00", "18:00")], [{ start: 21 * 60, end: 21 * 60 }])).toEqual({ start: 8, end: 22 });
  });

  it("falls back to 08:00 to 19:00 with no hours and no events", () => {
    expect(weekHours([], [])).toEqual({ start: 8, end: 19 });
  });
});

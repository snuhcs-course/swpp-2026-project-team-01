import type { WeeklyWindow } from "@lib/contracts/setup";
import type { DashboardData } from "@lib/server/host-dashboard";

// The Dashboard's periods and the events loaded for them. Each period asks for
// its own range, kept for the visit, so a week already seen shows its events at
// once while it refreshes, and the periods either side are fetched ahead.

export type View = "week" | "month";
export const DAY = 86_400_000;

export const dateAt = (key: string) => new Date(`${key}T12:00:00.000Z`);
export const shift = (date: Date, days: number) => new Date(date.getTime() + days * DAY);
export const weekStart = (date: Date) => shift(date, -((date.getUTCDay() + 6) % 7));
export const monthStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));

export function periodDays(anchor: Date, view: View) {
  const first = view === "week" ? weekStart(anchor) : weekStart(monthStart(anchor));
  const count = view === "week" ? 7 : Math.ceil((new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0, 12)).getTime() - first.getTime() + DAY) / (7 * DAY)) * 7;
  return Array.from({ length: count }, (_, index) => shift(first, index));
}

// The anchor of the previous (-1) or next (1) period.
export function shiftPeriod(anchor: Date, view: View, direction: number) {
  return view === "week" ? shift(anchor, direction * 7) : new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + direction, 1, 12));
}

// The range a period asks for: a day beyond each end, so events in any host
// timezone are included. Its "from|to" string keys the cache.
export function periodRange(anchor: Date, view: View) {
  const days = periodDays(anchor, view);
  return `${new Date(days[0]!.getTime() - DAY).toISOString()}|${new Date(days.at(-1)!.getTime() + 2 * DAY).toISOString()}`;
}

// The hours the week grid draws, as whole hours [start, end) of the local day.
// It runs from the earliest opening to the latest closing of the host's weekly
// hours, widened to hold the week's timed events; an overnight window runs to
// midnight and from midnight. With neither, it is 08:00 to 19:00.
export const DEFAULT_WEEK_HOURS = { start: 8, end: 19 } as const;

const clockMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

export function weekHours(
  windows: readonly Pick<WeeklyWindow, "start" | "end">[],
  // Each timed event's start and end, in minutes of its local day; an end before
  // the start runs past midnight, and an end equal to the start is a moment.
  events: readonly { readonly start: number; readonly end: number }[],
) {
  const spans: [number, number][] = [];
  for (const window of windows) {
    const start = clockMinutes(window.start), end = clockMinutes(window.end);
    if (end > start) spans.push([start, end]);
    else spans.push([start, 1440], [0, end]);
  }
  for (const event of events) spans.push([event.start, event.end < event.start ? 1440 : Math.max(event.end, event.start + 1)]);
  const used = spans.filter(([start, end]) => end > start);
  if (used.length === 0) return { ...DEFAULT_WEEK_HOURS };
  const start = Math.floor(Math.min(...used.map(([from]) => from)) / 60);
  const end = Math.ceil(Math.max(...used.map(([, to]) => to)) / 60);
  return { start, end: Math.max(end, start + 1) };
}

export type FetchRange = (from: string, to: string) => Promise<DashboardData>;

export const fetchDashboardRange: FetchRange = async (from, to) => {
  const response = await fetch(`/api/host/dashboard?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("dashboard_unavailable");
  return (await response.json()) as DashboardData;
};

// Loaded ranges for this visit. One request per range is in flight at a time,
// and an answer under FRESH_MS old is reused without asking again, so quick
// navigation does not list Google Calendar for each step; a failed load keeps
// any earlier answer and is not cached. The screen reads
// the range it shows with `peek`, so an answer that arrives late, for a week the
// host has left, fills the cache without replacing what is on screen.
export const FRESH_MS = 30_000;

export function createDashboardCache(fetchRange: FetchRange, now: () => number = Date.now) {
  const loaded = new Map<string, DashboardData>();
  const loadedAt = new Map<string, number>();
  const inFlight = new Map<string, Promise<DashboardData>>();

  function load(range: string) {
    const pending = inFlight.get(range);
    if (pending) return pending;
    const kept = loaded.get(range);
    if (kept && now() - (loadedAt.get(range) ?? 0) < FRESH_MS) return Promise.resolve(kept);
    const [from, to] = range.split("|");
    const request = fetchRange(from!, to!)
      .then((data) => {
        loaded.set(range, data);
        loadedAt.set(range, now());
        return data;
      })
      .finally(() => inFlight.delete(range));
    inFlight.set(range, request);
    return request;
  }

  return {
    load,
    peek: (range: string) => loaded.get(range) ?? null,
    // Fetches a range ahead only when it has not been loaded, ignoring failure.
    prefetch: (range: string) => {
      if (!loaded.has(range)) load(range).catch(() => undefined);
    },
  };
}

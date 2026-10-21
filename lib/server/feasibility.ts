import type { LinkPlan, RequesterCandidate, RequesterEvaluation, RequesterTravelMode, EvaluationState } from "../contracts/request";
import {
  endsNextDay,
  type MeetingMode,
  type noteExclusionSchema,
  type TravelMode,
  WEEKDAYS,
  type WeeklyWindow,
  type Weekday,
} from "../contracts/setup";
import type { z } from "zod";
import type { CalendarEvent } from "./google-calendar";

// The deterministic feasibility engine (design decisions 8 to 10). It is pure:
// the evaluation job reads calendars, routes and allowances, and passes them in
// with the clock. In order it
//   1. builds the host's weekly windows as instants in the host timezone, each
//      owned by its starting weekday, with an ambiguous or nonexistent boundary
//      yielding no window;
//   2. intersects them with the requester's windows on a 15-minute start grid,
//      keeping only full intervals that start in the future;
//   3. removes candidates overlapping host busy intervals widened by the buffers,
//      and requester busy intervals as they are;
//   4. orders weeks below the weekly limit first (a preference, never a filter);
//   5. for in-person candidates, checks both host travel legs and, with a
//      requester calendar, both requester legs (design decision 9).
// Every explanation is a sentence computed here from the candidate's basis
// (iteration 1's F09), never model text. Event titles, attendees and locations
// never leave this module: legs carry only the caller's keyed endpoint hashes.

const MINUTE = 60_000;
const DAY = 86_400_000;
export const GRID_MINUTES = 15;
// Interval-feasible candidates kept, in preference order, and so the most whose
// travel is checked; the rest are not offered. Ranking sees at most 20, so twice
// that leaves room for candidates lost to travel without spending the deadline
// on Routes.
export const CANDIDATE_LIMIT = 40;
// Host-private exclusion records kept per evaluation; the counts cover them all.
export const MAX_EXCLUSIONS = 100;

export type RouteMode = RequesterTravelMode;

// ---------------------------------------------------------------------------
// Zones, without Temporal: Intl gives the local wall clock of an instant, and a
// local clock is resolved by trying the offsets in force a day either side.

type LocalParts = { readonly date: string; readonly minute: number; readonly weekday: Weekday; readonly second: number };

const SHORT_WEEKDAYS: Readonly<Record<string, Weekday>> = {
  Fri: "friday",
  Mon: "monday",
  Sat: "saturday",
  Sun: "sunday",
  Thu: "thursday",
  Tue: "tuesday",
  Wed: "wednesday",
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let cached = formatters.get(timeZone);

  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone,
      weekday: "short",
      year: "numeric",
    });
    formatters.set(timeZone, cached);
  }

  return cached;
}

export function localParts(instant: number, timeZone: string): LocalParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
    second: Number(parts.second),
    weekday: SHORT_WEEKDAYS[parts.weekday!]!,
  };
}

function offsetAt(instant: number, timeZone: string) {
  const local = localParts(instant, timeZone);
  const [year, month, day] = local.date.split("-").map(Number);
  const wall = Date.UTC(year!, month! - 1, day!, 0, local.minute, local.second);
  return wall - Math.floor(instant / 1000) * 1000;
}

export function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function clockMinutes(clock: string) {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours! * 60 + minutes!;
}

// Every instant whose wall clock in the zone is the given local date and clock:
// none when a clock change skips it, two when one repeats it.
export function resolveLocalTime(date: string, clock: string, timeZone: string): number[] {
  const [year, month, day] = date.split("-").map(Number);
  const wall = Date.UTC(year!, month! - 1, day!, 0, clockMinutes(clock));
  const offsets = new Set([offsetAt(wall - DAY, timeZone), offsetAt(wall, timeZone), offsetAt(wall + DAY, timeZone)]);
  const instants = new Set<number>();

  for (const offset of offsets) {
    const instant = wall - offset;
    const local = localParts(instant, timeZone);
    if (local.date === date && local.minute === clockMinutes(clock)) instants.add(instant);
  }

  return [...instants].sort((a, b) => a - b);
}

// The first instant of a local date. Where a clock change skips midnight, the
// day starts at the first wall clock that exists.
export function startOfLocalDay(date: string, timeZone: string) {
  for (let minute = 0; minute < 24 * 60; minute += GRID_MINUTES) {
    const clock = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const [first] = resolveLocalTime(date, clock, timeZone);
    if (first !== undefined) return first;
  }

  throw new Error(`No instant starts ${date} in ${timeZone}.`);
}

// The Monday that starts the local week of an instant.
function weekOf(instant: number, timeZone: string) {
  const local = localParts(instant, timeZone);
  return addDays(local.date, -WEEKDAYS.indexOf(local.weekday));
}

// ---------------------------------------------------------------------------
// Busy intervals under iteration 1's F02 rules

// Where an adjacent commitment happens. Only a place, without a conference link,
// can anchor a trip; the caller's keyed hash of the text identifies it in legs,
// allowances and the route cache.
export type Endpoint =
  | { readonly kind: "place"; readonly text: string; readonly key: string }
  | { readonly kind: "unknown"; readonly reason: "no_location" | "conference_only" | "place_and_link" };

export type BusyInterval = {
  readonly start: number;
  readonly end: number;
  // All-day events block time but never anchor travel.
  readonly allDay: boolean;
  readonly endpoint: Endpoint;
};

export type NoteExclusion = z.infer<typeof noteExclusionSchema>;

export type NormalizeOptions = {
  readonly timezone: string;
  // The calendar owner's address, for declined invitations when Google omits `self`.
  readonly selfEmail: string | null;
  readonly noteExclusions?: readonly NoteExclusion[];
  // The keyed hash of a location text.
  readonly endpointKey: (text: string) => string;
};

function identity(event: CalendarEvent) {
  if (!event.iCalUID) return `id:${event.id}`;
  const start = event.start.dateTime ? new Date(event.start.dateTime).toISOString() : (event.start.date ?? "");
  return `uid:${event.iCalUID}|${start}`;
}

function endpointOf(event: CalendarEvent, endpointKey: (text: string) => string): Endpoint {
  if (event.location && event.hasConferenceLink) return { kind: "unknown", reason: "place_and_link" };
  if (event.hasConferenceLink) return { kind: "unknown", reason: "conference_only" };
  if (!event.location) return { kind: "unknown", reason: "no_location" };
  return { key: endpointKey(event.location), kind: "place", text: event.location };
}

// Busy unless cancelled, transparent or declined by the owner; copies of one
// event on several calendars merged by provider identity; note-like entries the
// host excluded (with an unchanged fingerprint) removed; all-day events blocking
// their local dates in the given zone.
export function normalizeBusy(events: readonly CalendarEvent[], options: NormalizeOptions): BusyInterval[] {
  const self = options.selfEmail?.trim().toLowerCase() ?? null;
  const excluded = new Set(
    (options.noteExclusions ?? []).map((entry) => `${entry.calendarId}\u0000${entry.eventId}\u0000${entry.fingerprint}`),
  );
  const seen = new Set<string>();
  const busy: BusyInterval[] = [];

  for (const event of events) {
    if (event.status === "cancelled" || event.transparency === "transparent") continue;
    if (
      event.attendees.some(
        (attendee) => (attendee.self || attendee.email.toLowerCase() === self) && attendee.responseStatus === "declined",
      )
    ) {
      continue;
    }
    if (excluded.has(`${event.calendarId}\u0000${event.id}\u0000${event.updated ?? ""}`)) continue;

    const key = identity(event);
    if (seen.has(key)) continue;
    seen.add(key);

    if (event.start.dateTime && event.end.dateTime) {
      const start = Date.parse(event.start.dateTime);
      const end = Date.parse(event.end.dateTime);
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
      busy.push({ allDay: false, end, endpoint: endpointOf(event, options.endpointKey), start });
    } else if (event.start.date && event.end.date) {
      const start = startOfLocalDay(event.start.date, options.timezone);
      const end = startOfLocalDay(event.end.date, options.timezone);
      if (end <= start) continue;
      busy.push({ allDay: true, end, endpoint: { kind: "unknown", reason: "no_location" }, start });
    }
  }

  return busy.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Inputs and results

export type HostRules = {
  readonly timezone: string;
  readonly weeklyWindows: readonly WeeklyWindow[];
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly weeklyLimit: number | null;
  readonly meetingMode: MeetingMode;
  readonly travelMode: TravelMode | null;
  readonly travelBufferMinutes: number | null;
};

export type RequestTerms = {
  readonly durationMinutes: number;
  readonly mode: MeetingMode | null;
  // The in-person meeting place, keyed like event places.
  readonly location: { readonly text: string; readonly key: string } | null;
  readonly linkPlan: LinkPlan | null;
  readonly windows: readonly { readonly start: Date; readonly end: Date }[];
  readonly timezone: string;
  readonly travelMode: RequesterTravelMode | null;
};

// One trip the engine needs a route estimate for. origin and destination are
// cleartext, for the Routes call only; the keys are what may be stored.
export type LegQuery = {
  readonly origin: string;
  readonly destination: string;
  readonly originKey: string;
  readonly destinationKey: string;
  readonly mode: RouteMode;
  readonly departure: Date;
};

export type RouteOutcome =
  | { readonly outcome: "route"; readonly durationSeconds: number }
  | { readonly outcome: "no_route" }
  | { readonly outcome: "failed" };

export type TravelAllowance = {
  readonly party: "host" | "requester";
  readonly candidateStart: Date;
  readonly candidateEnd: Date;
  readonly direction: "inbound" | "outbound";
  readonly originKey: string;
  readonly destinationKey: string;
  readonly mode: RouteMode;
  readonly minutes: number;
};

export type FeasibilityInput = {
  readonly now: Date;
  readonly host: HostRules;
  readonly hostBusy: readonly BusyInterval[];
  readonly request: RequestTerms;
  // Null when the requester connected no calendar: no requester busy time or leg.
  readonly requesterBusy: readonly BusyInterval[] | null;
  // Saved or fetched estimates; undefined means not estimated.
  readonly estimate?: (query: LegQuery) => RouteOutcome | undefined;
  readonly allowances?: readonly TravelAllowance[];
  // Whether the booking destination can create Google Meet (design decision 11).
  readonly meetAvailable?: boolean;
};

export type UnresolvedReason =
  | "no_location"
  | "conference_only"
  | "place_and_link"
  | "meeting_location_unknown"
  | "travel_mode_depends"
  | "travel_mode_unknown"
  | "no_route"
  | "route_failed"
  | "not_estimated";

export type CandidateLeg = {
  readonly party: "host" | "requester";
  readonly direction: "inbound" | "outbound";
  readonly mode: RouteMode | null;
  readonly originKey: string | null;
  readonly destinationKey: string | null;
  readonly departure: string;
  readonly gapMinutes: number;
  readonly status: "fits" | "too_long" | "unresolved";
  readonly travelMinutes: number | null;
  readonly source: "route" | "allowance" | "same_place" | null;
  readonly unresolvedReason: UnresolvedReason | null;
};

export type CandidateStatus = "offered" | "requester_unresolved" | "host_unresolved";

// One candidate as the host's private record keeps it.
export type EvaluatedCandidate = {
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly durationMinutes: number;
  readonly mode: "online" | "in_person";
  readonly location: string | null;
  readonly linkPlan: LinkPlan | null;
  readonly status: CandidateStatus;
  readonly weekStart: string;
  readonly weekCount: number;
  readonly belowWeeklyLimit: boolean;
  readonly legs: readonly CandidateLeg[];
  readonly basis: readonly string[];
};

export type ExclusionReason = "host_busy" | "requester_unavailable" | "host_travel";

export type Exclusion = {
  readonly start: string;
  readonly end: string;
  readonly reason: ExclusionReason;
  readonly explanation: string;
};

export type UnresolvedWindow = {
  readonly date: string;
  readonly weekday: Weekday;
  readonly boundary: "start" | "end";
  readonly problem: "nonexistent" | "ambiguous";
};

export type FeasibilityResult = {
  readonly mode: "online" | "in_person" | null;
  readonly linkPlan: LinkPlan | null;
  // Ordered: weeks below the weekly limit first, then by start.
  readonly candidates: readonly EvaluatedCandidate[];
  readonly exclusions: readonly Exclusion[];
  readonly exclusionCounts: Readonly<Record<ExclusionReason, number>>;
  readonly unresolvedWindows: readonly UnresolvedWindow[];
};

// ---------------------------------------------------------------------------
// The engine

type Window = { readonly start: number; readonly end: number; readonly date: string; readonly rule: WeeklyWindow };

function hostWindows(input: FeasibilityInput, unresolved: UnresolvedWindow[]): Window[] {
  const { timezone, weeklyWindows } = input.host;
  const requested = input.request.windows;
  if (requested.length === 0) return [];

  const first = Math.min(...requested.map((window) => window.start.getTime()));
  const last = Math.max(...requested.map((window) => window.end.getTime()));
  const windows: Window[] = [];

  // The day before the first requested date, for its overnight tail.
  for (let date = addDays(localParts(first, timezone).date, -1); date <= localParts(last, timezone).date; date = addDays(date, 1)) {
    const weekday = WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]!;

    for (const rule of weeklyWindows) {
      if (rule.weekday !== weekday) continue;

      const starts = resolveLocalTime(date, rule.start, timezone);
      const ends = resolveLocalTime(endsNextDay(rule) ? addDays(date, 1) : date, rule.end, timezone);

      if (starts.length !== 1 || ends.length !== 1) {
        if (starts.length !== 1) {
          unresolved.push({ boundary: "start", date, problem: starts.length ? "ambiguous" : "nonexistent", weekday });
        }
        if (ends.length !== 1) {
          unresolved.push({ boundary: "end", date, problem: ends.length ? "ambiguous" : "nonexistent", weekday });
        }
        continue;
      }

      if (ends[0]! > starts[0]!) windows.push({ date, end: ends[0]!, rule, start: starts[0]! });
    }
  }

  return windows;
}

export function resolveMeetingMode(host: MeetingMode, requested: MeetingMode | null, hasLocation: boolean) {
  if (requested === "online" || requested === "in_person") {
    return host === "either" || host === requested ? requested : null;
  }
  if (host !== "either") return host;
  return hasLocation ? "in_person" : "online";
}

function overlaps(busy: readonly BusyInterval[], start: number, end: number) {
  return busy.some((interval) => interval.start < end && interval.end > start);
}

// The nearest busy timed commitment that ends at or before the candidate and the
// nearest that starts at or after it, inside the day span, whatever the gap.
function adjacent(busy: readonly BusyInterval[], start: number, end: number, span: { start: number; end: number }) {
  let previous: BusyInterval | null = null;
  let next: BusyInterval | null = null;

  for (const interval of busy) {
    if (interval.allDay) continue;
    if (interval.end <= start && interval.end > span.start && (!previous || interval.end > previous.end)) previous = interval;
    if (interval.start >= end && interval.start < span.end && (!next || interval.start < next.start)) next = interval;
  }

  return { next, previous };
}

export function legQueryKey(query: Pick<LegQuery, "originKey" | "destinationKey" | "mode" | "departure">) {
  return `${query.originKey}|${query.destinationKey}|${query.mode}|${departureSlot(query.departure).toISOString()}`;
}

// The 15-minute slot a departure falls in, which estimates are cached by.
export function departureSlot(departure: Date) {
  return new Date(Math.floor(departure.getTime() / (GRID_MINUTES * MINUTE)) * GRID_MINUTES * MINUTE);
}

const MODE_WORDS: Readonly<Record<RouteMode, string>> = {
  driving: "driving",
  transit: "public transit",
  walking: "walking",
};

const UNRESOLVED_WORDS: Readonly<Record<UnresolvedReason, string>> = {
  conference_only: "it has only a conference link",
  meeting_location_unknown: "the meeting place is not known yet",
  no_location: "it has no location",
  no_route: "Google Routes found no route for the travel mode",
  not_estimated: "no estimate was available in time",
  place_and_link: "it has both a place and a conference link",
  route_failed: "Google Routes could not be reached",
  travel_mode_depends: "your travel mode is Depends on the trip",
  travel_mode_unknown: "the travel mode is not known",
};

type LegPlan = {
  readonly party: "host" | "requester";
  readonly direction: "inbound" | "outbound";
  readonly mode: RouteMode | null;
  readonly origin: Endpoint | null;
  readonly destination: Endpoint | null;
  readonly departure: number;
  readonly gapMinutes: number;
  // Minutes beyond the trip itself that must fit in the gap.
  readonly extraMinutes: number;
  readonly unresolved: UnresolvedReason | null;
};

type Planned = {
  readonly start: number;
  readonly end: number;
  readonly window: Window;
  readonly weekStart: string;
  readonly weekCount: number;
  readonly belowLimit: boolean;
  readonly legs: readonly LegPlan[];
};

type Plan = {
  readonly mode: "online" | "in_person" | null;
  readonly linkPlan: LinkPlan | null;
  readonly planned: readonly Planned[];
  readonly exclusions: Exclusion[];
  readonly exclusionCounts: Record<ExclusionReason, number>;
  readonly unresolvedWindows: readonly UnresolvedWindow[];
};

function endpointOfLocation(location: RequestTerms["location"]): Endpoint | null {
  return location ? { key: location.key, kind: "place", text: location.text } : null;
}

function planLeg(
  party: "host" | "requester",
  direction: "inbound" | "outbound",
  commitment: BusyInterval,
  meeting: Endpoint | null,
  candidate: { start: number; end: number },
  mode: TravelMode | null,
  extraMinutes: number,
): LegPlan {
  const origin = direction === "inbound" ? commitment.endpoint : meeting;
  const destination = direction === "inbound" ? meeting : commitment.endpoint;
  const gap =
    direction === "inbound" ? (candidate.start - commitment.end) / MINUTE : (commitment.start - candidate.end) / MINUTE;
  const routeMode = mode === "driving" || mode === "transit" || mode === "walking" ? mode : null;
  const unknown = commitment.endpoint.kind === "unknown" ? commitment.endpoint.reason : null;
  const unresolved: UnresolvedReason | null =
    unknown ??
    (meeting === null
      ? "meeting_location_unknown"
      : mode === "depends"
        ? "travel_mode_depends"
        : routeMode === null
          ? "travel_mode_unknown"
          : null);

  return {
    departure: direction === "inbound" ? commitment.end : candidate.end,
    destination,
    direction,
    extraMinutes,
    gapMinutes: Math.round(gap),
    mode: routeMode,
    origin,
    party,
    unresolved,
  };
}

function plan(input: FeasibilityInput): Plan {
  const { host, request } = input;
  const now = input.now.getTime();
  const duration = request.durationMinutes * MINUTE;
  const exclusions: Exclusion[] = [];
  const exclusionCounts: Record<ExclusionReason, number> = { host_busy: 0, host_travel: 0, requester_unavailable: 0 };
  const unresolvedWindows: UnresolvedWindow[] = [];
  const mode = resolveMeetingMode(host.meetingMode, request.mode, request.location !== null);
  const linkPlan =
    mode === "online" ? (request.linkPlan ?? (input.meetAvailable ? { kind: "google_meet" as const } : null)) : null;

  const exclude = (start: number, end: number, reason: ExclusionReason, explanation: string) => {
    exclusionCounts[reason] += 1;
    if (exclusions.length < MAX_EXCLUSIONS) {
      exclusions.push({ end: new Date(end).toISOString(), explanation, reason, start: new Date(start).toISOString() });
    }
  };

  if (mode === null || duration <= 0) {
    return { exclusionCounts, exclusions, linkPlan, mode, planned: [], unresolvedWindows };
  }

  const before = host.bufferBeforeMinutes * MINUTE;
  const after = host.bufferAfterMinutes * MINUTE;
  const grid = GRID_MINUTES * MINUTE;
  const seen = new Set<number>();
  const intervals: { start: number; end: number; window: Window }[] = [];

  // Every zone in use today has an offset that is a whole number of quarter
  // hours, so a start on the UTC quarter-hour grid is on the local one too.
  for (const window of hostWindows(input, unresolvedWindows)) {
    for (const requested of request.windows) {
      const from = Math.max(window.start, requested.start.getTime(), now);
      const until = Math.min(window.end, requested.end.getTime());

      for (let start = Math.ceil(from / grid) * grid; start + duration <= until; start += grid) {
        if (start <= now || seen.has(start)) continue;
        seen.add(start);
        intervals.push({ end: start + duration, start, window });
      }
    }
  }

  intervals.sort((a, b) => a.start - b.start);

  const weekCounts = new Map<string, number>();
  for (const interval of input.hostBusy) {
    const week = weekOf(interval.start, host.timezone);
    weekCounts.set(week, (weekCounts.get(week) ?? 0) + 1);
  }

  const free: Omit<Planned, "legs">[] = [];

  for (const interval of intervals) {
    if (overlaps(input.hostBusy, interval.start - before, interval.end + after)) {
      exclude(
        interval.start,
        interval.end,
        "host_busy",
        `Overlaps a busy time on your conflict calendars, with ${host.bufferBeforeMinutes} minutes before and ${host.bufferAfterMinutes} minutes after.`,
      );
      continue;
    }

    if (input.requesterBusy && overlaps(input.requesterBusy, interval.start, interval.end)) {
      exclude(interval.start, interval.end, "requester_unavailable", "The requester is not available then.");
      continue;
    }

    const weekStart = weekOf(interval.start, host.timezone);
    const weekCount = weekCounts.get(weekStart) ?? 0;
    free.push({
      ...interval,
      belowLimit: host.weeklyLimit === null || weekCount < host.weeklyLimit,
      weekCount,
      weekStart,
    });
  }

  // Weeks below the limit first; the limit never removes a candidate.
  free.sort((a, b) => Number(b.belowLimit) - Number(a.belowLimit) || a.start - b.start);
  const kept = free.slice(0, CANDIDATE_LIMIT);

  if (mode === "online") {
    return { exclusionCounts, exclusions, linkPlan, mode, planned: kept.map((entry) => ({ ...entry, legs: [] })), unresolvedWindows };
  }

  const meeting = endpointOfLocation(request.location);
  const hostExtra = { inbound: host.bufferBeforeMinutes, outbound: host.bufferAfterMinutes };
  const travelBuffer = host.travelBufferMinutes ?? 0;
  const planned: Planned[] = kept.map((entry) => {
    const legs: LegPlan[] = [];
    // An overnight window's candidates belong to the window's starting day
    // through the window's end.
    const hostSpan = {
      end: Math.max(startOfLocalDay(addDays(entry.window.date, 1), host.timezone), entry.window.end),
      start: startOfLocalDay(entry.window.date, host.timezone),
    };
    const hostAdjacent = adjacent(input.hostBusy, entry.start, entry.end, hostSpan);

    if (hostAdjacent.previous) {
      legs.push(planLeg("host", "inbound", hostAdjacent.previous, meeting, entry, host.travelMode, hostExtra.inbound + travelBuffer));
    }
    if (hostAdjacent.next) {
      legs.push(planLeg("host", "outbound", hostAdjacent.next, meeting, entry, host.travelMode, hostExtra.outbound + travelBuffer));
    }

    if (input.requesterBusy) {
      const date = localParts(entry.start, request.timezone).date;
      const span = { end: startOfLocalDay(addDays(date, 1), request.timezone), start: startOfLocalDay(date, request.timezone) };
      const own = adjacent(input.requesterBusy, entry.start, entry.end, span);

      // The requester's own trips carry no host buffer.
      if (own.previous) legs.push(planLeg("requester", "inbound", own.previous, meeting, entry, request.travelMode, 0));
      if (own.next) legs.push(planLeg("requester", "outbound", own.next, meeting, entry, request.travelMode, 0));
    }

    return { ...entry, legs };
  });

  return { exclusionCounts, exclusions, linkPlan, mode, planned, unresolvedWindows };
}

function placeKey(endpoint: Endpoint | null) {
  return endpoint?.kind === "place" ? endpoint.key : null;
}

function legQuery(leg: LegPlan): LegQuery | null {
  if (leg.unresolved || leg.mode === null || leg.origin?.kind !== "place" || leg.destination?.kind !== "place") return null;
  if (leg.origin.key === leg.destination.key) return null;

  return {
    departure: new Date(leg.departure),
    destination: leg.destination.text,
    destinationKey: leg.destination.key,
    mode: leg.mode,
    origin: leg.origin.text,
    originKey: leg.origin.key,
  };
}

// The trips the engine needs estimates for, deduplicated by endpoints, mode and
// departure slot, so the evaluation can read the cache and call Routes once each.
export function travelQueries(input: FeasibilityInput): LegQuery[] {
  const queries = new Map<string, LegQuery>();

  for (const entry of plan(input).planned) {
    for (const leg of entry.legs) {
      const query = legQuery(leg);
      if (query && !queries.has(legQueryKey(query))) queries.set(legQueryKey(query), query);
    }
  }

  return [...queries.values()];
}

function matchingAllowance(input: FeasibilityInput, entry: Planned, leg: LegPlan) {
  const origin = placeKey(leg.origin);
  const destination = placeKey(leg.destination);
  if (!origin || !destination || !leg.mode) return null;

  return (
    input.allowances?.find(
      (allowance) =>
        allowance.party === leg.party &&
        allowance.direction === leg.direction &&
        allowance.candidateStart.getTime() === entry.start &&
        allowance.candidateEnd.getTime() === entry.end &&
        allowance.originKey === origin &&
        allowance.destinationKey === destination &&
        allowance.mode === leg.mode,
    ) ?? null
  );
}

function resolveLeg(input: FeasibilityInput, entry: Planned, leg: LegPlan): CandidateLeg {
  const base = {
    departure: new Date(leg.departure).toISOString(),
    destinationKey: placeKey(leg.destination),
    direction: leg.direction,
    gapMinutes: leg.gapMinutes,
    mode: leg.mode,
    originKey: placeKey(leg.origin),
    party: leg.party,
  };
  const fit = (travelMinutes: number, source: CandidateLeg["source"]): CandidateLeg => ({
    ...base,
    source,
    status: travelMinutes + leg.extraMinutes <= leg.gapMinutes ? "fits" : "too_long",
    travelMinutes,
    unresolvedReason: null,
  });
  const unresolved = (reason: UnresolvedReason): CandidateLeg => ({
    ...base,
    source: null,
    status: "unresolved",
    travelMinutes: null,
    unresolvedReason: reason,
  });

  // An allowance stands in for the estimate of exactly this leg; it never
  // covers an unknown endpoint, because it names both endpoints.
  const allowance = matchingAllowance(input, entry, leg);
  if (allowance) return fit(allowance.minutes, "allowance");
  if (leg.unresolved) return unresolved(leg.unresolved);
  if (base.originKey === base.destinationKey) return fit(0, "same_place");

  const outcome = input.estimate?.(legQuery(leg)!);
  if (!outcome) return unresolved("not_estimated");
  if (outcome.outcome === "no_route") return unresolved("no_route");
  if (outcome.outcome === "failed") return unresolved("route_failed");
  return fit(Math.ceil(outcome.durationSeconds / 60), "route");
}

function weekdayLabel(weekday: Weekday) {
  return weekday[0]!.toUpperCase() + weekday.slice(1);
}

function legSentence(leg: CandidateLeg, host: HostRules) {
  const from = leg.direction === "inbound" ? "from your previous commitment" : "to your next commitment";

  if (leg.party === "requester") {
    return leg.status === "fits"
      ? "The requester's own trip fits."
      : leg.status === "unresolved"
        ? "The requester's own trip could not be estimated."
        : "The requester cannot get there in time.";
  }

  if (leg.status === "unresolved") {
    return `Travel ${from} could not be estimated: ${UNRESOLVED_WORDS[leg.unresolvedReason!]}.`;
  }

  const buffer = (leg.direction === "inbound" ? host.bufferBeforeMinutes : host.bufferAfterMinutes) + (host.travelBufferMinutes ?? 0);
  const trip =
    leg.source === "same_place"
      ? "no travel (the same place)"
      : leg.source === "allowance"
        ? `the ${leg.travelMinutes} minutes you allowed`
        : `${leg.travelMinutes} minutes by ${MODE_WORDS[leg.mode!]}`;
  const verb = leg.status === "fits" ? "fits" : "does not fit";

  return `Travel ${from}: ${trip} plus ${buffer} minutes of buffers ${verb} the ${leg.gapMinutes}-minute gap.`;
}

function basisFor(input: FeasibilityInput, entry: Planned, mode: "online" | "in_person", legs: readonly CandidateLeg[]) {
  const { host } = input;
  const rule = entry.window.rule;
  const sentences = [
    `Inside your ${weekdayLabel(rule.weekday)} hours ${rule.start}–${rule.end}${endsNextDay(rule) ? " (next day)" : ""} in ${host.timezone}.`,
    `Free on your conflict calendars with ${host.bufferBeforeMinutes} minutes before and ${host.bufferAfterMinutes} minutes after.`,
  ];

  if (input.requesterBusy) sentences.push("Free on the requester's connected calendar.");

  if (host.weeklyLimit !== null) {
    sentences.push(
      entry.belowLimit
        ? `That week has ${entry.weekCount} of your ${host.weeklyLimit} weekly meetings.`
        : `That week already has ${entry.weekCount} meetings, at or over your limit of ${host.weeklyLimit}, so it comes after weeks below the limit.`,
    );
  }

  if (mode === "in_person") {
    const hostLegs = legs.filter((leg) => leg.party === "host");
    if (hostLegs.length === 0) sentences.push("No commitment that day needs a trip checked.");
    for (const leg of legs) sentences.push(legSentence(leg, host));
  }

  return sentences;
}

export function candidateId(start: number, end: number) {
  return `c${start / MINUTE}-${(end - start) / MINUTE}`;
}

// Runs the engine over the inputs. Candidates whose legs are all known and fit
// are offered; one with an unresolved requester leg is held back for the
// requester's allowance; one with an unresolved host leg stays host-private;
// one with a leg that does not fit is excluded.
export function evaluateFeasibility(input: FeasibilityInput): FeasibilityResult {
  const planned = plan(input);
  const candidates: EvaluatedCandidate[] = [];
  const { exclusions, exclusionCounts } = planned;

  for (const entry of planned.planned) {
    const legs = entry.legs.map((leg) => resolveLeg(input, entry, leg));
    const hostLegs = legs.filter((leg) => leg.party === "host");
    const requesterLegs = legs.filter((leg) => leg.party === "requester");
    const start = new Date(entry.start).toISOString();
    const end = new Date(entry.end).toISOString();

    if (hostLegs.some((leg) => leg.status === "too_long")) {
      exclusionCounts.host_travel += 1;
      if (exclusions.length < MAX_EXCLUSIONS) {
        const leg = hostLegs.find((candidate) => candidate.status === "too_long")!;
        exclusions.push({ end, explanation: legSentence(leg, input.host), reason: "host_travel", start });
      }
      continue;
    }

    if (requesterLegs.some((leg) => leg.status === "too_long")) {
      exclusionCounts.requester_unavailable += 1;
      if (exclusions.length < MAX_EXCLUSIONS) {
        exclusions.push({ end, explanation: "The requester is not available then.", reason: "requester_unavailable", start });
      }
      continue;
    }

    const status: CandidateStatus = hostLegs.some((leg) => leg.status === "unresolved")
      ? "host_unresolved"
      : requesterLegs.some((leg) => leg.status === "unresolved")
        ? "requester_unresolved"
        : "offered";

    candidates.push({
      basis: basisFor(input, entry, planned.mode!, legs),
      belowWeeklyLimit: entry.belowLimit,
      durationMinutes: input.request.durationMinutes,
      end,
      id: candidateId(entry.start, entry.end),
      legs,
      linkPlan: planned.linkPlan,
      location: planned.mode === "in_person" ? (input.request.location?.text ?? null) : null,
      mode: planned.mode!,
      start,
      status,
      weekCount: entry.weekCount,
      weekStart: entry.weekStart,
    });
  }

  return {
    candidates,
    exclusionCounts,
    exclusions,
    linkPlan: planned.linkPlan,
    mode: planned.mode,
    unresolvedWindows: planned.unresolvedWindows,
  };
}

// Reorders candidates by a validated ranking: the ranked IDs first in the
// ranking's order, then every other candidate in its deterministic place.
export function applyRanking(candidates: readonly EvaluatedCandidate[], ranking: readonly string[] | null) {
  if (!ranking) return [...candidates];

  const position = new Map(ranking.map((id, index) => [id, index]));
  const ranked = candidates.filter((candidate) => position.has(candidate.id));
  ranked.sort((a, b) => position.get(a.id)! - position.get(b.id)!);

  return [...ranked, ...candidates.filter((candidate) => !position.has(candidate.id))];
}

// What the requester audience may see: instants, display times, duration, mode
// and location plan, and which of their own trips needs an allowance. Host-only
// candidates, every rule, buffer, estimate and event detail stay out.
export function requesterProjection(
  candidates: readonly EvaluatedCandidate[],
  options: { readonly id: string; readonly state: EvaluationState; readonly displayTimezone: string },
): RequesterEvaluation {
  const visible = candidates.filter((candidate) => candidate.status !== "host_unresolved");
  const ordered = [
    ...visible.filter((candidate) => candidate.status === "offered"),
    ...visible.filter((candidate) => candidate.status === "requester_unresolved"),
  ];

  return {
    candidates: ordered.map(
      (candidate): RequesterCandidate => ({
        displayTimezone: options.displayTimezone,
        durationMinutes: candidate.durationMinutes,
        end: candidate.end,
        id: candidate.id,
        linkPlan: candidate.linkPlan,
        location: candidate.location,
        mode: candidate.mode,
        start: candidate.start,
        unresolvedRequesterLeg:
          candidate.status === "requester_unresolved"
            ? (candidate.legs.find((leg) => leg.party === "requester" && leg.status === "unresolved")?.direction ?? null)
            : null,
      }),
    ),
    id: options.id,
    state: options.state,
  };
}

// A display line with the date-specific offset, such as "Mon 3 Nov, 10:00 GMT+9".
export function displayTime(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "short",
      timeZone,
      timeZoneName: "shortOffset",
      weekday: "short",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );

  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}

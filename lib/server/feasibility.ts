import type { LinkPlan, RequesterCandidate, RequesterEvaluation, RequesterTravelMode, EvaluationState } from "../contracts/request";
import {
  endsNextDay,
  type MeetingMode,
  type noteExclusionSchema,
  type TravelMode,
  WEEKDAYS,
  type WeeklyLimitCount,
  type WeeklyWindow,
  type Weekday,
} from "../contracts/setup";
import type { z } from "zod";
import type { CalendarEvent } from "./google-calendar";
import { exclusionAnswer, noteAnswerMatcher } from "./note-answers";

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
//   4. orders weeks below the weekly limit first (a preference, never a filter),
//      counting the host's Find Me a Time bookings in each week, and other
//      meetings with guests too when the host chose to count every meeting;
//   5. with the host's same-day trip preference, for an in-person meeting far
//      from the preferred area, orders days already out that way first and days
//      spent in the preferred area last (same-day-trips design 2 and 3);
//   6. for in-person candidates, checks both host travel legs and, with a
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
// The same-day trip preference: a meeting place beyond TRIP_FAR_MINUTES of the
// preferred area is far, and a commitment within TRIP_NEAR_MINUTES of a place
// is near it. At most TRIP_COMMITMENT_LIMIT commitments, whole days earliest
// first, are estimated, which bounds the extra Routes calls.
export const TRIP_FAR_MINUTES = 30;
export const TRIP_NEAR_MINUTES = 15;
export const TRIP_COMMITMENT_LIMIT = 16;

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
  // A meeting with guests that Find Me a Time did not book. It fills its week
  // toward the weekly limit only when the host counts every meeting; bookings
  // count through FeasibilityInput.bookedStarts instead.
  readonly meeting: boolean;
  readonly endpoint: Endpoint;
};

export type NoteExclusion = z.infer<typeof noteExclusionSchema>;

export type NormalizeOptions = {
  readonly timezone: string;
  // The calendar owner's address, for declined invitations when Google omits `self`.
  readonly selfEmail: string | null;
  readonly noteExclusions?: readonly NoteExclusion[];
  // The provider event IDs of Find Me a Time bookings, whose calendar copies are
  // busy time but not other meetings.
  readonly bookedEventIds?: ReadonlySet<string>;
  // The keyed hash of a location text.
  readonly endpointKey: (text: string) => string;
};

function identity(event: CalendarEvent) {
  if (!event.iCalUID) return `id:${event.id}`;
  const start = event.start.dateTime ? new Date(event.start.dateTime).toISOString() : (event.start.date ?? "");
  return `uid:${event.iCalUID}|${start}`;
}

// The attendees besides the calendar owner who did not decline. A busy, timed
// event with any is a counted meeting (host-onboarding design 8): setup infers
// the weekly limit from counted meetings, and a host who counts every meeting
// fills each week with the same ones, so all-day events, timetables, routines
// and focus blocks block time without filling a week.
export function meetingGuests(event: CalendarEvent, ownerEmail: string | null) {
  const owner = ownerEmail?.trim().toLowerCase() ?? null;
  return event.attendees.filter(
    (attendee) => !attendee.self && attendee.email.toLowerCase() !== owner && attendee.responseStatus !== "declined",
  );
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
// their local dates in the given zone; timed events with a guest who did not
// decline, other than the host's bookings, marked as meetings.
export function normalizeBusy(events: readonly CalendarEvent[], options: NormalizeOptions): BusyInterval[] {
  const self = options.selfEmail?.trim().toLowerCase() ?? null;
  const excluded = noteAnswerMatcher((options.noteExclusions ?? []).map(exclusionAnswer));
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
    if (excluded(event)) continue;

    const key = identity(event);
    if (seen.has(key)) continue;
    seen.add(key);

    if (event.start.dateTime && event.end.dateTime) {
      const start = Date.parse(event.start.dateTime);
      const end = Date.parse(event.end.dateTime);
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
      busy.push({
        allDay: false,
        end,
        endpoint: endpointOf(event, options.endpointKey),
        meeting: !options.bookedEventIds?.has(event.id) && meetingGuests(event, self).length > 0,
        start,
      });
    } else if (event.start.date && event.end.date) {
      const start = startOfLocalDay(event.start.date, options.timezone);
      const end = startOfLocalDay(event.end.date, options.timezone);
      if (end <= start) continue;
      busy.push({ allDay: true, end, endpoint: { kind: "unknown", reason: "no_location" }, meeting: false, start });
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
  readonly weeklyLimitCounts: WeeklyLimitCount;
  readonly meetingMode: MeetingMode;
  readonly travelMode: TravelMode | null;
  readonly travelBufferMinutes: number | null;
  // The preferred area, keyed like event places, when the host groups trips by
  // day; null or absent leaves the order without the trip rank.
  readonly preferredArea?: { readonly text: string; readonly key: string } | null;
};

export type RequestTerms = {
  readonly durationMinutes: number;
  readonly mode: MeetingMode | null;
  // The in-person meeting place, keyed like event places.
  readonly location: { readonly text: string; readonly key: string } | null;
  readonly linkPlan: LinkPlan | null;
  readonly windows: readonly { readonly start: Date; readonly end: Date }[];
  // The windows are the default search range, not the requester's own: keep
  // candidates spread across its days (guest-flow-completion U9).
  readonly spreadDays?: boolean;
  readonly preferredWindows?: readonly { readonly start: Date; readonly end: Date }[];
  readonly lessPreferredWindows?: readonly { readonly start: Date; readonly end: Date }[];
  readonly preferredWeeklyWindows?: readonly WeeklyWindow[];
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
  // The starts of the host's live Find Me a Time bookings for other requests;
  // each fills its week toward the weekly limit.
  readonly bookedStarts?: readonly number[];
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
  // Ordered: weeks below the weekly limit first, then the trip rank, then by start.
  readonly candidates: readonly EvaluatedCandidate[];
  readonly exclusions: readonly Exclusion[];
  readonly exclusionCounts: Readonly<Record<ExclusionReason, number>>;
  readonly unresolvedWindows: readonly UnresolvedWindow[];
};

// ---------------------------------------------------------------------------
// The engine

type Window = { readonly start: number; readonly end: number; readonly date: string; readonly rule: WeeklyWindow };

function hostWindows(host: Pick<HostRules, "timezone" | "weeklyWindows">, requested: readonly { start: Date; end: Date }[], unresolved: UnresolvedWindow[]): Window[] {
  const { timezone, weeklyWindows } = host;
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

// All host-only preview intervals, without requester travel or the ranked candidate cap.
export function hostPreviewIntervals(
  host: Pick<HostRules, "timezone" | "weeklyWindows" | "bufferBeforeMinutes" | "bufferAfterMinutes">,
  busy: readonly BusyInterval[], range: { start: Date; end: Date }, durationMinutes: number,
) {
  const grid = GRID_MINUTES * MINUTE;
  const duration = durationMinutes * MINUTE;
  const intervals: { start: number; end: number }[] = [];
  for (const window of hostWindows(host, [range], [])) {
    const from = Math.max(window.start, range.start.getTime());
    const until = Math.min(window.end, range.end.getTime());
    for (let start = Math.ceil(from / grid) * grid; start + duration <= until; start += grid) {
      if (!overlaps(busy, start - host.bufferBeforeMinutes * MINUTE, start + duration + host.bufferAfterMinutes * MINUTE)) {
        intervals.push({ start, end: start + duration });
      }
    }
  }
  intervals.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
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

// How a candidate's day stands for a far meeting place: already out that way
// (a commitment near the place), spent in the preferred area, or neither.
type TripDay = {
  readonly rank: "out_that_way" | "neutral" | "preferred_area";
  readonly farMinutes: number;
  readonly nearMinutes: number | null;
};

type Planned = {
  readonly start: number;
  readonly end: number;
  readonly window: Window;
  readonly weekStart: string;
  readonly weekCount: number;
  readonly belowLimit: boolean;
  readonly trip: TripDay | null;
  readonly legs: readonly LegPlan[];
};

type Plan = {
  readonly mode: "online" | "in_person" | null;
  readonly linkPlan: LinkPlan | null;
  readonly planned: readonly Planned[];
  readonly tripQueries: readonly LegQuery[];
  readonly exclusions: Exclusion[];
  readonly exclusionCounts: Record<ExclusionReason, number>;
  readonly unresolvedWindows: readonly UnresolvedWindow[];
};

function endpointOfLocation(location: RequestTerms["location"]): Endpoint | null {
  return location ? { key: location.key, kind: "place", text: location.text } : null;
}

function routeModeOf(mode: TravelMode | RequesterTravelMode | null): RouteMode | null {
  return mode === "driving" || mode === "transit" || mode === "walking" ? mode : null;
}

function tripQuery(origin: Endpoint, destination: Endpoint, departure: number, mode: RouteMode): LegQuery | null {
  if (origin.kind !== "place" || destination.kind !== "place" || origin.key === destination.key) return null;
  return {
    departure: new Date(departure),
    destination: destination.text,
    destinationKey: destination.key,
    mode,
    origin: origin.text,
    originKey: origin.key,
  };
}

// The trip rank of each candidate day (same-day-trips design 2), and the
// estimates it needs. A day whose estimates are missing keeps the middle rank,
// and with the meeting place not far, or its estimate missing, no day is ranked.
function tripDays(
  input: FeasibilityInput,
  mode: "online" | "in_person",
  free: readonly { readonly start: number }[],
): { readonly queries: LegQuery[]; readonly dayOf: (start: number) => TripDay | null } {
  const none = { dayOf: () => null, queries: [] };
  const { host } = input;
  const area = host.preferredArea ? endpointOfLocation(host.preferredArea)! : null;
  const meeting = endpointOfLocation(input.request.location);
  const routeMode = routeModeOf(host.travelMode);
  if (mode !== "in_person" || !area || !meeting || !routeMode || placeKey(meeting) === placeKey(area) || free.length === 0) return none;

  const dateOf = (instant: number) => localParts(instant, host.timezone).date;
  const days = new Set(free.map((entry) => dateOf(entry.start)));
  const byDay = new Map<string, BusyInterval[]>();
  for (const interval of [...input.hostBusy].sort((a, b) => a.start - b.start)) {
    if (interval.allDay || interval.endpoint.kind !== "place") continue;
    const date = dateOf(interval.start);
    if (!days.has(date)) continue;
    byDay.set(date, [...(byDay.get(date) ?? []), interval]);
  }

  // Whole days only, so a day is never judged on part of its commitments.
  const counted = new Map<string, BusyInterval[]>();
  let total = 0;
  for (const [date, commitments] of byDay) {
    if (total + commitments.length > TRIP_COMMITMENT_LIMIT) break;
    counted.set(date, commitments);
    total += commitments.length;
  }

  const queries: LegQuery[] = [];
  const minutes = (query: LegQuery | null) => {
    if (!query) return 0;
    queries.push(query);
    const outcome = input.estimate?.(query);
    return outcome?.outcome === "route" ? Math.ceil(outcome.durationSeconds / 60) : undefined;
  };

  const far = minutes(tripQuery(area, meeting, free[0]!.start, routeMode));
  const judged = new Map<string, { near: number | null; inArea: boolean }>();
  for (const [date, commitments] of counted) {
    let near: number | null = null;
    let inArea = true;
    for (const commitment of commitments) {
      const toMeeting = minutes(tripQuery(commitment.endpoint, meeting, commitment.end, routeMode));
      const toArea = minutes(tripQuery(commitment.endpoint, area, commitment.end, routeMode));
      if (toMeeting !== undefined && toMeeting <= TRIP_NEAR_MINUTES) near = Math.min(near ?? toMeeting, toMeeting);
      if (toArea === undefined || toArea > TRIP_NEAR_MINUTES) inArea = false;
    }
    judged.set(date, { inArea, near });
  }

  if (far === undefined || far <= TRIP_FAR_MINUTES) return { dayOf: () => null, queries };

  return {
    dayOf: (start) => {
      const day = judged.get(dateOf(start));
      if (day?.near != null) return { farMinutes: far, nearMinutes: day.near, rank: "out_that_way" };
      if (day?.inArea) return { farMinutes: far, nearMinutes: null, rank: "preferred_area" };
      return { farMinutes: far, nearMinutes: null, rank: "neutral" };
    },
    queries,
  };
}

function tripScore(entry: { readonly trip: TripDay | null }) {
  return entry.trip?.rank === "out_that_way" ? 1 : entry.trip?.rank === "preferred_area" ? -1 : 0;
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
  const routeMode = routeModeOf(mode);
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
    return { exclusionCounts, exclusions, linkPlan, mode, planned: [], tripQueries: [], unresolvedWindows };
  }

  const before = host.bufferBeforeMinutes * MINUTE;
  const after = host.bufferAfterMinutes * MINUTE;
  const grid = GRID_MINUTES * MINUTE;
  const seen = new Set<number>();
  const intervals: { start: number; end: number; window: Window }[] = [];

  // Every zone in use today has an offset that is a whole number of quarter
  // hours, so a start on the UTC quarter-hour grid is on the local one too.
  for (const window of hostWindows(input.host, input.request.windows, unresolvedWindows)) {
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

  // Each week's load: the host's bookings, plus the other meetings with guests
  // when the host counts every meeting.
  const counted = [
    ...(input.bookedStarts ?? []),
    ...(host.weeklyLimitCounts === "all_meetings"
      ? input.hostBusy.filter((interval) => interval.meeting).map((interval) => interval.start)
      : []),
  ];
  const weekCounts = new Map<string, number>();
  for (const start of counted) {
    const week = weekOf(start, host.timezone);
    weekCounts.set(week, (weekCounts.get(week) ?? 0) + 1);
  }

  const open: Omit<Planned, "legs" | "trip">[] = [];

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
    open.push({
      ...interval,
      belowLimit: host.weeklyLimit === null || weekCount < host.weeklyLimit,
      weekCount,
      weekStart,
    });
  }

  const trips = tripDays(input, mode, open);
  const free = open.map((entry) => ({ ...entry, trip: trips.dayOf(entry.start) }));

  // Weeks below the limit first, then the trip rank; neither removes a
  // candidate. Over the default range, each day's first start comes before any
  // day's second among days of equal rank, so the kept candidates cover the
  // range rather than its first day.
  const dayRank = new Map<number, number>();
  if (request.spreadDays) {
    const perDay = new Map<string, number>();
    for (const entry of free) {
      const day = localParts(entry.start, request.timezone).date;
      dayRank.set(entry.start, perDay.get(day) ?? 0);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
  }
  free.sort(
    (a, b) =>
      Number(b.belowLimit) - Number(a.belowLimit) ||
      tripScore(b) - tripScore(a) ||
      (dayRank.get(a.start) ?? 0) - (dayRank.get(b.start) ?? 0) ||
      a.start - b.start,
  );
  const preferred = request.preferredWindows ?? [];
  const weekly = request.preferredWeeklyWindows ?? [];
  const lessPreferred = request.lessPreferredWindows ?? [];
  const dates = new Set(weekly.length ? free.flatMap((entry) => {
    const date = localParts(entry.start, request.timezone).date;
    return [date, addDays(date, -1)];
  }) : []);
  const recurring: { start: number; end: number }[] = [];
  for (const date of dates) {
    const weekday = WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]!;
    for (const rule of weekly) {
      if (rule.weekday !== weekday) continue;
      const starts = resolveLocalTime(date, rule.start, request.timezone);
      const ends = resolveLocalTime(endsNextDay(rule) ? addDays(date, 1) : date, rule.end, request.timezone);
      if (starts.length === 1 && ends.length === 1 && ends[0]! > starts[0]!) recurring.push({ start: starts[0]!, end: ends[0]! });
    }
  }
  const score = (entry: (typeof free)[number]) =>
    Number(preferred.some((window) => entry.start >= window.start.getTime() && entry.end <= window.end.getTime())) +
    Number(recurring.some((window) => entry.start >= window.start && entry.end <= window.end)) -
    3 * Number(lessPreferred.some((window) => entry.start < window.end.getTime() && entry.end > window.start.getTime()));
  // The host's weekly-limit preference, then their trip preference, outweigh
  // all guest preference signals (score is within [-3, 2]).
  const hostWeight = (entry: (typeof free)[number]) => 20 * Number(entry.belowLimit) + 6 * tripScore(entry);
  const weighted = (entry: (typeof free)[number]) => hostWeight(entry) + score(entry);
  const ranked = [...free].sort((a, b) => weighted(b) - weighted(a));
  const kept = ranked.slice(0, CANDIDATE_LIMIT);
  // Retain some non-preferred alternatives when doing so preserves host priority.
  if (preferred.length || weekly.length || lessPreferred.length) {
    const alternatives = ranked.filter((entry) => score(entry) <= 0 && !kept.includes(entry));
    for (const alternative of alternatives) {
      const replace = kept.findLastIndex((entry) => hostWeight(entry) === hostWeight(alternative) && score(entry) > score(alternative));
      if (replace < 0 || kept.filter((entry) => score(entry) <= score(alternative) && hostWeight(entry) === hostWeight(alternative)).length >= 10) continue;
      kept[replace] = alternative;
    }
    kept.sort((a, b) => weighted(b) - weighted(a));
  }

  if (mode === "online") {
    return {
      exclusionCounts,
      exclusions,
      linkPlan,
      mode,
      planned: kept.map((entry) => ({ ...entry, legs: [] })),
      tripQueries: trips.queries,
      unresolvedWindows,
    };
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

  return { exclusionCounts, exclusions, linkPlan, mode, planned, tripQueries: trips.queries, unresolvedWindows };
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

// The trips the same-day trip rank needs, deduplicated like travelQueries. The
// evaluation estimates them before travelQueries, so the candidates kept for
// the travel check are cut from the ranked order.
export function tripQueries(input: FeasibilityInput): LegQuery[] {
  const queries = new Map<string, LegQuery>();
  for (const query of plan(input).tripQueries) if (!queries.has(legQueryKey(query))) queries.set(legQueryKey(query), query);
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
    const counted = (count: number) =>
      host.weeklyLimitCounts === "bookings"
        ? `Find Me a Time booking${count === 1 ? "" : "s"}`
        : `meeting${count === 1 ? "" : "s"}`;
    sentences.push(
      entry.belowLimit
        ? `That week has ${entry.weekCount} of your ${host.weeklyLimit} weekly ${counted(host.weeklyLimit)}.`
        : `That week already has ${entry.weekCount} ${counted(entry.weekCount)}, at or over your limit of ${host.weeklyLimit}, so it comes after weeks below the limit.`,
    );
  }

  if (mode === "in_person" && entry.trip) {
    const { farMinutes, nearMinutes, rank } = entry.trip;
    sentences.push(
      rank === "out_that_way"
        ? `That day you are already ${nearMinutes} minutes from the meeting place, which is ${farMinutes} minutes from your usual area, so days like it come first.`
        : rank === "preferred_area"
          ? `That day you stay near your usual area, ${farMinutes} minutes from the meeting place, so it comes after days you are already out that way.`
          : `The meeting place is ${farMinutes} minutes from your usual area, so days you are already out that way come first.`,
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

// A display line with the date-specific offset, such as "Mon 3 Nov, 10:00 GMT+9";
// shared with the browser in lib/contracts/timezone.ts.
export { displayTime } from "../contracts/timezone";

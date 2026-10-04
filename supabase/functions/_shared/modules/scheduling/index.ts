import type {
  HostRules,
  MeetingDetails,
  TimeWindow,
} from '../../../../../packages/contracts/index.ts';
import { instant, localParts, SchedulingInputError, timezoneFormatter } from './time.ts';
export { resolveLocalDateTime, SchedulingInputError } from './time.ts';

const MINUTE = 60_000;
const GRID = 15 * MINUTE;
const MAX_SCAN = 10_000;

export interface HostEvent extends TimeWindow {
  id?: string;
  mode?: 'online' | 'in_person';
  location?: string;
  /** Confirmed physical whereabouts, including during a virtual commitment. */
  physicalLocation?: string;
}
export interface PhysicalContext {
  at: string;
  location: string;
}
export interface RouteQuery {
  origin: string;
  destination: string;
  mode: HostRules['travelMode'];
  departureTime: string;
}
export interface TravelCheck extends RouteQuery {
  edge: 'before' | 'after';
  durationMinutes: number;
  bufferMinutes: number;
  gapMinutes: number;
  source?: 'provider' | 'same_location' | 'manual';
  manualAllowanceId?: string;
  confirmedByHostId?: string;
  confirmedAt?: string;
}
export interface TravelAllowanceContext {
  edge: 'before' | 'after';
  rulesVersion: number;
  rules: HostRules;
  slot: TimeWindow;
  meetingMode: MeetingDetails['mode'];
  meetingLocation: string;
  candidatePhysicalLocation: string | null;
  previous: HostEvent | null;
  next: HostEvent | null;
  previousPhysicalContext: PhysicalContext | null;
  nextPhysicalContext: PhysicalContext | null;
  origin: string | null;
  destination: string | null;
  departureTime: string;
  arriveBy: string;
}
/** The application must persist these only after an authenticated, explicit host decision. */
export interface ManualTravelAllowance {
  id: string;
  hostId: string;
  confirmedAt: string;
  durationMinutes: number;
  context: TravelAllowanceContext;
}
export interface SchedulingInput {
  rules: HostRules;
  details: MeetingDetails;
  hostEvents: HostEvent[];
  requesterBusy?: TimeWindow[];
  physicalContext?: PhysicalContext[];
  candidatePhysicalLocation?: string;
  hostId?: string;
  rulesVersion?: number;
  manualTravelAllowances?: ManualTravelAllowance[];
  route?: (query: RouteQuery) => Promise<{ durationMinutes: number } | null>;
  limit?: number;
}
export interface Diagnostic {
  code: string;
  slot?: TimeWindow;
  edge?: 'before' | 'after';
}
export interface SlotEvaluation {
  feasible: boolean;
  unresolved: boolean;
  privateDiagnostics: Diagnostic[];
  privateTravelChecks: TravelCheck[];
}
export interface CandidateEvaluation {
  candidates: TimeWindow[];
  unresolved: boolean;
  privateDiagnostics: Diagnostic[];
  /** Host-only diagnostics; never serialize this object as a requester response. */
  privateTravelChecks: { slot: TimeWindow; checks: TravelCheck[] }[];
}
type Interval = { start: number; end: number };
type ParsedEvent = Interval & Omit<HostEvent, keyof TimeWindow>;
type Parsed = {
  windows: Interval[];
  events: ParsedEvent[];
  busy: Interval[];
  focus: Interval[];
  context: { at: number; location: string }[];
  availability: { days: number[]; start: number; end: number }[];
  formatter: Intl.DateTimeFormat;
};

function interval(window: TimeWindow): Interval {
  const parsed = { start: instant(window.start), end: instant(window.end) };
  if (parsed.end <= parsed.start) {
    throw new SchedulingInputError('invalid_window');
  }
  return parsed;
}
function clock(value: string, allowMidnight = false): number {
  if (allowMidnight && value === '24:00') return 1440;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new SchedulingInputError('invalid_availability');
  }
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}
function prepare(input: SchedulingInput): Parsed {
  const { rules, details } = input;
  const formatter = timezoneFormatter(rules.timezone);
  timezoneFormatter(details.timezone);
  if (
    !Number.isInteger(details.durationMinutes) ||
    details.durationMinutes <= 0 || details.durationMinutes > 1440 ||
    details.durationMinutes !== rules.durationMinutes
  ) throw new SchedulingInputError('invalid_duration');
  if (
    !Number.isInteger(rules.bufferMinutes) || rules.bufferMinutes < 0 ||
    rules.bufferMinutes > 1440
  ) {
    throw new SchedulingInputError('invalid_buffer');
  }
  if (!['DRIVE', 'TRANSIT', 'WALK', 'BICYCLE'].includes(rules.travelMode)) {
    throw new SchedulingInputError('invalid_travel_mode');
  }
  if (!['online', 'in_person'].includes(details.mode)) {
    throw new SchedulingInputError('invalid_meeting_mode');
  }
  if (
    !details.windows.length || details.windows.length > 64 ||
    input.hostEvents.length > 2000 ||
    (input.requesterBusy?.length ?? 0) > 2000 ||
    rules.focusBlocks.length > 2000 || rules.availability.length > 64 ||
    (input.physicalContext?.length ?? 0) > 2000 ||
    (input.manualTravelAllowances?.length ?? 0) > 64
  ) throw new SchedulingInputError('input_limit_exceeded');
  const windows = details.windows.map(interval).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const window of windows) {
    const last = merged.at(-1);
    if (last && window.start <= last.end) {
      last.end = Math.max(last.end, window.end);
    } else merged.push({ ...window });
  }
  if (
    merged.reduce((sum, w) => sum + Math.ceil((w.end - w.start) / GRID), 0) >
      MAX_SCAN
  ) {
    throw new SchedulingInputError('search_window_too_large');
  }
  const availability = rules.availability.map((a) => {
    const start = clock(a.start), end = clock(a.end, true);
    if (
      !a.days.length || a.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
      start === end
    ) {
      throw new SchedulingInputError('invalid_availability');
    }
    return { days: a.days, start, end };
  });
  return {
    windows: merged,
    events: input.hostEvents.map((event) => ({ ...event, ...interval(event) }))
      .sort((a, b) => a.start - b.start),
    busy: (input.requesterBusy ?? []).map(interval),
    focus: rules.focusBlocks.map(interval),
    context: (input.physicalContext ?? []).map((p) => ({
      at: instant(p.at),
      location: p.location.trim(),
    })).sort((a, b) => a.at - b.at),
    availability,
    formatter,
  };
}
function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}
function available(at: number, parsed: Parsed): boolean {
  const p = localParts(at, parsed.formatter);
  const minutes = p.hour * 60 + p.minute;
  return parsed.availability.some((rule) =>
    rule.start < rule.end
      ? rule.days.includes(p.weekday) && minutes >= rule.start &&
        minutes < rule.end
      : (rule.days.includes(p.weekday) && minutes >= rule.start) ||
        (rule.days.includes((p.weekday + 6) % 7) && minutes < rule.end)
  );
}
function physical(event: ParsedEvent | undefined): string | undefined {
  return event?.physicalLocation?.trim() ||
    (event?.mode !== 'online' ? event?.location?.trim() : undefined);
}
function windowOf(slot: Interval): TimeWindow {
  return {
    start: new Date(slot.start).toISOString(),
    end: new Date(slot.end).toISOString(),
  };
}

function travelContext(input: SchedulingInput, parsed: Parsed, slot: Interval) {
  const previous =
    parsed.events.filter((e) => e.end <= slot.start).sort((a, b) => b.end - a.end)[0];
  const next = parsed.events.find((e) => e.start >= slot.end);
  const previousContext = parsed.context.filter((c) =>
    c.at <= slot.start && (!previous || c.at >= previous.end)
  ).at(-1);
  const nextContext = parsed.context.find((c) => c.at >= slot.end && (!next || c.at <= next.start));
  const before = previousContext ??
    (previous ? { at: previous.end, location: physical(previous) ?? '' } : undefined);
  const after = nextContext ??
    (next ? { at: next.start, location: physical(next) ?? '' } : undefined);
  const candidateLocation = input.details.mode === 'in_person'
    ? input.details.location.trim()
    : input.candidatePhysicalLocation?.trim();
  return { previous, next, previousContext, nextContext, before, after, candidateLocation };
}

function eventSnapshot(event: ParsedEvent | undefined): HostEvent | null {
  if (!event) return null;
  return {
    ...windowOf(event),
    ...(event.id ? { id: event.id } : {}),
    ...(event.mode ? { mode: event.mode } : {}),
    ...(event.location ? { location: event.location } : {}),
    ...(event.physicalLocation ? { physicalLocation: event.physicalLocation } : {}),
  };
}

function allowanceContext(
  input: SchedulingInput,
  parsed: Parsed,
  slot: Interval,
  edge: 'before' | 'after',
): TravelAllowanceContext | null {
  const t = travelContext(input, parsed, slot);
  const adjacent = edge === 'before' ? t.before : t.after;
  if (!adjacent || !Number.isInteger(input.rulesVersion) || (input.rulesVersion ?? 0) < 1) {
    return null;
  }
  return {
    edge,
    rulesVersion: input.rulesVersion!,
    rules: structuredClone(input.rules),
    slot: windowOf(slot),
    meetingMode: input.details.mode,
    meetingLocation: input.details.location.trim(),
    candidatePhysicalLocation: input.candidatePhysicalLocation?.trim() || null,
    previous: eventSnapshot(t.previous),
    next: eventSnapshot(t.next),
    previousPhysicalContext: t.previousContext
      ? { at: new Date(t.previousContext.at).toISOString(), location: t.previousContext.location }
      : null,
    nextPhysicalContext: t.nextContext
      ? { at: new Date(t.nextContext.at).toISOString(), location: t.nextContext.location }
      : null,
    origin: (edge === 'before' ? adjacent.location : t.candidateLocation) || null,
    destination: (edge === 'before' ? t.candidateLocation : adjacent.location) || null,
    departureTime: new Date(edge === 'before' ? adjacent.at : slot.end).toISOString(),
    arriveBy: new Date(edge === 'before' ? slot.start : adjacent.at).toISOString(),
  };
}

/** Host-only review snapshot. Never accept a requester-supplied snapshot as a host confirmation. */
export function travelAllowanceContext(
  input: SchedulingInput,
  slot: TimeWindow,
  edge: 'before' | 'after',
): TravelAllowanceContext | null {
  if (edge !== 'before' && edge !== 'after') throw new SchedulingInputError('invalid_travel_edge');
  return allowanceContext(input, prepare(input), interval(slot), edge);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) =>
        `${JSON.stringify(k)}:${canonical(v)}`
      ).join(',')
    }}`;
  }
  return JSON.stringify(value);
}

function manualAllowance(
  input: SchedulingInput,
  context: TravelAllowanceContext | null,
): ManualTravelAllowance | undefined {
  if (!context || !input.hostId) return undefined;
  const matching = input.manualTravelAllowances?.filter((allowance) => {
    try {
      instant(allowance.confirmedAt);
      return !!allowance.id && allowance.hostId === input.hostId &&
        Number.isInteger(allowance.durationMinutes) &&
        allowance.durationMinutes > 0 && allowance.durationMinutes <= 1440 &&
        canonical(allowance.context) === canonical(context);
    } catch {
      return false;
    }
  }) ?? [];
  // Conflicting evidence needs a new unambiguous confirmation, never a convenient minimum.
  return matching.length === 1 ? matching[0] : undefined;
}

async function evaluate(
  input: SchedulingInput,
  parsed: Parsed,
  slot: Interval,
): Promise<SlotEvaluation> {
  const diagnostics: Diagnostic[] = [];
  const trips: TravelCheck[] = [];
  let unresolved = false;
  const sharedSlot = windowOf(slot);
  const reject = (code: string, edge?: 'before' | 'after', unknown = false) => {
    diagnostics.push({ code, slot: sharedSlot, ...(edge ? { edge } : {}) });
    unresolved ||= unknown;
  };
  const expanded = {
    start: slot.start - input.rules.bufferMinutes * MINUTE,
    end: slot.end + input.rules.bufferMinutes * MINUTE,
  };
  if (slot.end - slot.start !== input.details.durationMinutes * MINUTE) {
    reject('invalid_duration');
  }
  if (!parsed.windows.some((w) => slot.start >= w.start && slot.end <= w.end)) {
    reject('outside_requester_window');
  }
  if (parsed.events.some((event) => overlaps(expanded, event))) {
    reject('host_busy_or_buffer');
  }
  if (parsed.focus.some((focus) => overlaps(expanded, focus))) {
    reject('focus_block_or_buffer');
  }
  if (parsed.busy.some((busy) => overlaps(slot, busy))) {
    reject('requester_busy');
  }
  // Check every real minute across transitions, including the end of the interval.
  for (
    let at = expanded.start;
    at < expanded.end;
    at = Math.min(at + MINUTE, expanded.end)
  ) {
    if (!available(at, parsed)) {
      reject('outside_host_availability');
      break;
    }
  }
  if (diagnostics.length) {
    return {
      feasible: false,
      unresolved,
      privateDiagnostics: diagnostics,
      privateTravelChecks: trips,
    };
  }

  const { previous, next, previousContext, nextContext, before, after, candidateLocation } =
    travelContext(input, parsed, slot);
  const needsTravel = input.details.mode === 'in_person' ||
    !!input.candidatePhysicalLocation ||
    !!input.manualTravelAllowances?.length ||
    !!physical(previous) || !!physical(next) || !!previousContext ||
    !!nextContext;
  if (!needsTravel) {
    return {
      feasible: true,
      unresolved: false,
      privateDiagnostics: [],
      privateTravelChecks: [],
    };
  }
  if (!candidateLocation && input.details.mode === 'in_person') {
    reject('candidate_physical_location_unknown', undefined, true);
  }
  if (!before) reject('prior_physical_whereabouts_unknown', 'before', true);
  for (const edge of ['before', 'after'] as const) {
    const adjacent = edge === 'before' ? before : after;
    if (!adjacent) continue;
    const context = allowanceContext(input, parsed, slot, edge);
    const manual = manualAllowance(input, context);
    if (manual && context) {
      const gapMinutes = (instant(context.arriveBy) - instant(context.departureTime)) / MINUTE;
      trips.push({
        edge,
        origin: context.origin ?? 'Unknown physical whereabouts',
        destination: context.destination ?? 'Unknown physical whereabouts',
        mode: input.rules.travelMode,
        departureTime: context.departureTime,
        durationMinutes: manual.durationMinutes,
        bufferMinutes: input.rules.bufferMinutes,
        gapMinutes,
        source: 'manual',
        manualAllowanceId: manual.id,
        confirmedByHostId: manual.hostId,
        confirmedAt: manual.confirmedAt,
      });
      if (gapMinutes < manual.durationMinutes + input.rules.bufferMinutes) {
        reject('insufficient_travel_gap', edge);
      }
      continue;
    }
    if (!adjacent.location) {
      reject('adjacent_physical_location_unknown', edge, true);
      continue;
    }
    if (!candidateLocation) {
      reject('candidate_physical_location_unknown', edge, true);
      continue;
    }
    const query: RouteQuery = {
      origin: edge === 'before' ? adjacent.location : candidateLocation,
      destination: edge === 'before' ? candidateLocation : adjacent.location,
      mode: input.rules.travelMode,
      departureTime: new Date(edge === 'before' ? adjacent.at : slot.end)
        .toISOString(),
    };
    const gapMinutes = (edge === 'before' ? slot.start - adjacent.at : adjacent.at - slot.end) /
      MINUTE;
    let durationMinutes: number;
    // A confirmed identical physical endpoint has no trip; this is not a missing-route fallback.
    if (query.origin === query.destination) durationMinutes = 0;
    else {
      try {
        const route = await input.route?.(query);
        if (
          !route || !Number.isFinite(route.durationMinutes) ||
          route.durationMinutes < 0
        ) {
          reject('route_unavailable', edge, true);
          continue;
        }
        durationMinutes = route.durationMinutes;
      } catch {
        reject('route_provider_failed', edge, true);
        continue;
      }
    }
    trips.push({
      ...query,
      edge,
      durationMinutes,
      bufferMinutes: input.rules.bufferMinutes,
      gapMinutes,
      source: query.origin === query.destination ? 'same_location' : 'provider',
    });
    if (gapMinutes < durationMinutes + input.rules.bufferMinutes) {
      reject('insufficient_travel_gap', edge);
    }
  }
  return {
    feasible: !diagnostics.length,
    unresolved,
    privateDiagnostics: diagnostics,
    privateTravelChecks: trips,
  };
}

/** Deterministic feasibility only. AI may rank the returned public windows afterwards. */
export async function evaluateCandidates(
  input: SchedulingInput,
): Promise<CandidateEvaluation> {
  const result: CandidateEvaluation = {
    candidates: [],
    unresolved: false,
    privateDiagnostics: [],
    privateTravelChecks: [],
  };
  try {
    const parsed = prepare(input);
    let routeCalls = 0;
    const routes = new Map<
      string,
      Promise<{ durationMinutes: number } | null>
    >();
    const boundedInput: SchedulingInput = {
      ...input,
      route: async (query) => {
        const key = JSON.stringify(query);
        const cached = routes.get(key);
        if (cached) return await cached;
        if (!input.route || routeCalls >= 200) return null;
        routeCalls++;
        const pending = input.route(query);
        routes.set(key, pending);
        return await pending;
      },
    };
    const limit = input.limit ?? 24;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new SchedulingInputError('invalid_candidate_limit');
    }
    for (const window of parsed.windows) {
      for (
        let start = Math.ceil(window.start / GRID) * GRID;
        start + input.details.durationMinutes * MINUTE <= window.end;
        start += GRID
      ) {
        const slot = {
          start,
          end: start + input.details.durationMinutes * MINUTE,
        };
        const evaluated = await evaluate(boundedInput, parsed, slot);
        result.unresolved ||= evaluated.unresolved;
        result.privateDiagnostics.push(...evaluated.privateDiagnostics);
        if (evaluated.feasible) {
          const sharedSlot = windowOf(slot);
          result.candidates.push(sharedSlot);
          if (evaluated.privateTravelChecks.length) {
            result.privateTravelChecks.push({
              slot: sharedSlot,
              checks: evaluated.privateTravelChecks,
            });
          }
          if (result.candidates.length >= limit) return result;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof SchedulingInputError)) throw error;
    result.unresolved = true;
    result.privateDiagnostics.push({ code: error.code });
  }
  return result;
}

/** Re-evaluate the precise current proposal with freshly read calendar context. */
export async function evaluateSlot(
  input: SchedulingInput,
  slot: TimeWindow,
): Promise<SlotEvaluation> {
  try {
    return await evaluate(input, prepare(input), interval(slot));
  } catch (error) {
    if (!(error instanceof SchedulingInputError)) throw error;
    return {
      feasible: false,
      unresolved: true,
      privateDiagnostics: [{ code: error.code }],
      privateTravelChecks: [],
    };
  }
}

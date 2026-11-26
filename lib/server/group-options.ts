import type { RequesterTravelMode } from "../contracts/request";
import {
  type BusyInterval,
  type EvaluatedCandidate,
  evaluateFeasibility,
  type FeasibilityInput,
  type HostRules,
  type LegQuery,
  legQueryKey,
  localParts,
  type RouteOutcome,
  spreadOrder,
  travelQueries,
  tripQueries,
} from "./feasibility";

// The options of a closed group meeting (group-scheduling design 5): times in
// the group's range that fit the host and every done participant under the
// feasibility rules, each with a place everyone's travel legs reach, or online.
// The engine checks one guest at a time, so the search runs it once for the
// host alone, then once per participant over the host's candidates, with that
// participant's confirmed unavailable times (and their places) as their busy
// time, their usual place standing in for an event without one, and their own
// travel mode. Participant calendars are never read here (D11).
//
// In person, place candidates come in tiers (D16): the host's venue and areas,
// then the participants' usual places, then a station between their places; a
// later tier is searched only while the earlier ones give fewer than
// OPTIONS_SHOWN options that fit everyone. Online options join when the
// in-person ones that fit everyone are still fewer. Options that fit everyone
// come first, by tier, then by how many participants' preferred hours they fall
// in, spread across the range, one place per time; when none fits everyone,
// the options are those that fit the most participants (D5).
//
// The engine keeps at most CANDIDATE_LIMIT of the host's candidates, spread
// across the range, so over a long range the few times that fit everyone could
// be cut before any participant is checked. The search therefore first looks
// only within the times no participant is busy (ignoring travel, which the
// engine then checks), and searches the whole range again only when nothing
// fits everyone there.

export const OPTIONS_SHOWN = 3;
export const OPTIONS_KEPT = 30;
export const PLACE_TIER_LIMIT = 6;

export type PlaceRef = { readonly text: string; readonly key: string };

export type GroupParticipantInput = {
  readonly requestId: string;
  readonly timezone: string;
  readonly busy: readonly BusyInterval[];
  readonly usualPlace: PlaceRef | null;
  readonly travelMode: RequesterTravelMode | null;
  readonly preferredHours: readonly { readonly start: string; readonly end: string }[];
};

export type GroupSearch = {
  readonly now: Date;
  readonly host: HostRules;
  readonly hostBusy: readonly BusyInterval[];
  readonly bookedStarts: readonly number[];
  readonly hostPlaces: readonly PlaceRef[];
  readonly durationMinutes: number;
  readonly range: { readonly start: Date; readonly end: Date };
  readonly timezone: string;
  // Whether the booking destination can create Google Meet; online options need it.
  readonly meetAvailable: boolean;
  readonly participants: readonly GroupParticipantInput[];
};

export type GroupOption = {
  readonly start: Date;
  readonly end: Date;
  readonly mode: "in_person" | "online";
  readonly place: string | null;
  // The done participants who cannot make it.
  readonly missing: readonly string[];
};

export type Estimator = (queries: readonly LegQuery[]) => Promise<ReadonlyMap<string, RouteOutcome>>;
// A station between the given places, or null (place-lookup.ts).
export type BetweenLookup = (places: readonly string[]) => Promise<string | null>;

type Found = {
  readonly start: number;
  readonly end: number;
  readonly mode: "in_person" | "online";
  readonly place: PlaceRef | null;
  readonly tier: number;
  readonly missing: readonly string[];
  readonly preferred: number;
};

function baseInput(search: GroupSearch, mode: "in_person" | "online", places: readonly PlaceRef[], windows: FeasibilityInput["request"]["windows"]): FeasibilityInput {
  return {
    allowances: [],
    bookedStarts: search.bookedStarts,
    host: search.host,
    hostBusy: search.hostBusy,
    meetAvailable: search.meetAvailable,
    now: search.now,
    request: {
      durationMinutes: search.durationMinutes,
      linkPlan: mode === "online" ? { kind: "google_meet" } : null,
      location: null,
      mode,
      places,
      timezone: search.timezone,
      travelMode: null,
      windows,
    },
    requesterBusy: null,
  };
}

// The engine's result with every leg it needs estimated first, as an evaluation does.
async function evaluated(input: FeasibilityInput, estimate: Estimator) {
  const trips = await estimate(tripQueries(input));
  const lookup = (more: ReadonlyMap<string, RouteOutcome>) => (query: LegQuery) => more.get(legQueryKey(query)) ?? trips.get(legQueryKey(query));
  const legs = await estimate(travelQueries({ ...input, estimate: lookup(new Map()) }).filter((query) => !trips.has(legQueryKey(query))));
  return evaluateFeasibility({ ...input, estimate: lookup(legs) });
}

function key(start: number, place: string | null) {
  return `${start}|${place ?? ""}`;
}

function inPreferredHours(participant: GroupParticipantInput, start: number, end: number) {
  if (participant.preferredHours.length === 0) return false;
  const from = localParts(start, participant.timezone);
  const until = localParts(end, participant.timezone);
  if (from.date !== until.date && until.minute !== 0) return false;
  const last = until.minute === 0 && from.date !== until.date ? 24 * 60 : until.minute;
  return participant.preferredHours.some((window) => {
    const [startHour, startMinute] = window.start.split(":").map(Number) as [number, number];
    const [endHour, endMinute] = window.end.split(":").map(Number) as [number, number];
    const open = startHour * 60 + startMinute;
    const close = endHour * 60 + endMinute || 24 * 60;
    return from.minute >= open && last <= close;
  });
}

// One mode over one set of places: the host's candidates, and for each the
// participants it does not fit.
type Windows = FeasibilityInput["request"]["windows"];

async function searchTier(
  search: GroupSearch,
  mode: "in_person" | "online",
  places: readonly PlaceRef[],
  tier: number,
  estimate: Estimator,
  windows: Windows,
): Promise<Found[]> {
  const host = await evaluated(baseInput(search, mode, places, windows), estimate);
  const candidates = host.candidates;
  if (candidates.length === 0) return [];

  const fits = new Map<string, Set<string>>();
  const groups = mode === "online" ? [{ candidates, place: null as PlaceRef | null }] : places.map((place) => ({ candidates: candidates.filter((candidate) => candidate.location === place.text), place }));

  for (const participant of search.participants) {
    const fit = new Set<string>();
    for (const group of groups) {
      if (group.candidates.length === 0) continue;
      const windows = group.candidates.map((candidate) => ({ end: new Date(candidate.end), start: new Date(candidate.start) }));
      const base = baseInput(search, mode, group.place ? [group.place] : [], windows);
      const input: FeasibilityInput = {
        ...base,
        request: { ...base.request, timezone: participant.timezone, travelMode: participant.travelMode },
        requesterBusy: participant.busy,
        requesterPreferences: participant.usualPlace
          ? { timezone: participant.timezone, usualPlace: participant.usualPlace, weekCounts: {}, weeklyLimit: null, weeklyWindows: [] }
          : null,
      };
      for (const candidate of (await evaluated(input, estimate)).candidates) fit.add(key(Date.parse(candidate.start), candidate.location));
    }
    fits.set(participant.requestId, fit);
  }

  return candidates.map((candidate: EvaluatedCandidate) => {
    const start = Date.parse(candidate.start);
    const end = Date.parse(candidate.end);
    const place = mode === "in_person" ? (places.find((entry) => entry.text === candidate.location) ?? null) : null;
    return {
      end,
      missing: search.participants.filter((participant) => !fits.get(participant.requestId)?.has(key(start, candidate.location))).map((participant) => participant.requestId),
      mode,
      place,
      preferred: search.participants.filter((participant) => inPreferredHours(participant, start, end)).length,
      start,
      tier,
    };
  });
}

function distinctPlaces(texts: readonly (string | null)[], hash: (text: string) => string, taken: ReadonlySet<string>) {
  const seen = new Set(taken);
  const places: PlaceRef[] = [];
  for (const text of texts) {
    const trimmed = text?.trim();
    if (!trimmed) continue;
    const placeKey = hash(trimmed);
    if (seen.has(placeKey)) continue;
    seen.add(placeKey);
    places.push({ key: placeKey, text: trimmed });
  }
  return places.slice(0, PLACE_TIER_LIMIT);
}

// The parts of the range in which no participant has a confirmed busy time.
export function commonFree(search: Pick<GroupSearch, "range" | "participants">): { start: Date; end: Date }[] {
  const busy = search.participants.flatMap((participant) => participant.busy).toSorted((a, b) => a.start - b.start);
  const free: { start: Date; end: Date }[] = [];
  let cursor = search.range.start.getTime();
  const end = search.range.end.getTime();
  for (const interval of busy) {
    if (interval.start > cursor) free.push({ end: new Date(Math.min(interval.start, end)), start: new Date(cursor) });
    cursor = Math.max(cursor, interval.end);
    if (cursor >= end) break;
  }
  if (cursor < end) free.push({ end: new Date(end), start: new Date(cursor) });
  return free.filter((window) => window.end > window.start);
}

type Providers = { readonly estimate: Estimator; readonly between: BetweenLookup; readonly hash: (text: string) => string };

const fitsEveryone = (entry: Found) => entry.missing.length === 0;

// The tiers in order over the given windows, each only while fewer than
// OPTIONS_SHOWN distinct times fit everyone.
async function collect(search: GroupSearch, providers: Providers, windows: Windows): Promise<Found[]> {
  const found: Found[] = [];
  const fullCount = () => new Set(found.filter(fitsEveryone).map((entry) => entry.start)).size;
  const inPerson = search.host.meetingMode !== "online";
  const online = search.host.meetingMode !== "in_person" && search.meetAvailable;

  if (inPerson) {
    const taken = new Set<string>();
    const tiers: (() => Promise<PlaceRef[]>)[] = [
      async () => [...search.hostPlaces],
      async () => distinctPlaces(search.participants.map((participant) => participant.usualPlace?.text ?? null), providers.hash, taken),
      async () => {
        const places = search.participants.map((participant) => participant.usualPlace?.text).filter((text): text is string => Boolean(text));
        const between = await providers.between(places);
        return between ? distinctPlaces([between], providers.hash, taken) : [];
      },
    ];
    for (const [tier, places] of tiers.entries()) {
      if (fullCount() >= OPTIONS_SHOWN) break;
      const tierPlaces = await places();
      for (const place of tierPlaces) taken.add(place.key);
      if (tierPlaces.length > 0) found.push(...(await searchTier(search, "in_person", tierPlaces, tier, providers.estimate, windows)));
    }
  }
  if (online && fullCount() < OPTIONS_SHOWN) found.push(...(await searchTier(search, "online", [], 3, providers.estimate, windows)));
  return found;
}

export async function findGroupOptions(search: GroupSearch, providers: Providers): Promise<GroupOption[]> {
  const free = commonFree(search);
  let found = free.length > 0 ? await collect(search, providers, free) : [];
  if (!found.some(fitsEveryone)) found = await collect(search, providers, [search.range]);

  const full = found.filter(fitsEveryone);
  const chosen = full.length > 0 ? full : found;
  const rank = (entry: Found) => (full.length > 0 ? 0 : entry.missing.length) * 1000 + entry.tier * 100 - entry.preferred;
  const ordered = spreadOrder(
    [...chosen].sort((a, b) => rank(a) - rank(b) || a.start - b.start || (a.place?.text ?? "").localeCompare(b.place?.text ?? "")),
    { start: (entry) => entry.start, tier: (entry) => -rank(entry), timezone: search.timezone },
  );

  // One place per time: the first in tier order.
  const times = new Set<number>();
  const unique = ordered.filter((entry) => !times.has(entry.start) && times.add(entry.start));

  return unique.slice(0, OPTIONS_KEPT).map((entry) => ({
    end: new Date(entry.end),
    missing: entry.missing,
    mode: entry.mode,
    place: entry.place?.text ?? null,
    start: new Date(entry.start),
  }));
}

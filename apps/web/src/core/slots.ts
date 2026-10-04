import type { BusyInterval, TravelAnchor } from "./calendar"
import { normalizeWindows } from "./profile"
import { fitsRules } from "./availability"
import { isOffline, travelMinutes } from "./travel"
import {
  DAY_MS,
  HORIZON_DAYS,
  HOUR_MS,
  MIN_LEAD_HOURS,
  MIN_MS,
  SLOT_STEP_MIN,
  kstDayStart,
} from "./time"
import type { MeetingType, Person, Place, Role, Slot } from "./types"

const SLACK_CAP_MS = 120 * MIN_MS

interface Index {
  role: Role
  rules: Person["rules"]
  byStart: BusyInterval[]
  /** prefixMaxEnd[i] = max end among byStart[0..i]. */
  prefixMaxEnd: number[]
  byEnd: BusyInterval[]
  offlineByEnd: TravelAnchor[]
  offlineByStart: TravelAnchor[]
}

function buildIndex(person: Person, role: Role): Index {
  const busy = person.busyIntervals ?? person.events
  const anchors = (person.travelAnchors ?? person.events).filter(isOffline)
  const byStart = [...busy].sort((a, b) => a.startMs - b.startMs)
  const prefixMaxEnd: number[] = []
  let max = -Infinity
  for (const e of byStart) {
    max = Math.max(max, e.endMs)
    prefixMaxEnd.push(max)
  }
  const byEnd = [...busy].sort((a, b) => a.endMs - b.endMs)
  return {
    role,
    rules: person.windows === undefined ? person.rules : normalizeWindows(person.windows).map(w => ({ ...w, enabled: true })),
    byStart,
    prefixMaxEnd,
    byEnd,
    offlineByEnd: [...anchors].sort((a, b) => a.endMs - b.endMs),
    offlineByStart: [...anchors].sort((a, b) => a.startMs - b.startMs),
  }
}

/** Number of items whose key is < limit, for a list sorted ascending by key. */
function countBelow<T>(list: T[], key: (t: T) => number, limit: number): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (key(list[mid]) < limit) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Number of items whose key is <= limit. */
function countAtMost<T>(list: T[], key: (t: T) => number, limit: number): number {
  return countBelow(list, key, limit + 1)
}

function overlaps(idx: Index, startMs: number, endMs: number): boolean {
  const i = countBelow(idx.byStart, (e) => e.startMs, endMs)
  return i > 0 && idx.prefixMaxEnd[i - 1] > startMs
}

/** Latest event (by end) that ends at or before `ms`, optionally offline only. */
function prevEvent(idx: Index, ms: number, offlineOnly: true): TravelAnchor | null
function prevEvent(idx: Index, ms: number, offlineOnly: false): BusyInterval | null
function prevEvent(idx: Index, ms: number, offlineOnly: boolean): BusyInterval | null {
  const list = offlineOnly ? idx.offlineByEnd : idx.byEnd
  const i = countAtMost(list, (e) => e.endMs, ms)
  return i > 0 ? list[i - 1] : null
}

/** Earliest event (by start) that starts at or after `ms`. */
function nextEvent(idx: Index, ms: number, offlineOnly: true): TravelAnchor | null
function nextEvent(idx: Index, ms: number, offlineOnly: false): BusyInterval | null
function nextEvent(idx: Index, ms: number, offlineOnly: boolean): BusyInterval | null {
  const list = offlineOnly ? idx.offlineByStart : idx.byStart
  const i = countBelow(list, (e) => e.startMs, ms)
  return i < list.length ? list[i] : null
}

/** Returns exact spare milliseconds (>= 0) if the person can attend, or null if not. */
function personSlack(idx: Index, place: Place, startMs: number, endMs: number): number | null {
  if (!fitsRules(idx.rules, startMs, endMs)) return null
  if (overlaps(idx, startMs, endMs)) return null

  let slack = SLACK_CAP_MS

  const prevOff = prevEvent(idx, startMs, true)
  if (prevOff) {
    const gap = (startMs - prevOff.endMs) - travelMinutes(prevOff, place, idx.role) * MIN_MS
    if (gap < 0) return null
    slack = Math.min(slack, gap)
  }
  const nextOff = nextEvent(idx, endMs, true)
  if (nextOff) {
    const gap = (nextOff.startMs - endMs) - travelMinutes(nextOff, place, idx.role) * MIN_MS
    if (gap < 0) return null
    slack = Math.min(slack, gap)
  }

  // Slack also reflects any neighbouring event, online included: back-to-back meetings feel tight.
  const prev = prevEvent(idx, startMs, false)
  if (prev) slack = Math.min(slack, startMs - prev.endMs)
  const next = nextEvent(idx, endMs, false)
  if (next) slack = Math.min(slack, next.startMs - endMs)

  return Math.max(0, slack)
}

export interface ComputeSlotsInput {
  host: Person
  client: Person
  places: Place[]
  meetingTypes: MeetingType[]
  nowMs: number
  /** Minimum hours between now and the slot start. Defaults to 2; revalidating an existing request uses 0. */
  minLeadHours?: number
}

/** Every (start, place, meeting type) both people can attend, over the next 60 days, sorted by start. */
export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const { places, meetingTypes, nowMs } = input
  if (places.length === 0 || meetingTypes.length === 0) return []

  const host = buildIndex(input.host, "host")
  const client = buildIndex(input.client, "client")
  const firstDay = kstDayStart(nowMs)
  const horizonEnd = firstDay + HORIZON_DAYS * DAY_MS
  const earliest = nowMs + (input.minLeadHours ?? MIN_LEAD_HOURS) * HOUR_MS
  const stepMs = SLOT_STEP_MIN * MIN_MS
  const slots: Slot[] = []

  for (let dayStart = firstDay; dayStart < horizonEnd; dayStart += DAY_MS) {
    for (let t = dayStart; t < dayStart + DAY_MS; t += stepMs) {
      if (t < earliest) continue
      for (const type of meetingTypes) {
        const end = t + type.durationMin * MIN_MS
        if (!Number.isSafeInteger(end) || end <= t || end > horizonEnd) continue
        for (const place of places) {
          const hs = personSlack(host, place, t, end)
          if (hs === null) continue
          const cs = personSlack(client, place, t, end)
          if (cs === null) continue
          slots.push({
            startMs: t,
            endMs: end,
            placeId: place.id,
            meetingTypeId: type.id,
            slackMin: Math.min(hs, cs) / MIN_MS,
            slackMs: Math.min(hs, cs),
          })
        }
      }
    }
  }
  return slots
}

export function sameSlot(a: Pick<Slot, "startMs" | "placeId" | "meetingTypeId">, b: Pick<Slot, "startMs" | "placeId" | "meetingTypeId">): boolean {
  return a.startMs === b.startMs && a.placeId === b.placeId && a.meetingTypeId === b.meetingTypeId
}

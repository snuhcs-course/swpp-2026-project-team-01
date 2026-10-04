import type { CalEvent, LocationKind } from "./types"

export interface BusyInterval { startMs: number; endMs: number }
export interface TravelAnchor extends BusyInterval {
  kind: LocationKind
  placeRef: string | null
}
export interface AllDayRange { startDate: string; endDate: string; timeZone: string }

/** Provider-independent projection. Call once per user; adapters validate their own JSON.
 * sourceKey is a stable connection/calendar/event identity, independent of snapshots.
 * Repeating instances must supply their original instant (offset-bearing ISO or epoch ms)
 * or original all-day date. Current start time is never an occurrence identity.
 */
export interface CalendarSourceInput {
  userClassification?: "business" | "personal" | "unknown"
  sourceKey: string
  title?: string
  startMs?: number
  endMs?: number
  allDay?: AllDayRange
  iCalUID?: string
  recurringEventId?: string
  originalStartTime?: string | number
  status?: "confirmed" | "tentative" | "cancelled"
  responseStatus?: "accepted" | "tentative" | "needsAction" | "declined"
  transparency?: "opaque" | "transparent"
  eventType?: "default" | "workingLocation" | "focusTime" | "outOfOffice" | "freeBusy"
  kind?: LocationKind
  placeRef?: string | null
  hasOnlineLink?: boolean
  /** Explicit user-confirmed location takes precedence over ambiguous source hints. */
  confirmedLocation?: { kind: LocationKind; placeRef: string | null }
}

export interface AnalysisEvent extends CalEvent {
  userClassification?: "business" | "personal" | "unknown"
  sourceKeys: string[]
  /** Originals preserve recurrence identity and source-specific values. */
  sources: CalendarSourceInput[]
  responseStatus: NonNullable<CalendarSourceInput["responseStatus"]>
  locationNeedsConfirmation: boolean
}
export interface NormalizedCalendar {
  busyIntervals: BusyInterval[]
  travelAnchors: TravelAnchor[]
  analysisEvents: AnalysisEvent[]
}

function validDate(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new RangeError(`Invalid calendar date: ${date}`)
  }
  return ms
}

/** First instant of a civil date in its original zone, including 23/25-hour DST days.
 * Searching civil dates also handles zones whose clock jumps at midnight.
 */
export function zonedDateStart(date: string, timeZone: string): number {
  const utc = validDate(date)
  const format = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
  const dateAt = (ms: number) => {
    const parts = format.formatToParts(ms)
    const get = (type: string) => parts.find(p => p.type === type)!.value
    return `${get("year")}-${get("month")}-${get("day")}`
  }
  let lo = utc - 2 * 86_400_000
  let hi = utc + 2 * 86_400_000
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (dateAt(mid) < date) lo = mid + 1
    else hi = mid
  }
  return lo
}

function occurrence(value: string | number): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new RangeError("Invalid original start instant")
    return `instant:${value}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    validDate(value)
    return `date:${value}`
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new RangeError("Original start time requires an explicit offset")
  }
  return `instant:${Date.parse(value)}`
}

function identity(event: CalendarSourceInput): string {
  const original = event.originalStartTime === undefined ? undefined : occurrence(event.originalStartTime)
  if (event.iCalUID && (original !== undefined || !event.recurringEventId)) {
    return JSON.stringify(["uid", event.iCalUID, original ?? "single"])
  }
  return JSON.stringify(["source", event.sourceKey])
}

function range(event: CalendarSourceInput): BusyInterval {
  const startMs = event.allDay ? zonedDateStart(event.allDay.startDate, event.allDay.timeZone) : event.startMs
  const endMs = event.allDay ? zonedDateStart(event.allDay.endDate, event.allDay.timeZone) : event.endMs
  if (startMs === undefined || endMs === undefined || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs >= endMs) {
    throw new RangeError("Calendar events require a positive integer millisecond range")
  }
  return { startMs, endMs }
}

function isBusy(event: CalendarSourceInput): boolean {
  return event.status !== "cancelled" && event.responseStatus !== "declined" && event.transparency !== "transparent" && event.eventType !== "workingLocation"
}

function location(event: CalendarSourceInput): { kind: LocationKind; placeRef: string | null; locationNeedsConfirmation: boolean } {
  if (event.confirmedLocation) return { ...event.confirmedLocation, locationNeedsConfirmation: false }
  const ambiguous = !!event.placeRef && (event.hasOnlineLink || event.kind === "online")
  const kind = ambiguous ? "none" : event.kind ?? (event.hasOnlineLink && !event.placeRef ? "online" : "none")
  return { kind, placeRef: kind === "place" || kind === "office" ? event.placeRef ?? null : null, locationNeedsConfirmation: kind === "none" }
}

function union(intervals: BusyInterval[]): BusyInterval[] {
  const result: BusyInterval[] = []
  for (const interval of [...intervals].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)) {
    const last = result.at(-1)
    if (last && interval.startMs <= last.endMs) last.endMs = Math.max(last.endMs, interval.endMs)
    else result.push({ ...interval })
  }
  return result
}

/** Normalize a complete, single-user projection. No provider schemas, I/O or global state. */
export function normalizeCalendarEvents(input: CalendarSourceInput[]): NormalizedCalendar {
  const groups = new Map<string, CalendarSourceInput[]>()
  for (const event of input) {
    const key = identity(event)
    const group = groups.get(key) ?? []
    group.push(event)
    groups.set(key, group)
  }
  const result: NormalizedCalendar = { busyIntervals: [], travelAnchors: [], analysisEvents: [] }
  for (const [key, copies] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    copies.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
    const live = copies.filter(isBusy)
    if (!live.length) continue
    const normalized = live.map(event => ({ event, range: range(event), location: location(event) }))
    const signatures = new Set(copies.map(event => {
      if (!isBusy(event)) return JSON.stringify(["excluded", event.status, event.responseStatus, event.transparency, event.eventType])
      const where = location(event)
      return JSON.stringify([range(event), event.allDay ?? null, event.status ?? "confirmed", event.responseStatus ?? "accepted", event.eventType ?? "default", where.kind, where.placeRef])
    }))
    const conflict = signatures.size > 1
    const busy = union(normalized.map(n => n.range))
    result.busyIntervals.push(...busy)
    if (conflict) {
      // All-day copies block but never become travel origins, even in a conflicted group.
      const timed = union(normalized.filter(n => !n.event.allDay).map(n => n.range))
      result.travelAnchors.push(...timed.map(interval => ({ ...interval, kind: "none" as const, placeRef: null })))
      continue
    }
    const { event, range: interval, location: where } = normalized[0]
    if (event.allDay) continue
    if (where.kind !== "online") result.travelAnchors.push({ ...interval, kind: where.kind, placeRef: where.placeRef })
    if (event.eventType && event.eventType !== "default") continue
    result.analysisEvents.push({
      userClassification: event.userClassification,
      id: key, title: event.title ?? "", ...interval, ...where,
      sourceKeys: [...new Set(copies.map(e => e.sourceKey))], sources: structuredClone(copies),
      responseStatus: event.responseStatus ?? "accepted",
    })
  }
  result.busyIntervals = union(result.busyIntervals)
  result.travelAnchors.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.kind.localeCompare(b.kind) || (a.placeRef ?? "").localeCompare(b.placeRef ?? ""))
  result.analysisEvents.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))
  return result
}

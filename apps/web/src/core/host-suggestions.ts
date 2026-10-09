// AI-generated with Claude Code (claude-opus-5-5), 2026-10-06
import { resolveClassification, type AnalysisEvent } from "./analysis"
import type { MeetingType, Place, PlaceKind } from "./types"

/** Seen at least this often before it is offered: a single event is an appointment, not a habit. */
export const MIN_REPEATS = 2
const MAX_NAMED_PLACES = 3
const MAX_MEETING_TYPES = 3
const MAX_MEETING_MS = 3 * 3_600_000
const NAME_MAX = 60
// Location text that names a video call rather than somewhere to go.
const ONLINE_TEXT = /https?:\/\/|zoom|meet\.google|google meet|teams|webex|온라인|화상/i
const OFFICE_TEXT = /회사|사무실|오피스|본사|office/i

export interface PlaceSuggestion { kind: PlaceKind; name: string; count: number }
export interface MeetingTypeSuggestion { name: string; durationMin: number; count: number }
export interface HostSuggestions {
  /** Business events up to three hours that the suggestions were read from. */
  basedOn: number
  places: PlaceSuggestion[]
  meetingTypes: MeetingTypeSuggestion[]
}

/** What the source said, unless the user has confirmed the location themselves (their answer, even "unknown", wins). */
function locationText(e: AnalysisEvent): string | null {
  if (e.sources.some((s) => s.confirmedLocation)) return e.placeRef
  return e.placeRef ?? e.sources.find((s) => s.placeRef)?.placeRef ?? null
}

/**
 * Starting points for a host's places and meeting lengths, read from past business events.
 * Only business events count, so personal places (a clinic, home) are never offered as somewhere to meet.
 * These are suggestions for the host to add one by one; nothing here is published on its own.
 */
export function suggestHostSetup(events: AnalysisEvent[], existing: { places: Place[]; meetingTypes: MeetingType[] }): HostSuggestions {
  const meetings = events.filter((e) => resolveClassification(e) === "business" && e.endMs > e.startMs && e.endMs - e.startMs <= MAX_MEETING_MS)
  const named = new Map<string, { office: boolean; count: number }>()
  let online = 0
  for (const e of meetings) {
    const text = locationText(e)?.trim().slice(0, NAME_MAX)
    if (e.kind === "online" || (text && ONLINE_TEXT.test(text))) { online++; continue }
    if (!text) continue
    const entry = named.get(text) ?? { office: false, count: 0 }
    named.set(text, { office: entry.office || e.kind === "office" || OFFICE_TEXT.test(text), count: entry.count + 1 })
  }
  const takenNames = new Set(existing.places.map((p) => p.name.trim()))
  const places: PlaceSuggestion[] = [...named]
    .filter(([name, v]) => v.count >= MIN_REPEATS && !takenNames.has(name))
    .sort(([a, x], [b, y]) => y.count - x.count || a.localeCompare(b))
    .slice(0, MAX_NAMED_PLACES)
    .map(([name, v]) => ({ kind: v.office ? "office_near" : "special", name, count: v.count }))
  if (online >= MIN_REPEATS && !existing.places.some((p) => p.kind === "online")) places.push({ kind: "online", name: "온라인", count: online })

  const lengths = new Map<number, number>()
  for (const e of meetings) {
    const minutes = Math.max(15, Math.round((e.endMs - e.startMs) / 60_000 / 15) * 15)
    lengths.set(minutes, (lengths.get(minutes) ?? 0) + 1)
  }
  const takenLengths = new Set(existing.meetingTypes.map((t) => t.durationMin))
  const meetingTypes = [...lengths]
    .filter(([minutes, count]) => count >= MIN_REPEATS && !takenLengths.has(minutes))
    .sort(([a, x], [b, y]) => y - x || a - b)
    .slice(0, MAX_MEETING_TYPES)
    .map(([durationMin, count]) => ({ name: `${durationMin}분 미팅`, durationMin, count }))

  return { basedOn: meetings.length, places, meetingTypes }
}

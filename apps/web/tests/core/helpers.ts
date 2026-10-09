// AI-generated with Claude Code (claude-sonnet-5-5), 2026-09-29
import { defaultRules } from "@/core/availability"
import { parseHm, parseKstDate, kstDateString, kstTimeString } from "@/core/time"
import type { CalEvent, LocationKind, MeetingType, Person, Place } from "@/core/types"

export const MIN = 60_000

/** Epoch ms for `YYYY-MM-DD` `HH:MM` in KST. */
export function T(date: string, hm: string): number {
  const d = parseKstDate(date)
  const m = parseHm(hm)
  if (d === null || m === null) throw new Error(`bad time ${date} ${hm}`)
  return d + m * MIN
}

let seq = 0
export function ev(
  date: string,
  from: string,
  to: string,
  kind: LocationKind,
  placeRef: string | null = null,
): CalEvent {
  seq += 1
  return { id: `e${seq}`, title: `ev${seq}`, startMs: T(date, from), endMs: T(date, to), kind, placeRef }
}

export function person(events: CalEvent[] = []): Person {
  return { events, rules: defaultRules() }
}

export const NEAR: Place = { id: "p-near", kind: "office_near", name: "회사 근처 카페" }
export const SPECIAL: Place = { id: "p-special", kind: "special", name: "강남 스터디카페" }
export const ONLINE: Place = { id: "p-online", kind: "online", name: "온라인" }
export const PLACES = [NEAR, SPECIAL, ONLINE]

export const T30: MeetingType = { id: "t30", name: "30분 커피챗", durationMin: 30 }
export const T60: MeetingType = { id: "t60", name: "60분 상담", durationMin: 60 }

export function startsOf(slots: { startMs: number; placeId: string; meetingTypeId: string }[], date: string, placeId: string, typeId: string): string[] {
  return slots
    .filter((s) => kstDateString(s.startMs) === date && s.placeId === placeId && s.meetingTypeId === typeId)
    .map((s) => kstTimeString(s.startMs))
}

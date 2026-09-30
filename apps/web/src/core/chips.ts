import { formatKstDateTime, weekdayKo } from "./time"
import type { Filter, FilterKey, MeetingType, Place, Slot, Strength } from "./types"

export interface Chip {
  key: FilterKey
  /** Full chip text, e.g. "월–목 · 반드시". */
  label: string
  /** The condition alone, e.g. "월–목". */
  text: string
  /** null for conditions that have no strength (ordering). */
  strength: Strength | null
}

const STRENGTH_LABEL: Record<Strength, string> = { must: "반드시", strong: "강", weak: "약" }

function weekdaysLabel(days: number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b)
  const key = set.join(",")
  if (key === "1,2,3,4,5") return "평일"
  if (key === "0,6") return "주말"
  if (set.length === 7) return "매일"
  const isRun = set.length >= 3 && set.every((d, i) => i === 0 || d === set[i - 1] + 1)
  if (isRun) return `${weekdayKo(set[0])}–${weekdayKo(set[set.length - 1])}`
  return set.map(weekdayKo).join("·")
}

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

export function filterChips(filter: Filter, places: Place[], types: MeetingType[]): Chip[] {
  const chips: Chip[] = []
  const push = (key: FilterKey, text: string, strength: Strength | null) =>
    chips.push({ key, text, strength, label: strength ? `${text} · ${STRENGTH_LABEL[strength]}` : text })

  if (filter.dateRange) {
    const { from, to, strength } = filter.dateRange
    push("dateRange", from === to ? md(from) : `${md(from)}–${md(to)}`, strength)
  }
  if (filter.weekdays) push("weekdays", weekdaysLabel(filter.weekdays.days), filter.weekdays.strength)
  if (filter.timeOfDay) push("timeOfDay", `${filter.timeOfDay.start}–${filter.timeOfDay.end}`, filter.timeOfDay.strength)
  if (filter.places) {
    push("places", filter.places.placeIds.map((id) => places.find((p) => p.id === id)?.name ?? id).join("·"), filter.places.strength)
  }
  if (filter.meetingTypes) {
    push("meetingTypes", filter.meetingTypes.ids.map((id) => types.find((t) => t.id === id)?.name ?? id).join("·"), filter.meetingTypes.strength)
  }
  if (filter.order) push("order", filter.order === "earliest" ? "빠른 순" : "늦은 시각 우선", null)
  if (filter.slack) push("slack", "앞뒤 여유", filter.slack.strength)
  return chips
}

/** `M월 D일(요일) HH:MM · 장소 · 양식` */
export function slotLabel(slot: Pick<Slot, "startMs" | "placeId" | "meetingTypeId">, places: Place[], types: MeetingType[]): string {
  const place = places.find((p) => p.id === slot.placeId)?.name ?? slot.placeId
  const type = types.find((t) => t.id === slot.meetingTypeId)?.name ?? slot.meetingTypeId
  return `${formatKstDateTime(slot.startMs)} · ${place} · ${type}`
}

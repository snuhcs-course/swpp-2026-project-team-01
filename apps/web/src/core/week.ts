import { DAY_MS, HORIZON_DAYS, kstDateString, kstWeekStart, parseKstDate } from './time'

export interface DayItem { startMs: number; endMs: number; allDay: boolean; startDate: string | null; endDate: string | null }

/**
 * Items shown on the KST day that starts at `dayStart`.
 * All-day items use the calendar's own dates (end date exclusive, as in Google Calendar), so they land on the right day
 * whatever time zone the calendar uses. Timed items appear on every day they overlap.
 */
export function itemsOnDay<T extends DayItem>(items: T[], dayStart: number): T[] {
  const date = kstDateString(dayStart), dayEnd = dayStart + DAY_MS
  return items.filter(i => i.allDay && i.startDate && i.endDate ? i.startDate <= date && date < i.endDate : i.startMs < dayEnd && i.endMs > dayStart)
}

/** A timed item clipped to one day, as whole minutes since that day's start (seconds are dropped, like every other time shown in the app; the end is capped at 24:00). */
export function clipToDay(item: { startMs: number; endMs: number }, dayStart: number): { fromMin: number; toMin: number } {
  return { fromMin: Math.max(0, Math.floor((item.startMs - dayStart) / 60000)), toMin: Math.min(1440, Math.floor((item.endMs - dayStart) / 60000)) }
}

export interface Span { id: string; startMs: number; endMs: number }
/**
 * Which external items overlap which confirmed meetings. A meeting is only confirmed after the slot was checked against fresh
 * calendars, so any overlap seen now arose afterwards (an event added or moved in Google). It is shown, never auto-resolved.
 */
export function findConflicts<B extends Span, I extends Span>(bookings: B[], items: I[]): { byBooking: Record<string, I[]>; byItem: Record<string, B[]> } {
  const byBooking: Record<string, I[]> = {}, byItem: Record<string, B[]> = {}
  for (const b of bookings) for (const i of items) {
    if (i.startMs < b.endMs && i.endMs > b.startMs) { (byBooking[b.id] ??= []).push(i); (byItem[i.id] ??= []).push(b) }
  }
  return { byBooking, byItem }
}

/** The `?w=` index of the My Calendar week that contains `targetMs` (0 = this week), clamped to what the page can show. */
export function weekIndexFor(targetMs: number, nowMs: number): number {
  const target = parseKstDate(kstWeekStart(targetMs)), current = parseKstDate(kstWeekStart(nowMs))
  if (target === null || current === null) return 0
  return Math.min(Math.floor(HORIZON_DAYS / 7), Math.max(0, Math.round((target - current) / (7 * DAY_MS))))
}

import type { CalendarSourceInput } from '@/core/calendar'
import { findConflicts } from '@/core/week'
import type { ServiceContext } from '../runtime'
import { all, one } from '../db/client'
import { MOCK_SUBJECT_PREFIX } from '../providers/mock-calendar'

export interface CalendarItem {
  id: string; kind: 'event' | 'busy'; title: string; startMs: number; endMs: number
  allDay: boolean; startDate: string | null; endDate: string | null; tentative: boolean
  /** Every selected calendar that carries this same event (usually one). */
  calendarNames: string[]
}
/** `mock` = the demo account's example calendar (no Google involved). */
export interface CalendarItems { connected: boolean; provider: 'google' | 'mock' | null; checkedAt: number | null; items: CalendarItem[] }

interface EventRow {
  id: string; title: string | null; start_at: number; end_at: number; all_day: number; start_date: string | null; end_date: string | null
  status: string | null; transparency: string | null; field_fingerprints_json: string
  ical_uid: string | null; recurring_event_id: string | null; original_start_time: string | null; calendar_name: string
}

/** Copies of one appointment are only treated as the same when the provider says so (iCalUID plus the occurrence), never by lookalike titles. */
const identity = (r: EventRow) => r.ical_uid && (r.original_start_time !== null || !r.recurring_event_id) ? JSON.stringify(['uid', r.ical_uid, r.original_start_time ?? 'single']) : `id:${r.id}`
const sameContent = (a: EventRow, b: EventRow) => a.title === b.title && a.start_at === b.start_at && a.end_at === b.end_at && a.all_day === b.all_day && a.status === b.status

/**
 * The owner's imported Google events (and busy-only blocks) that overlap [fromMs, toMs), read from the current schedule snapshot.
 * Read-only and never refreshes from Google: `checkedAt` says how old the data is. Entries that do not occupy the owner's time
 * (declined, marked free, working-location markers) are left out, matching how availability is computed. The same appointment on
 * several selected calendars appears once; copies that disagree stay separate rather than being merged by guesswork.
 */
export async function listCalendarItems(ctx: ServiceContext, userId: string, fromMs: number, toMs: number): Promise<CalendarItems> {
  const c = await one<{ id: string; status: string; subject: string; snapshot: string | null; state: string }>(ctx.db, "SELECT c.id id, c.status status, c.subject subject, c.schedule_snapshot_id snapshot, u.calendar_use_state state FROM calendar_connections c JOIN users u ON u.id = c.user_id WHERE c.user_id = ?", [userId])
  if (!c || c.state !== 'connected' || c.status !== 'connected' || !c.snapshot) return { connected: false, provider: null, checkedAt: null, items: [] }
  const checkedAt = (await one<{ t: number }>(ctx.db, 'SELECT completed_at t FROM calendar_snapshots WHERE id = ?', [c.snapshot]))?.t ?? null
  const events = await all<EventRow>(ctx.db, `SELECT e.id, e.title, e.start_at, e.end_at, e.all_day, e.start_date, e.end_date, e.status, e.transparency, e.field_fingerprints_json,
      e.ical_uid, e.recurring_event_id, e.original_start_time, s.name calendar_name
    FROM imported_events e JOIN calendar_sources s ON s.connection_id = ? AND s.provider_calendar_id = e.calendar_id AND s.selected = 1
    WHERE e.snapshot_id = ? AND e.end_at > ? AND e.start_at < ? ORDER BY e.start_at, e.id`, [c.id, c.snapshot, fromMs, toMs])
  const busy = await all<{ id: string; start_at: number; end_at: number; calendar_name: string }>(ctx.db, `SELECT b.id, b.start_at, b.end_at, s.name calendar_name FROM imported_busy_intervals b JOIN calendar_sources s ON s.connection_id = ? AND s.provider_calendar_id = b.calendar_id AND s.selected = 1
    WHERE b.snapshot_id = ? AND b.end_at > ? AND b.start_at < ?`, [c.id, c.snapshot, fromMs, toMs])

  const occupying: { row: EventRow; tentative: boolean }[] = []
  for (const e of events) {
    let source: CalendarSourceInput | undefined
    try { source = JSON.parse(e.field_fingerprints_json).source } catch { /* fall back to the columns alone */ }
    if (e.status === 'cancelled' || e.transparency === 'transparent' || source?.responseStatus === 'declined' || source?.eventType === 'workingLocation') continue
    occupying.push({ row: e, tentative: e.status === 'tentative' || source?.responseStatus === 'tentative' })
  }
  const groups = new Map<string, typeof occupying>()
  for (const entry of occupying) { const key = identity(entry.row); groups.set(key, [...(groups.get(key) ?? []), entry]) }
  const items: CalendarItem[] = []
  const toItem = (entry: (typeof occupying)[number], names: string[], tentative: boolean): CalendarItem => ({
    id: entry.row.id, kind: 'event', title: entry.row.title?.trim() || '제목 없음', startMs: entry.row.start_at, endMs: entry.row.end_at,
    allDay: !!entry.row.all_day, startDate: entry.row.start_date, endDate: entry.row.end_date, tentative, calendarNames: names,
  })
  for (const group of groups.values()) {
    if (group.length > 1 && group.every(g => sameContent(g.row, group[0].row))) {
      items.push(toItem(group[0], [...new Set(group.map(g => g.row.calendar_name))].sort(), group.every(g => g.tentative)))
    } else for (const entry of group) items.push(toItem(entry, [entry.row.calendar_name], entry.tentative))
  }
  for (const b of busy) items.push({ id: b.id, kind: 'busy', title: '바쁨', startMs: b.start_at, endMs: b.end_at, allDay: false, startDate: null, endDate: null, tentative: false, calendarNames: [b.calendar_name] })
  items.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))
  return { connected: true, provider: c.subject.startsWith(MOCK_SUBJECT_PREFIX) ? 'mock' : 'google', checkedAt, items }
}

/**
 * Requests whose confirmed meeting now overlaps something on the viewer's OWN external calendar (an event added or moved after
 * the meeting was confirmed). Only the viewer's calendar is consulted, so nothing about the other person's schedule is revealed,
 * and nothing is cancelled: the meeting stays, the person is told.
 */
export async function conflictingRequestIds(ctx: ServiceContext, userId: string): Promise<string[]> {
  const rows = await all<{ id: string; start_at: string; end_at: string }>(ctx.db, "SELECT request_id id, start_at, end_at FROM events WHERE user_id = ? AND source = 'booking' AND request_id IS NOT NULL", [userId])
  const upcoming = rows.map(r => ({ id: r.id, startMs: Date.parse(r.start_at), endMs: Date.parse(r.end_at) })).filter(b => b.endMs > ctx.clock.now())
  if (!upcoming.length) return []
  const items = (await listCalendarItems(ctx, userId, Math.min(...upcoming.map(b => b.startMs)), Math.max(...upcoming.map(b => b.endMs)))).items
  return Object.keys(findConflicts(upcoming, items).byBooking)
}

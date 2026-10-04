import type { Db } from '../db/client'
import { all, one } from '../db/client'
import type { CalendarProvider } from './google-calendar'

/** Connections made without Google carry this subject prefix. Only demo mode may create them. */
export const MOCK_SUBJECT_PREFIX = 'mock:'
export const mockCalendarId = (userId: string) => `mock-${userId}`

/**
 * A stand-in for Google Calendar in demo mode: it answers with the schedule already set up for that account
 * (the seeded events), shaped like Google's API responses so the normal catalog → selection → import flow runs unchanged.
 * Meetings booked inside the app are not part of it — they never came from a calendar.
 */
export class MockCalendarProvider implements CalendarProvider {
  constructor(private readonly db: Db, private readonly userId: string) {}

  async listCalendars() {
    const name = (await one<{ name: string }>(this.db, 'SELECT name FROM users WHERE id = ?', [this.userId]))?.name ?? this.userId
    return { items: [{ id: mockCalendarId(this.userId), summary: `${name} 예시 캘린더`, timeZone: 'Asia/Seoul', accessRole: 'owner' }] }
  }

  async listEvents(_connectionId: string, calendarId: string, input: { fromMs: number; toMs: number }) {
    if (calendarId !== mockCalendarId(this.userId)) return { items: [] }
    const rows = await all<{ id: string; title: string; start_at: string; end_at: string; location_kind: string; place_ref: string | null }>(this.db, "SELECT id, title, start_at, end_at, location_kind, place_ref FROM events WHERE user_id = ? AND source = 'seed' ORDER BY start_at", [this.userId])
    const items = rows
      .filter(r => Date.parse(r.end_at) > input.fromMs && Date.parse(r.start_at) < input.toMs)
      .map(r => ({
        id: r.id, summary: r.title, status: 'confirmed' as const,
        start: { dateTime: r.start_at }, end: { dateTime: r.end_at },
        ...(r.location_kind === 'online' ? { hangoutLink: 'https://meet.example.invalid/mock' } : {}),
        ...(r.location_kind === 'place' && r.place_ref ? { location: r.place_ref } : {}),
        ...(r.location_kind === 'office' ? { location: '회사' } : {}),
      }))
    return { items }
  }

  async freeBusy() { return { calendars: {} } }
}

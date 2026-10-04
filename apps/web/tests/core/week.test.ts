import { describe, expect, it } from 'vitest'
import { clipToDay, findConflicts, itemsOnDay, weekIndexFor } from '@/core/week'
import { DAY_MS } from '@/core/time'

const kst = (s: string) => Date.parse(`${s}+09:00`)
const monday = kst('2026-10-05T00:00:00')
const timed = (id: string, from: string, to: string) => ({ id, startMs: kst(from), endMs: kst(to), allDay: false, startDate: null, endDate: null })
const allDay = (id: string, startDate: string, endDate: string) => ({ id, startMs: 0, endMs: 1, allDay: true, startDate, endDate })

describe('week layout', () => {
  it('puts an all-day event on exactly the days of its own dates (end exclusive), regardless of the stored instants', () => {
    const item = allDay('a', '2026-10-06', '2026-10-08') // Tue and Wed
    const days = [0, 1, 2, 3].map(i => itemsOnDay([item], monday + i * DAY_MS).length)
    expect(days).toEqual([0, 1, 1, 0])
  })
  it('shows a timed event on every day it overlaps and not on the next day when it ends at midnight', () => {
    const overnight = timed('n', '2026-10-06T22:00:00', '2026-10-07T02:00:00')
    const endsAtMidnight = timed('m', '2026-10-06T20:00:00', '2026-10-07T00:00:00')
    const on = (item: typeof overnight, day: number) => itemsOnDay([item], monday + day * DAY_MS).length
    expect([on(overnight, 1), on(overnight, 2), on(overnight, 3)]).toEqual([1, 1, 0])
    expect([on(endsAtMidnight, 1), on(endsAtMidnight, 2)]).toEqual([1, 0])
  })
  it('clips a timed event to the day for display', () => {
    const overnight = timed('n', '2026-10-06T22:00:00', '2026-10-07T02:00:00')
    expect(clipToDay(overnight, monday + DAY_MS)).toEqual({ fromMin: 22 * 60, toMin: 1440 })
    expect(clipToDay(overnight, monday + 2 * DAY_MS)).toEqual({ fromMin: 0, toMin: 120 })
  })
  it('drops seconds the same way as the rest of the app, so deadline-style events read the same everywhere', () => {
    const deadline = timed('d', '2026-10-06T23:29:59', '2026-10-06T23:59:59')
    expect(clipToDay(deadline, monday + DAY_MS)).toEqual({ fromMin: 23 * 60 + 29, toMin: 23 * 60 + 59 })
  })
  it('finds which external items overlap which confirmed meetings, in both directions, and ignores mere neighbours', () => {
    const span = (id: string, from: string, to: string) => ({ id, startMs: kst(from), endMs: kst(to) })
    const meeting = [span('m1', '2026-10-06T14:00:00', '2026-10-06T15:00:00'), span('m2', '2026-10-07T10:00:00', '2026-10-07T11:00:00')]
    const items = [span('overlaps', '2026-10-06T14:30:00', '2026-10-06T16:00:00'), span('touches', '2026-10-06T15:00:00', '2026-10-06T16:00:00'), span('elsewhere', '2026-10-08T10:00:00', '2026-10-08T11:00:00')]
    const { byBooking, byItem } = findConflicts(meeting, items)
    expect(Object.keys(byBooking)).toEqual(['m1'])
    expect(byBooking.m1.map(i => i.id)).toEqual(['overlaps'])
    expect(Object.keys(byItem)).toEqual(['overlaps'])
    expect(byItem.overlaps.map(b => b.id)).toEqual(['m1'])
  })
  it('finds the My Calendar week for a meeting, clamped to what the page can show', () => {
    const now = kst('2026-10-07T12:00:00')                                  // Wednesday of the week starting 2026-10-05
    expect(weekIndexFor(kst('2026-10-09T10:00:00'), now)).toBe(0)           // same week
    expect(weekIndexFor(kst('2026-10-12T00:00:00'), now)).toBe(1)           // next Monday
    expect(weekIndexFor(kst('2026-10-18T23:00:00'), now)).toBe(1)           // Sunday still belongs to that week
    expect(weekIndexFor(kst('2026-10-01T10:00:00'), now)).toBe(0)           // the past clamps to this week
    expect(weekIndexFor(kst('2027-10-01T10:00:00'), now)).toBe(8)           // far future clamps to the last week
  })
})

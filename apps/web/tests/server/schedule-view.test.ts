import { afterEach, describe, expect, it } from 'vitest'
import { fixture, event, NOW } from '../fixtures/google-calendar-provider'
import { syncCalendar, saveCalendarSelection } from '@/server/services/calendar-sync'
import { listCalendarItems } from '@/server/services/schedule-view'

const fixtures: Awaited<ReturnType<typeof fixture>>[] = []
afterEach(() => { fixtures.splice(0).forEach(f => f.close()) })
const kst = (s: string) => Date.parse(`${s}+09:00`)
const at = (from: string, to: string) => ({ start: { dateTime: `${from}+09:00` }, end: { dateTime: `${to}+09:00` } })
const FROM = kst('2026-10-05T00:00:00'), TO = kst('2026-10-12T00:00:00')

async function setup() {
  const f = (await fixture()); fixtures.push(f)
  f.respond(url => url.pathname.endsWith('/freeBusy')
    ? { calendars: { b: { busy: [{ start: '2026-10-06T05:00:00Z', end: '2026-10-06T06:00:00Z' }] } } }
    : { items: [
      event('timed', { summary: 'IC 회의', ...at('2026-10-06T10:00:00', '2026-10-06T11:00:00') }),
      event('trip', { summary: '휴가', start: { date: '2026-10-07' }, end: { date: '2026-10-09' } }),
      event('maybe', { summary: '미정 후보', status: 'tentative', ...at('2026-10-08T14:00:00', '2026-10-08T15:00:00') }),
      event('declined', { summary: '거절한 회의', attendees: [{ self: true, responseStatus: 'declined' }], ...at('2026-10-06T13:00:00', '2026-10-06T14:00:00') }),
      event('free', { summary: '한가함 표시', transparency: 'transparent', ...at('2026-10-06T15:00:00', '2026-10-06T16:00:00') }),
      event('where', { summary: '근무 위치', eventType: 'workingLocation', ...at('2026-10-06T09:00:00', '2026-10-06T10:00:00') }),
      event('cancelled', { summary: '취소됨', status: 'cancelled', ...at('2026-10-06T16:00:00', '2026-10-06T17:00:00') }),
      event('later', { summary: '다음 달 일정', ...at('2026-11-20T10:00:00', '2026-11-20T11:00:00') }),
    ] })
  await syncCalendar(f.ctx, 'owner', { expectedSelectionRevision: 0 }, { key: 'sync' }, f.port, 'future')
  return f
}

describe('imported items for the calendar page', () => {
  it('lists what occupies the owner\'s time inside the window, with all-day, tentative and busy-only entries marked', async () => {
    const f = await setup()
    const result = (await listCalendarItems(f.ctx, 'owner', FROM, TO))
    expect(result.connected).toBe(true)
    expect(result.checkedAt).toBe(NOW)
    expect(result.items.map(i => i.title).sort()).toEqual(['IC 회의', '미정 후보', '바쁨', '휴가'].sort())
    expect(result.items.find(i => i.title === '휴가')).toMatchObject({ kind: 'event', allDay: true, startDate: '2026-10-07', endDate: '2026-10-09' })
    expect(result.items.find(i => i.title === '미정 후보')).toMatchObject({ tentative: true, allDay: false })
    expect(result.items.find(i => i.title === '바쁨')).toMatchObject({ kind: 'busy', startMs: Date.parse('2026-10-06T05:00:00Z') })
    expect(result.items.map(i => i.startMs)).toEqual([...result.items.map(i => i.startMs)].sort((a, b) => a - b))
  })
  it('only returns the requested window', async () => {
    const f = await setup()
    expect((await listCalendarItems(f.ctx, 'owner', kst('2026-11-19T00:00:00'), kst('2026-11-22T00:00:00'))).items.map(i => i.title)).toEqual(['다음 달 일정'])
    expect((await listCalendarItems(f.ctx, 'owner', kst('2026-12-01T00:00:00'), kst('2026-12-08T00:00:00'))).items).toEqual([])
  })
  it('never exposes another user\'s events and reports an unconnected user as such', async () => {
    const f = await setup()
    expect((await listCalendarItems(f.ctx, 'other', FROM, TO))).toEqual({ connected: false, provider: null, checkedAt: null, items: [] })
    expect((await listCalendarItems(f.ctx, 'nobody', FROM, TO))).toEqual({ connected: false, provider: null, checkedAt: null, items: [] })
  })
  it('hides everything as soon as the selection changes, until the new selection is fetched', async () => {
    const f = await setup()
    await saveCalendarSelection(f.ctx, 'owner', { expectedSelectionRevision: 0, calendarIds: ['b'] }, { key: 'select' })
    expect((await listCalendarItems(f.ctx, 'owner', FROM, TO))).toMatchObject({ connected: false, items: [] })
  })

  describe('one appointment on several selected calendars', () => {
    const second = async (f: Awaited<ReturnType<typeof fixture>>) => (await f.sqlite.exec("INSERT INTO calendar_sources(id,connection_id,provider_calendar_id,name,timezone,access_role,selected) VALUES ('source-c','connection','c@example.test','C','Asia/Seoul','owner',1)"))
    async function run(forA: unknown[], forC: unknown[]) {
      const f = (await fixture()); fixtures.push(f); (await second(f))
      f.respond(url => url.pathname.endsWith('/freeBusy') ? { calendars: { b: { busy: [] } } } : { items: url.pathname.includes('c%40example.test') ? forC : forA })
      await syncCalendar(f.ctx, 'owner', { expectedSelectionRevision: 0 }, { key: 'sync' }, f.port, 'future')
      return (await listCalendarItems(f.ctx, 'owner', FROM, TO)).items.filter(i => i.kind === 'event')
    }
    const when = at('2026-10-06T10:00:00', '2026-10-06T11:00:00')
    it('shows it once, naming every calendar that carries it, when the provider says it is the same appointment', async () => {
      const items = await run([event('a1', { summary: '공유 회의', iCalUID: 'uid-1', ...when })], [event('c1', { summary: '공유 회의', iCalUID: 'uid-1', ...when })])
      expect(items).toHaveLength(1)
      expect(items[0].calendarNames).toEqual(['A', 'C'])
    })
    it('keeps copies apart when they disagree, or when only the titles look alike', async () => {
      const disagree = await run([event('a1', { summary: '공유 회의', iCalUID: 'uid-1', ...when })], [event('c1', { summary: '공유 회의', iCalUID: 'uid-1', ...at('2026-10-06T10:00:00', '2026-10-06T11:30:00') })])
      expect(disagree).toHaveLength(2)
      const lookalike = await run([event('a1', { summary: '점심', ...when })], [event('c1', { summary: '점심', ...when })])
      expect(lookalike).toHaveLength(2)
    })
    it('treats different occurrences of a recurring series as different appointments', async () => {
      const a = event('a1', { summary: '주간 회의', iCalUID: 'series', recurringEventId: 'r', originalStartTime: { dateTime: '2026-10-06T10:00:00+09:00' }, ...when })
      const c = event('c1', { summary: '주간 회의', iCalUID: 'series', recurringEventId: 'r', originalStartTime: { dateTime: '2026-10-13T10:00:00+09:00' }, ...when })
      expect(await run([a], [c])).toHaveLength(2)
    })
  })
})

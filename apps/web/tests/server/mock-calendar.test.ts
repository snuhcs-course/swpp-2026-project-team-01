import { emptyDb } from './helpers'
import { afterEach, describe, expect, it } from 'vitest'
import { seed, SEED_USERS } from '@/server/db/seed'
import { makeContext } from '@/server/runtime'
import { MockCalendarProvider } from '@/server/providers/mock-calendar'
import { connectMockCalendar } from '@/server/services/mock-calendar'
import { refreshCalendarCatalog, saveCalendarSelection, syncCalendar, disconnectCalendar, readCalendarConnection } from '@/server/services/calendar-sync'
import { listCalendarItems, conflictingRequestIds } from '@/server/services/schedule-view'

const NOW = Date.parse('2026-10-05T00:00:00+09:00')
const stores: Awaited<ReturnType<typeof emptyDb>>[] = []
afterEach(() => { stores.splice(0).forEach(s => s.sqlite.close()) })
async function setup(mode: 'demo' | 'real' = 'demo') {
  const store = await emptyDb(); stores.push(store); (await seed(store.db, NOW))
  const ctx = makeContext(store.db, { now: () => NOW }, { mode,  allowReset: false })
  return { ...store, ctx }
}
const minjun = SEED_USERS.minjun.id, jiho = SEED_USERS.jiho.id
/** Runs the same steps a person does on the Calendar 연결 screen. */
async function importExample(ctx: Awaited<ReturnType<typeof setup>>['ctx'], db: Awaited<ReturnType<typeof setup>>['db'], userId: string) {
  const provider = new MockCalendarProvider(db, userId)
  const connected = await connectMockCalendar(ctx, userId, { key: `connect-${userId}` })
  const catalog = await refreshCalendarCatalog(ctx, userId, { key: `catalog-${userId}` }, provider)
  await saveCalendarSelection(ctx, userId, { expectedSelectionRevision: catalog.selectionRevision, calendarIds: catalog.sources.map(s => s.id) }, { key: `select-${userId}` })
  const selected = (await readCalendarConnection(ctx.db, userId))
  await syncCalendar(ctx, userId, { expectedSelectionRevision: selected.selectionRevision }, { key: `sync-${userId}` }, provider, 'full')
  return { connected, catalog }
}

describe('example calendar for demo accounts', () => {
  it('imports the account\'s preset schedule through the normal connect → list → select → import steps', async () => {
    const { ctx, db, sqlite } = (await setup())
    const { connected, catalog } = await importExample(ctx, db, minjun)
    expect(connected.status).toBe('needs_refresh')
    expect(catalog.sources).toHaveLength(1)
    expect(catalog.sources[0]).toMatchObject({ id: `mock-${minjun}`, selected: false })
    expect(catalog.sources[0].name).toContain('김민준')
    const presets = ((await sqlite.prepare("SELECT count(*) n FROM events WHERE user_id=? AND source='seed'").get(minjun)) as { n: number }).n
    const imported = (await sqlite.prepare('SELECT count(*) n FROM imported_events').get()) as { n: number }
    expect(presets).toBeGreaterThan(20)
    expect(imported.n).toBeGreaterThanOrEqual(presets - 1)               // everything inside the fetched window (the edge-day padding may add or skip one)
    const view = (await listCalendarItems(ctx, minjun, NOW, NOW + 7 * 86_400_000))
    expect(view).toMatchObject({ connected: true, provider: 'mock' })
    expect(view.items.some(i => i.title === '팀 업무')).toBe(true)
  })
  it('gives each account its own schedule and never another account\'s', async () => {
    const { ctx, db } = (await setup())
    await importExample(ctx, db, minjun); await importExample(ctx, db, jiho)
    const titles = async (id: string) => new Set((await listCalendarItems(ctx, id, NOW, NOW + 14 * 86_400_000)).items.map(i => i.title))
    expect((await titles(jiho)).has('수업')).toBe(true)
    expect((await titles(minjun)).has('수업')).toBe(false)
    expect((await titles(minjun)).has('팀 업무')).toBe(true)
    expect((await titles(jiho)).has('팀 업무')).toBe(false)
  })
  it('does not turn app-made entries into calendar events', async () => {
    const { ctx, db, sqlite } = (await setup())
    ;(await sqlite.prepare("INSERT INTO events(id,user_id,title,start_at,end_at,location_kind,place_ref,source,request_id) VALUES ('manual',?,'직접 추가','2026-10-07T01:00:00.000Z','2026-10-07T02:00:00.000Z','online',NULL,'manual',NULL)").run(minjun))
    await importExample(ctx, db, minjun)
    expect((await sqlite.prepare("SELECT count(*) n FROM imported_events WHERE title='직접 추가'").get())).toEqual({ n: 0 })
  })
  it('is refused outside demo mode and never creates a connection there', async () => {
    const { ctx, sqlite } = (await setup('real'))
    await expect(connectMockCalendar(ctx, minjun, { key: 'x' })).rejects.toMatchObject({ code: 'forbidden' })
    expect((await sqlite.prepare('SELECT count(*) n FROM calendar_connections').get())).toEqual({ n: 0 })
  })
  it('replays the same request, ignores a second connect while connected, and can reconnect after disconnecting', async () => {
    const { ctx, db, sqlite } = (await setup())
    const first = await connectMockCalendar(ctx, minjun, { key: 'k' })
    expect(await connectMockCalendar(ctx, minjun, { key: 'k' })).toEqual(first)
    await connectMockCalendar(ctx, minjun, { key: 'other-key' })
    expect((await sqlite.prepare('SELECT count(*) n FROM calendar_connections').get())).toEqual({ n: 1 })
    await importExample(ctx, db, minjun)
    const view = (await readCalendarConnection(ctx.db, minjun))
    await disconnectCalendar(ctx, minjun, { expectedSelectionRevision: view.selectionRevision }, { key: 'bye' })
    expect((await listCalendarItems(ctx, minjun, NOW, NOW + 86_400_000)).connected).toBe(false)
    expect((await connectMockCalendar(ctx, minjun, { key: 'again' })).status).toBe('needs_refresh')
  })

  describe('confirmed meetings that now clash with my own calendar', () => {
    /** An accepted request from `client` to 김민준, with the confirmed-meeting event on `user`'s own calendar. */
    const booking = async (sqlite: Awaited<ReturnType<typeof setup>>['sqlite'], user: string, request: string, from: string, to: string) => {
      const place = ((await sqlite.prepare('SELECT id FROM places WHERE host_id=? LIMIT 1').get(minjun)) as { id: string }).id
      const type = ((await sqlite.prepare('SELECT id FROM meeting_types WHERE host_id=? LIMIT 1').get(minjun)) as { id: string }).id
      if (!(await sqlite.prepare('SELECT 1 FROM requests WHERE id=?').get(request)))
        (await sqlite.prepare("INSERT INTO requests(id,client_id,host_id,start_at,end_at,place_id,meeting_type_id,message,status,created_at) VALUES (?,?,?,?,?,?,?,'m','accepted',?)").run(request, jiho, minjun, from, to, place, type, from))
      ;(await sqlite.prepare("INSERT INTO events(id,user_id,title,start_at,end_at,location_kind,place_ref,source,request_id) VALUES (?,?,'미팅 · 30분 커피챗',?,?,'online',NULL,'booking',?)").run(`${request}-${user}`, user, from, to, request))
    }
    // 김민준 works 10–12 and 14–17 on Mondays in the preset schedule (2026-10-05 is a Monday).
    const monday = (from: string, to: string) => [`2026-10-05T${from}:00+09:00`, `2026-10-05T${to}:00+09:00`].map(t => new Date(t).toISOString())

    it('reports a meeting only when an event on my own calendar overlaps it, and only after the calendar is connected', async () => {
      const { ctx, db, sqlite } = (await setup())
      ;(await booking(sqlite, minjun, 'clash', ...(monday('10:30', '11:00') as [string, string])))
      ;(await booking(sqlite, minjun, 'free', ...(monday('12:00', '12:30') as [string, string])))
      expect((await conflictingRequestIds(ctx, minjun))).toEqual([])                // nothing external to clash with yet
      await importExample(ctx, db, minjun)
      expect((await conflictingRequestIds(ctx, minjun))).toEqual(['clash'])
    })
    it('ignores meetings that are already over', async () => {
      const { ctx, db, sqlite } = (await setup())
      // A meeting that is over, with a calendar entry that really overlaps it: it must not be raised as a clash any more.
      ;(await sqlite.prepare("INSERT INTO events(id,user_id,title,start_at,end_at,location_kind,place_ref,source,request_id) VALUES ('then',?,'그때 일정','2026-09-30T00:30:00.000Z','2026-09-30T02:30:00.000Z','online',NULL,'seed',NULL)").run(minjun))
      ;(await booking(sqlite, minjun, 'past', '2026-09-30T01:00:00.000Z', '2026-09-30T02:00:00.000Z'))
      await importExample(ctx, db, minjun)
      expect((await conflictingRequestIds(ctx, minjun))).toEqual([])
    })
    it('judges each participant by their own calendar only, so one person\'s clash is never visible to the other', async () => {
      const { ctx, db, sqlite } = (await setup())
      const [from, to] = monday('11:15', '11:45') as [string, string]       // 김민준 is busy 10–12; 박지호 is free after his 10–11 class
      ;(await booking(sqlite, minjun, 'shared', from, to)); (await booking(sqlite, jiho, 'shared', from, to))
      await importExample(ctx, db, minjun); await importExample(ctx, db, jiho)
      expect((await conflictingRequestIds(ctx, minjun))).toEqual(['shared'])
      expect((await conflictingRequestIds(ctx, jiho))).toEqual([])
    })
  })
})

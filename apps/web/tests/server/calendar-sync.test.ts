import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixture, event, NOW } from '../fixtures/google-calendar-provider'
import { syncCalendar, refreshCalendarCatalog, saveCalendarSelection, disconnectCalendar, continueWithoutCalendar, readCalendarConnection, readScheduleSources } from '@/server/services/calendar-sync'
import { GoogleCalendarProvider } from '@/server/providers/google-calendar'
import { calendarConnectionViewSchema } from '@/contracts/calendar'

const fixtures: Awaited<ReturnType<typeof fixture>>[] = []
const setup = async () => { const f = (await fixture()); fixtures.push(f); return f }
afterEach(() => { fixtures.splice(0).forEach(f => f.close()); vi.useRealTimers() })
const sync = async (f: Awaited<ReturnType<typeof fixture>>, key = 'sync-1', scope: 'full' | 'future' = 'full') => (await syncCalendar(f.ctx, 'owner', { expectedSelectionRevision: 0 }, { key }, f.port, scope))

describe('calendar atomic snapshots', () => {
  it('collects every selected calendar and every page, preserves repeats and maps schedule scope to future', async () => {
    const f = (await setup())
    f.respond(url => url.pathname.endsWith('/freeBusy') ? { calendars: { b: { busy: [{ start: '2026-10-05T04:00:00Z', end: '2026-10-05T05:00:00Z' }] } } }
      : url.searchParams.has('pageToken') ? { items: [event('second', { recurringEventId: 'series', originalStartTime: { dateTime: '2026-10-04T01:00:00Z' }, iCalUID: 'uid' })] }
      : { items: [event('first')], nextPageToken: 'next' })
    const full = await sync(f)
    expect((await f.sqlite.prepare('SELECT count(*) n FROM imported_events').get())).toEqual({ n: 2 })
    expect((await f.sqlite.prepare('SELECT count(*) n FROM imported_busy_intervals').get())).toEqual({ n: 1 })
    const req = f.requests[0]
    expect(req.url.pathname).toContain('a%40example.test/events')
    expect(req.url.searchParams.get('singleEvents')).toBe('true')
    expect(req.url.searchParams.has('syncToken')).toBe(false)
    expect(req.url.searchParams.get('timeMin')).toBe('2026-08-09T12:00:00.000Z')
    expect(req.init?.headers).toMatchObject({ Authorization: 'Bearer fixture-access' })
    f.advance(1000)
    f.respond(url => url.pathname.endsWith('/freeBusy') ? { calendars: { b: { busy: [] } } } : { items: [] })
    const future = await sync(f, 'sync-2', 'future')
    expect(future.scope).toBe('future')
    const view = (await readCalendarConnection(f.ctx.db, 'owner'))
    expect(calendarConnectionViewSchema.safeParse(view).success).toBe(true)
    expect(view.analysis?.snapshotId).toBe(full.snapshotId)
    expect(view.analysis?.completedAt).toBe(NOW)
    expect(view.schedule?.snapshotId).toBe(future.snapshotId)
    expect((await readScheduleSources(f.ctx.db, 'owner'))).toEqual([])
    expect((await f.sqlite.prepare('SELECT scope FROM calendar_snapshots WHERE id=?').get(future.snapshotId))).toEqual({ scope: 'schedule' })
  })
  it('does not refetch or add snapshots on operation replay', async () => {
    const f = (await setup()), first = await sync(f), calls = f.requests.length
    expect(await sync(f)).toEqual(first)
    expect(f.requests).toHaveLength(calls)
    expect((await f.sqlite.prepare('SELECT count(*) n FROM calendar_snapshots').get())).toEqual({ n: 1 })
  })
  it.each([null, { calendars: {} }, { calendars: { b: { errors: [{ reason: 'forbidden' }], busy: [] } } }])('preserves active data for invalid/incomplete freebusy: %j', async bad => {
    const f = (await setup()), previous = await sync(f)
    f.respond(url => url.pathname.endsWith('/freeBusy') ? bad : { items: [] })
    await expect(sync(f, 'bad')).rejects.toMatchObject({ code: 'calendar_fetch_failed' })
    expect((await readCalendarConnection(f.ctx.db, 'owner')).schedule?.snapshotId).toBe(previous.snapshotId)
    expect((await f.sqlite.prepare('SELECT count(*) n FROM calendar_snapshots').get())).toEqual({ n: 1 })
  })
  it('rejects scopes/errors without converting permission failure to a successful empty snapshot', async () => {
    const f = (await setup()), old = await sync(f)
    f.respond(() => new Response('{}', { status: 403 }))
    await expect(sync(f, 'denied')).rejects.toMatchObject({ code: 'calendar_reconnect_required' })
    expect((await readCalendarConnection(f.ctx.db, 'owner'))).toMatchObject({ status: 'reconnect_required', schedule: { snapshotId: old.snapshotId } })
  })
  it('selection changes fence an in-flight response and immediately hide removed sources', async () => {
    const f = (await setup()); await sync(f)
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    f.respond(async url => { await pending; return url.pathname.endsWith('/freeBusy') ? { calendars: { b: { busy: [] } } } : { items: [event()] } })
    const work = sync(f, 'late')
    await saveCalendarSelection(f.ctx, 'owner', { expectedSelectionRevision: 0, calendarIds: ['b'] }, { key: 'selection' })
    release()
    await expect(work).rejects.toMatchObject({ code: 'calendar_snapshot_changed' })
    expect((await readScheduleSources(f.ctx.db, 'owner'))).toEqual([])
    expect((await f.sqlite.prepare('SELECT count(*) n FROM imported_events').get())).toEqual({ n: 0 })
    expect((await readCalendarConnection(f.ctx.db, 'owner')).status).toBe('needs_refresh')
  })
  it('serializes different sync operations on a connection', async () => {
    const f = (await setup()); let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    f.respond(async url => { await pending; return url.pathname.endsWith('/freeBusy') ? { calendars: { b: { busy: [] } } } : { items: [] } })
    const work = sync(f)
    await expect(sync(f, 'other-sync')).rejects.toMatchObject({ code: 'calendar_busy' })
    release(); await work
  })
  it('drops snapshots nothing refers to after a later import, keeping the one an analysis used', async () => {
    const f = (await setup())
    await sync(f, 'first'); await sync(f, 'second'); await sync(f, 'third', 'future')
    expect(await f.sqlite.prepare('SELECT count(*) n FROM calendar_snapshots').get()).toEqual({ n: 2 })   // current analysis + current schedule
    const analysed = (await readCalendarConnection(f.ctx.db, 'owner')).analysis!.snapshotId
    await f.sqlite.prepare("INSERT INTO analysis_runs(id,user_id,snapshot_id,annotation_revision,from_at,to_at,status,coverage_json,summary_json) VALUES ('run','owner',?,0,1,2,'complete','{}','{}')").run(analysed)
    await sync(f, 'fourth')
    const left = (await f.sqlite.prepare('SELECT id FROM calendar_snapshots ORDER BY id').all()).map((r: { id: string }) => r.id)
    expect(left).toContain(analysed)                                   // an analysis still refers to it
    expect(left).toHaveLength(2)
    expect(await f.sqlite.prepare('SELECT count(*) n FROM imported_events WHERE snapshot_id NOT IN (SELECT id FROM calendar_snapshots)').get()).toEqual({ n: 0 })
  })
  it('leaves zero-length entries out instead of failing the import', async () => {
    const f = (await setup())
    f.respond(url => url.pathname.endsWith('/freeBusy') ? { calendars: { b: { busy: [] } } }
      : { items: [event('marker', { start: { dateTime: '2026-10-06T00:00:00Z' }, end: { dateTime: '2026-10-06T00:00:00Z' } }), event('real')] })
    await sync(f)
    expect((await f.sqlite.prepare('SELECT provider_event_id id FROM imported_events').all()).map((r: { id: string }) => r.id)).toEqual(['real'])
  })
  it('still refuses an entry that ends before it starts', async () => {
    const f = (await setup())
    f.respond(url => url.pathname.endsWith('/freeBusy') ? { calendars: { b: { busy: [] } } }
      : { items: [event('broken', { start: { dateTime: '2026-10-06T02:00:00Z' }, end: { dateTime: '2026-10-06T01:00:00Z' } })] })
    await expect(sync(f)).rejects.toMatchObject({ code: 'calendar_fetch_failed' })
  })
  it('fails the entire collection on a page or item budget breach', async () => {
    const f = (await setup())
    f.respond(url => ({ items: [], nextPageToken: String(Number(url.searchParams.get('pageToken') ?? 0) + 1) }))
    await expect(sync(f)).rejects.toMatchObject({ code: 'calendar_limit_exceeded' })
    expect(f.requests).toHaveLength(100)
    expect((await readCalendarConnection(f.ctx.db, 'owner')).schedule).toBeNull()
    f.respond(() => ({ items: Array.from({ length: 50001 }, (_, i) => event(String(i))) }))
    await expect(sync(f, 'too-many')).rejects.toMatchObject({ code: 'calendar_limit_exceeded' })
  })
  it('fences timed out work even if the transport ignores abort', async () => {
    vi.useFakeTimers(); const f = (await setup())
    f.respond(() => new Promise(() => {}))
    const result = expect(sync(f)).rejects.toMatchObject({ code: 'operation_timeout' })
    await vi.advanceTimersByTimeAsync(30001); await result
    expect((await readCalendarConnection(f.ctx.db, 'owner')).schedule).toBeNull()
  })
  it('does not activate after the sixty second collection budget', async () => {
    const f = (await setup()); f.respond(() => { f.advance(60001); return { items: [] } })
    await expect(sync(f)).rejects.toMatchObject({ code: 'operation_timeout' })
    expect((await readCalendarConnection(f.ctx.db, 'owner')).schedule).toBeNull()
  })
  it('catalog paging is atomic and preserves selections', async () => {
    const f = (await setup())
    f.respond(url => url.searchParams.has('pageToken') ? { items: [{ id: 'b', summary: 'Busy', accessRole: 'freeBusyReader' }] }
      : { items: [{ id: 'a@example.test', summary: 'Renamed', timeZone: 'UTC', accessRole: 'reader' }], nextPageToken: 'next' })
    const view = await refreshCalendarCatalog(f.ctx, 'owner', { key: 'catalog' }, f.port)
    expect(view.sources).toHaveLength(2)
    expect(view.sources[0]).toMatchObject({ name: 'Renamed', selected: true })
    f.respond(() => null)
    await expect(refreshCalendarCatalog(f.ctx, 'owner', { key: 'bad-catalog' }, f.port)).rejects.toMatchObject({ code: 'calendar_fetch_failed' })
    expect((await readCalendarConnection(f.ctx.db, 'owner')).sources).toHaveLength(2)
  })
  it('requires an explicit use decision after removing all selections, and disallows silently bypassing an outage', async () => {
    const f = (await setup())
    await expect(continueWithoutCalendar(f.ctx, 'owner', { expectedRevision: 0, choice: 'continue_without_calendar' }, { key: 'bypass' })).rejects.toMatchObject({ code: 'calendar_decision_required' })
    await saveCalendarSelection(f.ctx, 'owner', { expectedSelectionRevision: 0, calendarIds: [] }, { key: 'none' })
    const view = (await readCalendarConnection(f.ctx.db, 'owner'))
    expect(view.status).toBe('decision_required')
    await continueWithoutCalendar(f.ctx, 'owner', { expectedRevision: view.revision, choice: 'continue_without_calendar' }, { key: 'manual' })
    expect((await readCalendarConnection(f.ctx.db, 'owner')).status).toBe('manual')
  })
  it('disconnect leaves a tombstone, removes source references/messages and preserves user data', async () => {
    const f = (await setup()); const snapshot = await sync(f)
    const imported = (await f.sqlite.prepare('SELECT id FROM imported_events').get()) as { id: string }
    ;(await f.sqlite.prepare(`INSERT INTO analysis_runs(id,user_id,snapshot_id,annotation_revision,from_at,to_at,status,coverage_json,summary_json) VALUES ('analysis','owner',?,0,1,2,'complete','{}','{}')`).run(snapshot.snapshotId))
    ;(await f.sqlite.prepare(`INSERT INTO analysis_evidence(id,analysis_id,imported_event_id,aggregation_rule_json,observation_count,from_at,to_at) VALUES ('evidence','analysis',?,'{}',1,1,2)`).run(imported.id))
    ;(await f.sqlite.exec(`INSERT INTO profile_versions(user_id,version,values_json,origin) VALUES ('owner',1,'{}','manual');
      INSERT INTO profile_drafts(id,user_id,values_json,topic_confirmations_json,analysis_id,updated_at) VALUES ('draft','owner','{}','{}','analysis',1);
      INSERT INTO draft_messages(id,draft_id,operation_id,role,content,proposal_json,evidence_id,created_at) SELECT 'assistant','draft',id,'assistant','Private source quote','{}','evidence',1 FROM mutation_operations LIMIT 1;
      INSERT INTO draft_messages(id,draft_id,operation_id,role,content,created_at) SELECT 'user-msg','draft',id,'user','My words',1 FROM mutation_operations LIMIT 1;
      INSERT INTO events(id,user_id,title,start_at,end_at,location_kind,source) VALUES ('app','owner','App','2026-10-05T01:00:00Z','2026-10-05T02:00:00Z','none','manual');`))
    await disconnectCalendar(f.ctx, 'owner', { expectedSelectionRevision: 0 }, { key: 'disconnect' })
    expect((await f.sqlite.prepare('SELECT status,refresh_token_ciphertext,analysis_snapshot_id,schedule_snapshot_id FROM calendar_connections').get())).toEqual({ status: 'disconnected', refresh_token_ciphertext: null, analysis_snapshot_id: null, schedule_snapshot_id: null })
    expect((await f.sqlite.prepare('SELECT count(*) n FROM imported_events').get())).toEqual({ n: 0 })
    expect((await f.sqlite.prepare('SELECT count(*) n FROM analysis_runs').get())).toEqual({ n: 0 })
    expect((await f.sqlite.prepare("SELECT content,proposal_json,evidence_id FROM draft_messages WHERE id='assistant'").get())).toEqual({ content: '근거 제거됨', proposal_json: null, evidence_id: null })
    expect((await f.sqlite.prepare("SELECT content FROM draft_messages WHERE id='user-msg'").get())).toEqual({ content: 'My words' })
    expect((await f.sqlite.prepare('SELECT count(*) n FROM profile_versions').get())).toEqual({ n: 1 })
    expect((await f.sqlite.prepare('SELECT count(*) n FROM events').get())).toEqual({ n: 1 })
    expect((await readCalendarConnection(f.ctx.db, 'owner')).status).toBe('decision_required')
  })
  it('retries transient HTTP errors once and never returns raw provider errors', async () => {
    let calls = 0
    const provider = new GoogleCalendarProvider({ accessToken: async () => 'secret', fetch: async () => ++calls === 1 ? new Response('private failure', { status: 503 }) : Response.json({ items: [] }) })
    expect(await provider.listCalendars('connection', {})).toEqual({ items: [] })
    expect(calls).toBe(2)
  })
})

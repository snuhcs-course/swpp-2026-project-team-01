import {it,expect} from 'vitest'
import {fixture,event} from '../fixtures/google-calendar-provider'
import {syncCalendar,readScheduleSources} from '@/server/services/calendar-sync'
import {listImportedEvents,saveAnnotation,getImportedEventDetail} from '@/server/services/annotations'
import {saveCalendarSelection} from '@/server/services/calendar-sync'
it('keeps user classification across location-only changes and invalidates changed location',async()=>{
 const f=(await fixture());try{
  await syncCalendar(f.ctx,'owner',{expectedSelectionRevision:0},{key:'sync'},f.port)
  const e=(await listImportedEvents(f.ctx,'owner'))[0]
  await saveAnnotation(f.ctx,'owner',{eventId:e.eventId,expectedRevision:0,sourceFingerprint:e.sourceFingerprint,patch:{locationKind:'office',classification:'personal'}},{key:'annotate'})
  expect((await readScheduleSources(f.ctx.db,'owner'))[0]).toMatchObject({confirmedLocation:{kind:'office'},userClassification:'personal'})
  f.respond(url=>url.pathname.endsWith('/freeBusy')?{calendars:{b:{busy:[]}}}:{items:[event('event',{location:'New room'})]})
  await syncCalendar(f.ctx,'owner',{expectedSelectionRevision:0},{key:'sync2'},f.port)
  const source=(await readScheduleSources(f.ctx.db,'owner'))[0]
  expect(source.confirmedLocation).toBeUndefined();expect(source.userClassification).toBe('personal')
  await expect(saveAnnotation(f.ctx,'other',{eventId:e.eventId,expectedRevision:1,sourceFingerprint:e.sourceFingerprint,patch:{}},{key:'foreign'})).rejects.toMatchObject({code:'not_found'})
 }finally{f.close()}
})

const allDay = (id: string) => event(id, { summary: '종일 행사', start: { date: '2026-10-06' }, end: { date: '2026-10-08' } })
const respondWith = (f: Awaited<ReturnType<typeof fixture>>, items: unknown[]) => f.respond(url => url.pathname.endsWith('/freeBusy') ? { calendars: { b: { busy: [] } } } : { items })

it('exposes the calendar\'s own all-day facts instead of leaving the client to guess', async () => {
  const f = (await fixture()); try {
    respondWith(f, [event('timed'), allDay('allday')])
    await syncCalendar(f.ctx, 'owner', { expectedSelectionRevision: 0 }, { key: 'sync' }, f.port)
    const views = (await listImportedEvents(f.ctx, 'owner'))
    const day = views.find(v => v.title === '종일 행사')!, timed = views.find(v => v.title === 'Planning')!
    expect(day).toMatchObject({ allDay: true, startDate: '2026-10-06', endDate: '2026-10-08' })
    expect(typeof day.timezone).toBe('string')
    expect(timed).toMatchObject({ allDay: false, startDate: null, endDate: null })
  } finally { f.close() }
})

it('shows the newest AI proposal for the current content and rules, without overriding the user\'s value', async () => {
  const f = (await fixture()); try {
    await syncCalendar(f.ctx, 'owner', { expectedSelectionRevision: 0 }, { key: 'sync' }, f.port)
    const view = async () => (await listImportedEvents(f.ctx, 'owner'))[0]
    expect((await view()).aiClassification).toBeNull()
    const src = (await f.sqlite.prepare("SELECT c.id connection_id, e.calendar_id, e.provider_event_id, e.content_fingerprint FROM imported_events e JOIN calendar_connections c ON c.analysis_snapshot_id=e.snapshot_id").get()) as Record<string, string>
    const put = async (id: string, model: string, version: number, label: string) => (await f.sqlite.prepare('INSERT INTO event_classifications(id,user_id,connection_id,calendar_id,provider_event_id,content_fingerprint,model_version,schema_version,proposal_json) VALUES (?,?,?,?,?,?,?,?,?)'))
      .run(id, 'owner', src.connection_id, src.calendar_id, src.provider_event_id, src.content_fingerprint, model, version, JSON.stringify({ classification: label }))
    ;(await put('old-rules', 'm1', 1, 'business'))
    expect((await view()).aiClassification).toBeNull()               // proposals made under older labelling rules are ignored
    ;(await put('first', 'm1', 2, 'business')); (await put('second', 'm2', 2, 'personal'))
    expect((await view()).aiClassification).toBe('personal')         // newest wins, whichever model produced it
    expect((await view()).classification).toBe('unknown')            // a suggestion is not a confirmation
    await saveAnnotation(f.ctx, 'owner', { eventId: (await view()).eventId, expectedRevision: 0, sourceFingerprint: (await view()).sourceFingerprint, patch: { classification: 'business' } }, { key: 'confirm' })
    expect((await view())).toMatchObject({ classification: 'business', aiClassification: 'personal' })
    respondWith(f, [event('event', { summary: 'Renamed' })])  // changed content: the old proposal no longer describes it
    await syncCalendar(f.ctx, 'owner', { expectedSelectionRevision: 0 }, { key: 'sync2' }, f.port)
    expect((await listImportedEvents(f.ctx, 'owner'))[0].aiClassification).toBeNull()
  } finally { f.close() }
})

it('gives the owner what the source provided, next to their own supplement, and nothing to anyone else', async () => {
  const f = (await fixture()); try {
    respondWith(f, [event('meet', { summary: '온라인 미팅', location: 'Room A', hangoutLink: 'https://meet.example/x', status: 'tentative' })])
    await syncCalendar(f.ctx, 'owner', { expectedSelectionRevision: 0 }, { key: 'sync' }, f.port)
    const id = (await listImportedEvents(f.ctx, 'owner'))[0].eventId
    const detail = await getImportedEventDetail(f.ctx, 'owner', id)
    expect(detail.detail).toMatchObject({ calendarName: 'A', status: 'tentative', busy: true, providedLocation: 'Room A', onlineLink: true })
    await saveAnnotation(f.ctx, 'owner', { eventId: id, expectedRevision: 0, sourceFingerprint: detail.sourceFingerprint, patch: { classification: 'business', locationKind: 'office' } }, { key: 'mine' })
    const after = await getImportedEventDetail(f.ctx, 'owner', id)
    expect(after).toMatchObject({ classification: 'business', locationKind: 'office' })
    expect(after.detail.providedLocation).toBe('Room A')                 // the original is untouched by the supplement
    await expect(getImportedEventDetail(f.ctx, 'other', id)).rejects.toMatchObject({ code: 'not_found' })
    await saveCalendarSelection(f.ctx, 'owner', { expectedSelectionRevision: 0, calendarIds: ['b'] }, { key: 'deselect' })
    await expect(getImportedEventDetail(f.ctx, 'owner', id)).rejects.toMatchObject({ code: 'not_found' })
  } finally { f.close() }
})

import { afterEach, describe, expect, it } from 'vitest'
import { fixture, event } from '../fixtures/google-calendar-provider'
import { syncCalendar } from '@/server/services/calendar-sync'
import { createDraft } from '@/server/services/profile'
import { analyzeDraft } from '@/server/services/analysis'
import { hostSuggestions } from '@/server/services/host-suggestions'
import { addPlace } from '@/server/repos/hosting'
import type { ChatClient } from '@/llm/ollama'

const fixtures: Awaited<ReturnType<typeof fixture>>[] = []
afterEach(() => { fixtures.splice(0).forEach(f => f.close()) })
const at = (day: number, hours = 1) => ({ start: { dateTime: `2026-09-${day}T01:00:00Z` }, end: { dateTime: `2026-09-${day}T0${1 + hours}:00:00Z` } })
/** Labels the first three entries business and the rest personal. */
const model: ChatClient = { chat: async messages => {
  const items = JSON.parse(messages[1].content) as { i: number }[]
  return JSON.stringify({ business: items.filter(e => e.i < 3).map(e => e.i), personal: items.filter(e => e.i >= 3).map(e => e.i), unknown: [] })
} }

describe('host setup suggestions', () => {
  it('is unavailable before any calendar import', async () => {
    const f = await fixture(); fixtures.push(f)
    expect(await hostSuggestions(f.ctx.db, 'owner')).toEqual({ available: false, basedOn: 0, places: [], meetingTypes: [] })
  })

  it('reads repeated places and lengths from AI-labelled business events only, and drops what the host adds', async () => {
    const f = await fixture(); fixtures.push(f)
    f.respond(url => url.pathname.endsWith('/freeBusy') ? { calendars: { b: { busy: [] } } } : { items: [
      event('e1', { summary: 'IC 회의', location: '역삼 오피스', ...at(14) }),
      event('e2', { summary: '포트폴리오 리뷰', location: '역삼 오피스', ...at(15) }),
      event('e3', { summary: '딜 미팅', location: '판교 카페', ...at(16) }),
      event('e4', { summary: '병원', location: 'OO의원', ...at(17) }),
      event('e5', { summary: '병원', location: 'OO의원', ...at(18) }),
    ] })
    await syncCalendar(f.ctx, 'owner', { expectedSelectionRevision: 0 }, { key: 'sync' }, f.port, 'full')
    expect((await hostSuggestions(f.ctx.db, 'owner')).basedOn).toBe(0)   // nothing labelled business yet
    f.ctx.llm = model
    const draft = await createDraft(f.ctx, 'owner', { purpose: 'onboarding' }, { key: 'draft' })
    await analyzeDraft(f.ctx, 'owner', { draftId: draft.draftId, expectedRevision: draft.revision }, { key: 'a1' })
    const s = await hostSuggestions(f.ctx.db, 'owner')
    expect(s).toEqual({ available: true, basedOn: 3, places: [{ kind: 'office_near', name: '역삼 오피스', count: 2 }], meetingTypes: [{ name: '60분 미팅', durationMin: 60, count: 3 }] })
    await addPlace(f.ctx.db, 'owner', { kind: 'office_near', name: '역삼 오피스' })
    expect((await hostSuggestions(f.ctx.db, 'owner')).places).toEqual([])
  })
})

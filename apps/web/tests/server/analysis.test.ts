import { afterEach, describe, expect, it } from 'vitest'
import { fixture, event } from '../fixtures/google-calendar-provider'
import { syncCalendar } from '@/server/services/calendar-sync'
import { createDraft } from '@/server/services/profile'
import { analyzeDraft } from '@/server/services/analysis'
import { onboardingTurn } from '@/server/services/onboarding'
import type { ChatClient } from '@/llm/ollama'

const fixtures: Awaited<ReturnType<typeof fixture>>[] = []
afterEach(() => { fixtures.splice(0).forEach(f => f.close()) })
const at = (day: number) => ({ start: { dateTime: `2026-09-${day}T01:00:00Z` }, end: { dateTime: `2026-09-${day}T02:00:00Z` } })
async function setup() {
  const f = (await fixture()); fixtures.push(f)
  f.respond(url => url.pathname.endsWith('/freeBusy') ? { calendars: { b: { busy: [] } } }
    : { items: [event('e1', { summary: 'IC 회의', ...at(14) }), event('e2', { summary: '헬스장', ...at(15) }), event('e3', { summary: '저녁 식사 - 김대표', ...at(16) }), event('e4', { summary: '포트폴리오 리뷰', ...at(17) })] })
  await syncCalendar(f.ctx, 'owner', { expectedSelectionRevision: 0 }, { key: 'sync' }, f.port, 'full')
  const draft = await createDraft(f.ctx, 'owner', { purpose: 'onboarding' }, { key: 'draft' })
  return { f, draft }
}
/** Answers by position: first two business/personal, the rest unknown. Records every call. */
function model(calls: { items: number }[]): ChatClient {
  return { chat: async messages => {
    const items = JSON.parse(messages[1].content) as { i: number }[]; calls.push({ items: items.length })
    return JSON.stringify({ business: items.filter(e => e.i === 0).map(e => e.i), personal: items.filter(e => e.i === 1).map(e => e.i), unknown: items.filter(e => e.i > 1).map(e => e.i) })
  } }
}

describe('history analysis', () => {
  it('classifies once, stores the current cache version, and reuses it on the next analysis', async () => {
    const { f, draft } = await setup(), calls: { items: number }[] = []
    f.ctx.llm = model(calls)
    const first = await analyzeDraft(f.ctx, 'owner', { draftId: draft.draftId, expectedRevision: draft.revision }, { key: 'a1' })
    expect(calls).toEqual([{ items: 4 }])
    expect((await f.sqlite.prepare('SELECT DISTINCT schema_version v FROM event_classifications').all())).toEqual([{ v: 2 }])
    expect(first.messages.at(-1)?.content).toContain('업무 1건, 개인 1건, 확인 필요 2건')
    expect(first.messages.at(-1)?.content).not.toContain('분류하지 못한')
    await analyzeDraft(f.ctx, 'owner', { draftId: draft.draftId, expectedRevision: first.revision }, { key: 'a2' })
    expect(calls).toHaveLength(1)
  })
  it('answers a question about the analysis from its results, and a new analysis starts the conversation over', async () => {
    const { f, draft } = await setup()
    f.ctx.llm = model([])
    const analysed = await analyzeDraft(f.ctx, 'owner', { draftId: draft.draftId, expectedRevision: draft.revision }, { key: 'a1' })
    const asked = await onboardingTurn(f.ctx, 'owner', { draftId: draft.draftId, expectedRevision: analysed.revision, text: '내 근무시간은 어떻게 생각했어' }, { key: 't1' })
    const reply = asked.messages.at(-1)!.content
    expect(reply).toContain('업무로 분류된 일정이 1건뿐이라 근무시간은 짐작하기 어려워요')
    expect(reply).not.toContain('해석하지 못했어요')
    expect(asked.values).toEqual(analysed.values)                       // a question changes no setting
    expect(asked.messages).toHaveLength(3)
    const again = await analyzeDraft(f.ctx, 'owner', { draftId: draft.draftId, expectedRevision: asked.revision }, { key: 'a2' })
    expect(again.messages).toHaveLength(1)
    expect(again.messages[0].content).toContain('지난 8주 일정')
  })
  it('does not reuse a proposal cached under older labelling rules', async () => {
    const { f, draft } = await setup(), calls: { items: number }[] = []
    f.ctx.llm = model(calls)
    const source = (await f.sqlite.prepare("SELECT c.id connection_id, e.calendar_id, e.provider_event_id, e.content_fingerprint FROM imported_events e JOIN calendar_connections c ON c.analysis_snapshot_id=e.snapshot_id WHERE e.provider_event_id='e3'").get()) as Record<string, string>
    ;(await f.sqlite.prepare("INSERT INTO event_classifications(id,user_id,connection_id,calendar_id,provider_event_id,content_fingerprint,model_version,schema_version,proposal_json) VALUES ('old','owner',?,?,?,?,'unconfigured',1,?)"))
      .run(source.connection_id, source.calendar_id, source.provider_event_id, source.content_fingerprint, JSON.stringify({ classification: 'business' }))
    await analyzeDraft(f.ctx, 'owner', { draftId: draft.draftId, expectedRevision: draft.revision }, { key: 'a1' })
    expect(calls).toEqual([{ items: 4 }])
    expect((await f.sqlite.prepare("SELECT proposal_json p FROM event_classifications WHERE provider_event_id='e3' AND schema_version=2").get())).toEqual({ p: JSON.stringify({ classification: 'unknown' }) })
  })
  it('reports events the AI could not classify separately from ones it judged unknown', async () => {
    const { f, draft } = await setup()
    f.ctx.llm = { chat: async () => { throw new Error('offline') } }
    const result = await analyzeDraft(f.ctx, 'owner', { draftId: draft.draftId, expectedRevision: draft.revision }, { key: 'a1' })
    expect(result.messages.at(-1)?.content).toContain('AI가 분류하지 못한 일정 4건')
    expect((await f.sqlite.prepare('SELECT count(*) n FROM event_classifications').get())).toEqual({ n: 0 })
  })
})

/**
 * Smoke test: a synthetic venture-capital investor calendar goes through the real pipeline
 * (sync -> normalize -> classification AI -> analysis -> onboarding AI -> confirmed profile -> bookable slots).
 * Uses a throwaway in-process Postgres (PGlite, built from supabase/migrations) and the real Ollama client. Run: npx tsx --env-file=.env scripts/eval-onboarding.ts
 */
import { run, all } from '../src/server/db/client'
import { emptyDb } from '../tests/server/helpers'
import { makeContext } from '../src/server/runtime'
import { GoogleCalendarProvider } from '../src/server/providers/google-calendar'
import { syncCalendar } from '../src/server/services/calendar-sync'
import { createDraft, patchDraft, confirmProfile, getDraft } from '../src/server/services/profile'
import { analyzeDraft } from '../src/server/services/analysis'
import { onboardingTurn } from '../src/server/services/onboarding'
import { computeBookable } from '../src/server/services/schedule'
import { OllamaClient, ollamaConfigFromEnv } from '../src/llm/ollama'
import { kstParts } from '../src/core/time'
import { vcCalendar, googleEvent } from '../tests/fixtures/onboarding-scenarios'

process.env.LOG_LEVEL ??= 'silent' // keep stdout a single JSON report; set LOG_LEVEL=info to see per-batch classification logs
const config = ollamaConfigFromEnv()
if (!config.apiKeys.length) throw new Error('OLLAMA_API_KEY_1 is required (run with --env-file=.env)')
const NOW = Date.parse('2026-10-05T10:00:00+09:00')
const events = vcCalendar(), truth = new Map(events.map(e => [e.id, e]))
const { db } = await emptyDb()
const ctx = makeContext(db, { now: () => NOW }, { mode: 'demo', allowReset: false })
ctx.llm = new OllamaClient(config)
let sequence = 0; ctx.id = () => `id-${++sequence}`
for (const statement of [
  "INSERT INTO users(id,name,calendar_use_state) VALUES ('vc','VC','needs_refresh'),('client','Client','manual')",
  "INSERT INTO calendar_connections(id,user_id,subject,status) VALUES ('conn','vc','sub','connected')",
  "INSERT INTO calendar_sources(id,connection_id,provider_calendar_id,name,timezone,access_role,selected) VALUES ('src','conn','vc@example.test','VC','Asia/Seoul','owner',1)",
  "INSERT INTO places(id,host_id,kind,name) VALUES ('online','vc','online','Online')",
  "INSERT INTO meeting_types(id,host_id,name,duration_min) VALUES ('m30','vc','30 min',30)",
]) await run(db, statement)
const provider = new GoogleCalendarProvider({ accessToken: async () => 'fixture', now: () => NOW, fetch: async (input) => {
  const url = new URL(String(input))
  if (url.pathname.endsWith('/freeBusy')) return Response.json({ calendars: {} })
  const min = Date.parse(url.searchParams.get('timeMin')!), max = Date.parse(url.searchParams.get('timeMax')!)
  return Response.json({ items: events.filter(e => e.endMs > min && e.startMs < max).map(googleEvent) })
} })
const time = async <T,>(fn: () => Promise<T>) => { const t = performance.now(); const value = await fn(); return { value, ms: Math.round(performance.now() - t) } }
const pct = (a: number, b: number) => b ? `${a}/${b} (${Math.round(100 * a / b)}%)` : '0/0'
const report: Record<string, unknown> = {}

// 1. Fixture description
const past = events.filter(e => e.startMs < NOW && e.startMs >= NOW - 56 * 86_400_000 - 10 * 3600_000)
const count = (list: typeof events, truthLabel: string) => list.filter(e => e.truth === truthLabel).length
const personal = past.filter(e => e.truth === 'personal')
report.fixture = { totalEvents: events.length, pastEightWeeks: past.length, business: count(past, 'business'), personal: personal.length, personalInsideWorkHours: pct(personal.filter(e => e.inWorkHours).length, personal.length), ambiguous: count(past, 'ambiguous'), lateBusiness: past.filter(e => e.truth === 'business' && !e.inWorkHours).length }

// 2. Sync (analysis snapshot, then schedule snapshot) and classification
const sync = await time(async () => { await syncCalendar(ctx, 'vc', { expectedSelectionRevision: 0 }, { key: 'sync-full' }, provider, 'full'); await syncCalendar(ctx, 'vc', { expectedSelectionRevision: 0 }, { key: 'sync-future' }, provider, 'future') })
let draft = await createDraft(ctx, 'vc', { purpose: 'onboarding' }, { key: 'draft' })
const analysis = await time(() => analyzeDraft(ctx, 'vc', { draftId: draft.draftId, expectedRevision: draft.revision }, { key: 'analyze' }))
draft = analysis.value
const rows = await all<{ id: string; p: string }>(db, 'SELECT provider_event_id id, proposal_json p FROM event_classifications')
const label = new Map(rows.map(r => [r.id, JSON.parse(r.p).classification as string]))
const matrix: Record<string, Record<string, number>> = {}
for (const e of past) { const got = label.get(e.id) ?? 'not_classified'; (matrix[e.truth] ??= {})[got] = (matrix[e.truth][got] ?? 0) + 1 }
const classified = past.filter(e => label.has(e.id))
const clear = classified.filter(e => e.truth !== 'ambiguous')
const clearRight = clear.filter(e => label.get(e.id) === e.truth).length
const ambiguousEvents = classified.filter(e => e.truth === 'ambiguous'), ambiguousUnknown = ambiguousEvents.filter(e => label.get(e.id) === 'unknown').length
report.classification = {
  syncMs: sync.ms, analyzeMs: analysis.ms, coverage: pct(classified.length, past.length),
  confusion_truth_vs_ai: matrix,
  accuracyOnClassifiedClearEvents: pct(clear.filter(e => label.get(e.id) === e.truth).length, clear.length),
  businessEventsLabeledPersonal: classified.filter(e => e.truth === 'business' && label.get(e.id) === 'personal').length,
  personalEventsLabeledBusiness: classified.filter(e => e.truth === 'personal' && label.get(e.id) === 'business').length,
  ambiguousSentToUnknown: pct(classified.filter(e => e.truth === 'ambiguous' && label.get(e.id) === 'unknown').length, classified.filter(e => e.truth === 'ambiguous').length),
  assistantMessage: draft.messages.at(-1)?.content,
  autoFilledMeetingWindows: draft.values.meetingWindows.length,
}

// 3. Onboarding AI turns (user statements in Korean)
const expectedWindows = [1, 2, 3, 4, 5].flatMap(weekday => [{ weekday, startMin: 600, endMin: 720 }, { weekday, startMin: 780, endMin: 1080 }])
const turns: { text: string; ms: number; ok: boolean; got: unknown }[] = []
const turn = async (text: string, check: (v: typeof draft.values) => boolean) => {
  const r = await time(() => onboardingTurn(ctx, 'vc', { draftId: draft.draftId, expectedRevision: draft.revision, text }, { key: `turn-${turns.length}` }))
  draft = r.value; turns.push({ text, ms: r.ms, ok: check(draft.values), got: { meetingWindows: draft.values.meetingWindows.length, preferences: draft.values.preferences } })
}
await turn('평일 10시부터 오후 6시까지 미팅 가능해요. 점심시간 12시부터 1시는 빼주세요.', v => JSON.stringify(v.meetingWindows) === JSON.stringify(expectedWindows))
await turn('가능하면 오후 시간대에 온라인으로 만나는 걸 선호해요.', v => v.preferences.meetingMode?.value === 'online' && !!v.preferences.startTime && v.preferences.startTime.value.startMin >= 720)
report.onboardingTurns = turns
report.windowsAfterTurns = draft.values.meetingWindows

// 4. Confirm profile and verify every bookable slot
const patched = await patchDraft(ctx, 'vc', { draftId: draft.draftId, expectedRevision: draft.revision, patch: {}, topicConfirmations: { work: 'confirmed', meetingWindows: 'confirmed', preferences: 'confirmed' } }, { key: 'topics' })
await confirmProfile(ctx, 'vc', { draftId: draft.draftId, expectedRevision: patched.revision, baseProfileVersion: null }, { key: 'confirm' })
await run(db, "INSERT INTO availability_rules(user_id,weekday,enabled,start_min,end_min) SELECT 'client',weekday,true,540,1200 FROM generate_series(0,6) AS weekday")
const { slots } = await computeBookable(db, 'client', 'vc', NOW)
const windows = (await getDraft(db, 'vc', draft.draftId)).values.meetingWindows
const violations: Record<string, number> = { outsideWindows: 0, overlapsEvent: 0, offGrid: 0, tooSoon: 0 }
for (const s of slots) {
  const a = kstParts(s.startMs), b = kstParts(s.endMs - 1)
  if (!windows.some(w => w.weekday === a.weekday && a.minuteOfDay >= w.startMin && b.minuteOfDay < w.endMin && a.weekday === b.weekday)) violations.outsideWindows++
  if (events.some(e => e.startMs < s.endMs && e.endMs > s.startMs)) violations.overlapsEvent++
  if (a.minuteOfDay % 30) violations.offGrid++
  if (s.startMs < NOW + 2 * 3600_000) violations.tooSoon++
}
const byWeekday = [0, 0, 0, 0, 0, 0, 0]; for (const s of slots) byWeekday[kstParts(s.startMs).weekday]++
const eventsInWindowDays = new Set(events.filter(e => e.startMs > NOW).map(e => Math.floor((e.startMs + 9 * 3600_000) / 86_400_000)))
report.bookableSlots = { total: slots.length, violations, byWeekdaySunToSat: byWeekday, earliest: slots[0] && new Date(slots[0].startMs + 9 * 3600_000).toISOString().slice(0, 16), futureDaysWithBusyEvents: eventsInWindowDays.size }

const pass = {
  classificationCoverageComplete: classified.length === past.length,
  clearEventsClassifiedCorrectly: clear.length > 0 && clearRight / clear.length >= 0.95,
  ambiguousEventsLeftUnknown: ambiguousEvents.length > 0 && ambiguousUnknown / ambiguousEvents.length >= 0.8,
  noAutoGeneratedWindowsFromHistory: (report.classification as { autoFilledMeetingWindows: number }).autoFilledMeetingWindows === 0,
  windowsFromStatementCorrect: turns[0]?.ok === true,
  preferencesFromStatementCorrect: turns[1]?.ok === true,
  slotsHaveNoViolations: Object.values(violations).every(v => v === 0) && slots.length > 0,
}
report.pass = pass
console.log(JSON.stringify(report, null, 1))
process.exit(Object.values(pass).every(Boolean) ? 0 : 1)

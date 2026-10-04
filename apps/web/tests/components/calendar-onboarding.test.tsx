import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarConnectionView } from '@/contracts/calendar'
import { CalendarSettings } from '@/components/calendar/CalendarSettings'
import { ImportedEvents, formatEventRange } from '@/components/calendar/ImportedEvents'
import { OnboardingWorkspace } from '@/components/onboarding/OnboardingWorkspace'
import type { ProfileDraftView } from '@/contracts/profile'

const draft: ProfileDraftView = {
  draftId: 'draft-1', revision: 0, baseProfileVersion: null, status: 'active', updatedAt: 0, messages: [], fieldErrors: {},
  values: { work: { mode: 'none', windows: [] }, meetingWindows: [{ weekday: 1, startMin: 540, endMin: 1020 }], preferences: { weekdays: null, startTime: null, meetingMode: null, slack: null } },
  topics: { work: 'confirmed', meetingWindows: 'confirmed', preferences: 'confirmed' },
}
const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data, meta: {} }))
const fail = (code: string, message: string) => new Response(JSON.stringify({ ok: false, error: { code, message, retryable: true }, meta: { outcome: 'not_applied' } }), { status: 502 })
const deferred = () => { let resolve!: (r: Response) => void; return { promise: new Promise<Response>(r => { resolve = r }), resolve: (r: Response) => resolve(r) } }
const sync = { snapshotId: 'snap', generation: 1, selectionRevision: 1, scope: 'full' as const, fromMs: 0, toMs: 1, startedAt: 1, completedAt: 2 }
const connected: CalendarConnectionView = { status: 'connected', revision: 1, selectionRevision: 1, sources: [{ id: 'primary', name: '내 일정', selected: true, timeZone: 'Asia/Seoul', access: 'detail' }], analysis: sync, schedule: sync, lastError: null }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('calendar and onboarding screens', () => {
  it('ai_reply_does_not_replace_dirty_form: a direct edit made while the AI is answering survives the reply', async () => {
    vi.useFakeTimers()
    const ai = deferred()
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(ai.promise))
    render(<OnboardingWorkspace initialDraft={draft} />)
    fireEvent.change(screen.getByLabelText('AI에게 설명하기'), { target: { value: '화요일도 가능해요' } })
    await act(async () => { fireEvent.click(screen.getByText('메시지 보내기')); await vi.advanceTimersByTimeAsync(0) })
    fireEvent.change(screen.getByLabelText('미팅 허용 1 종료 시각'), { target: { value: '18:30' } })
    await act(async () => { ai.resolve(ok({ ...draft, revision: 1, messages: [{ id: 'a', role: 'assistant', content: '반영했어요', createdAt: 1, interpretFailed: false }] })); await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByLabelText('미팅 허용 1 종료 시각')).toHaveValue('18:30')
    expect(screen.getByTestId('save-status')).toHaveTextContent('미저장')
    expect(screen.getByText('반영했어요')).toBeInTheDocument()
  })
  it('shows a failed sync as an error rather than as an empty calendar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(fail('calendar_fetch_failed', 'Calendar를 가져오지 못했어요')).mockResolvedValueOnce(ok(connected)))
    render(<CalendarSettings initial={connected} mode="real" />)
    fireEvent.click(screen.getByText('선택한 일정 가져오기'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Calendar를 가져오지 못했어요')
    expect(screen.queryByText('일정이 없습니다')).toBeNull()
  })
  it('lets a demo account connect its example calendar, never offering Google', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok({ ...connected, status: 'needs_refresh', sources: [], analysis: null, schedule: null }))
    vi.stubGlobal('fetch', fetcher)
    render(<CalendarSettings initial={{ ...connected, status: 'manual', sources: [], analysis: null, schedule: null }} mode="demo" />)
    expect(screen.queryByText('Google Calendar 연결')).toBeNull()
    expect(screen.queryByText('캘린더 목록 불러오기')).toBeNull()      // nothing to list before the example calendar is attached
    fireEvent.click(screen.getByText('예시 Calendar 연결'))
    expect(await screen.findByText(/Google에는 접속하지 않아요/)).toBeInTheDocument()
    expect(fetcher.mock.calls[0][0]).toBe('/api/calendar/mock-connect')
    expect(screen.getByText('캘린더 목록 불러오기')).toBeInTheDocument()
  })
  it('keeps the event editor values when a save fails and reports the error', async () => {
    const event = { eventId: 'e1', title: '주간 회의', startAt: 1, endAt: 2, allDay: false, startDate: null, endDate: null, timezone: null, revision: 0, sourceFingerprint: 'f', patch: {}, needsConfirmation: false, locationKind: 'none', classification: 'unknown', aiClassification: null }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok([event])).mockResolvedValueOnce(fail('revision_conflict', '다른 곳에서 변경됐어요')))
    render(<ImportedEvents />)
    fireEvent.click(screen.getByText('가져온 일정 확인·보정'))
    const select = await screen.findByLabelText('분류')
    fireEvent.change(select, { target: { value: 'business' } })
    fireEvent.click(screen.getByText('보정 저장'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('다른 곳에서 변경됐어요'))
    expect(screen.getByLabelText('분류')).toHaveValue('business')
  })
  it('formats all-day events from the calendar\'s own dates, whatever the time zone', () => {
    // Start instants deliberately are NOT KST midnights (e.g. a New York all-day event).
    const base = { startAt: Date.parse('2026-10-06T04:00:00Z'), endAt: Date.parse('2026-10-07T04:00:00Z') }
    expect(formatEventRange({ ...base, allDay: true, startDate: '2026-10-06', endDate: '2026-10-07' }, 2026).text).toBe('10월 6일 (화) · 종일')
    expect(formatEventRange({ ...base, allDay: true, startDate: '2026-10-06', endDate: '2026-10-09' }, 2026).text).toBe('10월 6일 (화) – 10월 8일 (목) · 종일')
    expect(formatEventRange({ ...base, allDay: true, startDate: '2025-12-31', endDate: '2026-01-02' }, 2026).text).toBe('2025년 12월 31일 (수) – 1월 1일 (목) · 종일')
    // A timed event that happens to start and end at KST midnights is not "all day".
    const midnight = { startAt: Date.parse('2026-10-05T15:00:00Z'), endAt: Date.parse('2026-10-06T15:00:00Z'), allDay: false, startDate: null, endDate: null }
    expect(formatEventRange(midnight, 2026).allDay).toBe(false)
  })
  it('shows the AI suggestion as a suggestion and applies it only when asked, without saving', async () => {
    const view = { eventId: 'e1', title: '골프', startAt: 1, endAt: 2, allDay: false, startDate: null, endDate: null, timezone: null, revision: 0, sourceFingerprint: 'f', patch: {}, needsConfirmation: false, locationKind: 'none', classification: 'unknown', aiClassification: 'personal' }
    const fetcher = vi.fn().mockResolvedValueOnce(ok([view])); vi.stubGlobal('fetch', fetcher)
    render(<ImportedEvents />)
    fireEvent.click(screen.getByText('가져온 일정 확인·보정'))
    expect(await screen.findByText('AI 제안 · 개인')).toBeInTheDocument()
    expect(screen.getByLabelText('분류')).toHaveValue('unknown')
    fireEvent.click(screen.getByText('AI 제안(개인) 적용'))
    expect(screen.getByLabelText('분류')).toHaveValue('personal')
    expect(fetcher).toHaveBeenCalledTimes(1)               // applying a suggestion is not saving
  })
  it('tells the user when the AI has nothing to say about an event', async () => {
    const view = { eventId: 'e1', title: '미래 일정', startAt: 1, endAt: 2, allDay: false, startDate: null, endDate: null, timezone: null, revision: 0, sourceFingerprint: 'f', patch: {}, needsConfirmation: false, locationKind: 'none', classification: 'unknown', aiClassification: null }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok([view])))
    render(<ImportedEvents />)
    fireEvent.click(screen.getByText('가져온 일정 확인·보정'))
    expect(await screen.findByText('AI는 최근 8주 일정만 분류해요.')).toBeInTheDocument()
    expect(screen.queryByText(/AI 제안/)).toBeNull()
  })
})

// AI-generated with Codex (gpt-6-astra), 2026-10-05
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProfileDraftView } from '@/contracts/profile'
import { OnboardingWorkspace } from '@/components/onboarding/OnboardingWorkspace'

export const draft: ProfileDraftView = {
  draftId: 'draft-1', revision: 0, baseProfileVersion: null, status: 'active', updatedAt: 0, messages: [], fieldErrors: {},
  values: { work: { mode: 'none', windows: [] }, meetingWindows: [{ weekday: 1, startMin: 540, endMin: 1020 }], preferences: { weekdays: null, startTime: null, meetingMode: null, slack: null } },
  topics: { work: 'confirmed', meetingWindows: 'confirmed', preferences: 'confirmed' },
}
const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data, meta: {} }))
const deferred = () => { let resolve!: (r: Response) => void; return { promise: new Promise<Response>(r => { resolve = r }), resolve: (r: Response) => resolve(r) } }
async function tick(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const end = () => screen.getByLabelText('미팅 허용 1 종료 시각')
beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('manual onboarding', () => {
  it('saving_old_value_keeps_new_input_dirty until the newer value is saved', async () => {
    const first = deferred(); const second = deferred()
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    vi.stubGlobal('fetch', fetcher)
    render(<OnboardingWorkspace initialDraft={draft} />)
    fireEvent.change(end(), { target: { value: '18:00' } })
    await tick(499); expect(fetcher).not.toHaveBeenCalled()
    await tick(1); expect(fetcher).toHaveBeenCalledTimes(1)
    fireEvent.change(end(), { target: { value: '18:30' } })
    first.resolve(response({ ...draft, revision: 1, values: { ...draft.values, meetingWindows: [{ weekday: 1, startMin: 540, endMin: 1080 }] } }))
    await tick()
    expect(end()).toHaveValue('18:30')
    expect(screen.getByTestId('save-status')).toHaveTextContent('미저장')
    await tick(500)
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ expectedRevision: 1, patch: { meetingWindows: [{ endMin: 1110, startMin: 540, weekday: 1 }] } })
    second.resolve(response({ ...draft, revision: 2, values: { ...draft.values, meetingWindows: [{ weekday: 1, startMin: 540, endMin: 1110 }] } }))
    await tick(); expect(screen.getByTestId('save-status')).toHaveTextContent('저장됨')
  })
  it('keeps invalid input and prevents review rather than saving it', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    render(<OnboardingWorkspace initialDraft={draft} />)
    fireEvent.change(end(), { target: { value: '08:00' } }); await tick(600)
    expect(fetcher).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '최종 확인' })).toBeDisabled()
    expect(screen.getByText(/종료는 시작보다 늦어야/)).toBeInTheDocument()
  })
  it('does not confirm a profile until explicit review and apply', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ version: 1, values: draft.values, confirmedAt: 1, origin: 'user' }))
    vi.stubGlobal('fetch', fetcher)
    render(<OnboardingWorkspace initialDraft={draft} />)
    fireEvent.click(screen.getByRole('button', { name: '최종 확인' })); await tick()
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '이 설정으로 확정' })); await tick()
    expect(fetcher.mock.calls[0][0]).toBe('/api/profile-drafts/draft-1/confirm')
    expect(screen.getByText('프로필 설정을 완료했어요.')).toBeInTheDocument()
  })
  it('preserves manual edits when a delayed AI turn conflicts with a newer saved revision', async () => {
    const ai = deferred()
    const newer = { ...draft, revision: 1, values: { ...draft.values, meetingWindows: [{ weekday: 1, startMin: 540, endMin: 1110 }] } }
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/turns') ? ai.promise : Promise.resolve(response(newer))))
    render(<OnboardingWorkspace initialDraft={draft} />)
    fireEvent.change(screen.getByLabelText('AI에게 설명하기'), { target: { value: '오후가 좋아요' } })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' })); await tick()
    fireEvent.change(end(), { target: { value: '18:30' } }); await tick(500)
    ai.resolve(new Response(JSON.stringify({ ok: false, error: { code: 'revision_conflict', message: '수정 내용이 바뀌었어요', retryable: false }, meta: { outcome: 'not_applied' } }), { status: 409 }))
    await tick()
    expect(end()).toHaveValue('18:30')
    expect(screen.getByRole('alert')).toHaveTextContent('최신')
    expect(screen.getByLabelText('AI에게 설명하기')).toHaveValue('오후가 좋아요')
  })
  it('recovers an unknown save by checking status and replaying the same immutable key and body', async () => {
    const saved = { ...draft, revision: 1, values: { ...draft.values, meetingWindows: [{ weekday: 1, startMin: 540, endMin: 1080 }] } }
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(response({ id: 'op-1', kind: 'profile.draft.patch', state: 'succeeded', attempt: 1, resourceId: 'draft-1', errorCode: null })).mockResolvedValueOnce(response(saved))
    vi.stubGlobal('fetch', fetcher)
    render(<OnboardingWorkspace initialDraft={draft} />)
    fireEvent.change(end(), { target: { value: '18:00' } }); await tick(500)
    expect(screen.getByRole('button', { name: '최종 확인' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '저장 결과 확인' })); await tick()
    expect(fetcher.mock.calls[1][0]).toMatch(/^\/api\/operations\?kind=/)
    expect(fetcher.mock.calls[2][1].headers['Idempotency-Key']).toBe(fetcher.mock.calls[0][1].headers['Idempotency-Key'])
    expect(fetcher.mock.calls[2][1].body).toBe(fetcher.mock.calls[0][1].body)
    expect(screen.getByTestId('save-status')).toHaveTextContent('저장됨')
  })
})

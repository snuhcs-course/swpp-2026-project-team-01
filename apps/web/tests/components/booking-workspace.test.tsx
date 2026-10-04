import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchScreenView } from '@/contracts/search'
import { SearchWorkspace } from '@/components/SearchWorkspace'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }))
const slot = (n: number) => ({ startAt: Date.parse('2026-10-06T10:00:00+09:00') + n * 3600000, endAt: Date.parse('2026-10-06T10:30:00+09:00') + n * 3600000, placeId: 'online', meetingTypeId: 'short' })
const view: SearchScreenView = {
  searchId: 's1', hostId: 'host', revision: 3, inheritedProfileVersion: 1,
  inheritedPreferences: { weekdays: null, startTime: null, meetingMode: { value: 'online', strength: 'strong' }, slack: null },
  effectiveConditions: { meetingMode: { value: 'online', strength: 'strong' } }, candidateState: 'ready',
  candidates: [slot(0), slot(1)], count: 2, labels: ['10/6 10:00', '10/6 11:00'],
  chips: [{ key: 'places', label: '방식', text: '온라인', strength: 'strong' }], sources: { location: 'inherit' }, overrides: {},
  messages: [{ id: 'm1', role: 'assistant', content: '기본 선호를 적용해 찾아봤어요.' }], basis: null,
}
const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data, meta: {} }))
afterEach(() => vi.unstubAllGlobals())

describe('booking workspace', () => {
  it('modal_reselection_keeps_message when the dialog is closed and another candidate is chosen', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<SearchWorkspace hostId="host" hostName="김민준" initial={view} previous={[]} />)
    fireEvent.click(screen.getByText('10/6 10:00'))
    fireEvent.change(screen.getByLabelText('보낼 메시지'), { target: { value: '안녕하세요' } })
    fireEvent.click(screen.getByText('닫기'))
    fireEvent.click(screen.getByText('10/6 11:00'))
    expect(screen.getByLabelText('보낼 메시지')).toHaveValue('안녕하세요')
  })
  it('starts one search for a double click and sends one idempotency key', async () => {
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetcher)
    render(<SearchWorkspace hostId="host" hostName="김민준" initial={null} previous={[]} />)
    const start = screen.getByText('새 예약 탐색 시작')
    fireEvent.click(start); fireEvent.click(start)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1].headers['Idempotency-Key']).toBeTruthy()
  })
  it('turning off an inherited chip sends a disable command for this search only', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({ ...view, revision: 4, chips: [], sources: { location: 'disabled' } }))
    vi.stubGlobal('fetch', fetcher)
    render(<SearchWorkspace hostId="host" hostName="김민준" initial={view} previous={[]} />)
    fireEvent.click(screen.getByLabelText('온라인 조건 끄기'))
    await waitFor(() => expect(screen.queryByLabelText('온라인 조건 끄기')).toBeNull())
    expect(fetcher.mock.calls[0][0]).toBe('/api/searches/s1/conditions')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ expectedRevision: 3, commands: [{ kind: 'disable', dimension: 'location' }] })
  })
  it('moves focus to the message box when a candidate is chosen, closes on Escape, and is not a modal dialog', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<SearchWorkspace hostId="host" hostName="김민준" initial={view} previous={[]} />)
    fireEvent.click(screen.getByText('10/6 10:00'))
    expect(screen.getByLabelText('보낼 메시지')).toHaveFocus()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('log', { name: '예약 대화' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByLabelText('보낼 메시지'), { key: 'Escape' })
    expect(screen.queryByLabelText('보낼 메시지')).toBeNull()
  })
})

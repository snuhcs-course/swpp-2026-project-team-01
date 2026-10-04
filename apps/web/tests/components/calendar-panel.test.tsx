import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CalendarEventButton, type PanelTarget } from '@/components/calendar/CalendarEventPanel'
import { RefreshCalendarButton } from '@/components/calendar/RefreshCalendarButton'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }))
afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear() })

const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data, meta: {} }))
const fail = (message: string) => new Response(JSON.stringify({ ok: false, error: { code: 'calendar_fetch_failed', message, retryable: true }, meta: { outcome: 'not_applied' } }), { status: 502 })
const sync = { snapshotId: 's', generation: 1, selectionRevision: 1, scope: 'future', fromMs: 0, toMs: 1, startedAt: 1, completedAt: 2 }
const detail = (over: Record<string, unknown> = {}, d: Record<string, unknown> = {}) => ({
  eventId: 'e1', title: 'IC 회의', startAt: 1, endAt: 2, allDay: false, startDate: null, endDate: null, timezone: null, revision: 0, sourceFingerprint: 'f',
  patch: {}, needsConfirmation: false, locationKind: 'none', classification: 'unknown', aiClassification: null,
  detail: { calendarName: 'ENU', status: 'confirmed', busy: true, providedLocation: 'Room A', providedKind: 'place', onlineLink: false, ...d }, ...over,
})
const google = (related: { title: string; timeText: string }[] = []): PanelTarget => ({ type: 'google', provider: 'google', eventId: 'e1', title: 'IC 회의', timeText: '10월 6일 (화) 14:00–15:00', calendarNames: ['ENU', '개인'], tentative: false, related })

describe('refreshing from My Calendar', () => {
  it('asks for the coming-days refresh with the current selection revision, then reloads the page data', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok(sync)); vi.stubGlobal('fetch', fetcher)
    render(<RefreshCalendarButton selectionRevision={4} scope="future" />)
    fireEvent.click(screen.getByText('일정 새로 가져오기'))
    expect(await screen.findByRole('status')).toHaveTextContent('새로 가져왔어요')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ expectedSelectionRevision: 4, scope: 'future' })
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('says the stored schedule was kept when the refresh fails, and does not pretend it worked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail('Calendar를 가져오지 못했어요')))
    render(<RefreshCalendarButton selectionRevision={4} scope="future" />)
    fireEvent.click(screen.getByText('일정 새로 가져오기'))
    expect(await screen.findByRole('alert')).toHaveTextContent('기존 일정은 그대로 유지했어요')
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('event detail panel (S13)', () => {
  it('separates what Google provided from the user\'s own supplement and lists overlapping confirmed meetings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(detail())))
    render(<CalendarEventButton target={google([{ title: '확정 미팅 · 30분', timeText: '10월 6일 (화) 14:30–15:00' }])}><span>IC 회의 카드</span></CalendarEventButton>)
    fireEvent.click(screen.getByText('IC 회의 카드'))
    const panel = await screen.findByRole('dialog', { name: 'IC 회의' })
    const original = await within(panel).findByRole('region', { name: /Google Calendar에서 가져온 원본/ })
    expect(within(original).getByText('ENU, 개인')).toBeInTheDocument()
    expect(within(original).getByText('Room A')).toBeInTheDocument()
    expect(within(original).getByText('바쁨으로 표시')).toBeInTheDocument()
    const mine = within(panel).getByRole('region', { name: /내가 보완한 내용/ })
    expect(within(mine).getByLabelText('분류')).toBeInTheDocument()
    expect(within(panel).getByText('겹치는 확정 미팅')).toBeInTheDocument()
    expect(within(panel).getByText('확정 미팅 · 30분')).toBeInTheDocument()
    expect(panel).toHaveTextContent('자동으로 취소되지 않으니')
  })
  it('saves the supplement for this app only and shows what was stored', async () => {
    const { detail: _provided, ...savedView } = detail({ revision: 1, classification: 'business' })   // the save endpoint returns the base view only
    const fetcher = vi.fn().mockResolvedValueOnce(ok(detail())).mockResolvedValueOnce(ok(savedView))
    vi.stubGlobal('fetch', fetcher)
    render(<CalendarEventButton target={google()}><span>카드</span></CalendarEventButton>)
    fireEvent.click(screen.getByText('카드'))
    const classification = await screen.findByLabelText('분류')
    fireEvent.change(classification, { target: { value: 'business' } })
    fireEvent.click(screen.getByText('보정 저장'))
    expect(await screen.findByText('저장했어요')).toBeInTheDocument()
    const [url, init] = fetcher.mock.calls[1]
    expect(url).toBe('/api/imported-events/e1/annotation')
    expect(JSON.parse(init.body)).toMatchObject({ expectedRevision: 0, sourceFingerprint: 'f', patch: { classification: 'business' } })
  })
  it('explains a failed load without offering an empty form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail('일정을 찾을 수 없어요')))
    render(<CalendarEventButton target={google()}><span>카드</span></CalendarEventButton>)
    fireEvent.click(screen.getByText('카드'))
    expect(await screen.findByRole('alert')).toHaveTextContent('일정을 찾을 수 없어요')
    expect(screen.queryByLabelText('분류')).toBeNull()
  })
  it('shows a confirmed meeting with the Google events that now overlap it, without any network call', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    render(<CalendarEventButton target={{ type: 'booking', title: '미팅 · 30분', timeText: '10월 6일 (화) 14:00–14:30', placeText: '온라인', related: [{ title: '새로 생긴 일정', timeText: '10월 6일 (화) 14:15–15:00' }] }}><span>미팅 카드</span></CalendarEventButton>)
    fireEvent.click(screen.getByText('미팅 카드'))
    const panel = screen.getByRole('dialog', { name: '미팅 · 30분' })
    expect(within(panel).getByText('겹치는 외부 일정')).toBeInTheDocument()
    expect(within(panel).getByText('새로 생긴 일정')).toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('closes from the close button and returns to the entry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(detail())))
    render(<CalendarEventButton target={google()}><span>카드</span></CalendarEventButton>)
    fireEvent.click(screen.getByText('카드'))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByLabelText('닫기'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('카드')).toBeInTheDocument()
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeleteEventButton } from '@/components/DeleteEventButton'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }))
afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear() })

describe('event deletion', () => {
  it('asks before deleting and does nothing when cancelled', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    render(<DeleteEventButton id="e1" />)
    fireEvent.click(screen.getByLabelText('일정 삭제'))
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('취소'))
    expect(fetcher).not.toHaveBeenCalled()
    expect(screen.getByLabelText('일정 삭제')).toBeInTheDocument()
  })
  it('deletes only after confirmation and refreshes', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetcher)
    render(<DeleteEventButton id="e1" />)
    fireEvent.click(screen.getByLabelText('일정 삭제'))
    fireEvent.click(screen.getByText('삭제'))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('/api/events/e1')
  })
  it('shows an error and keeps the confirmation when deletion fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: '삭제하지 못했어요' }), { status: 409 })))
    render(<DeleteEventButton id="e1" />)
    fireEvent.click(screen.getByLabelText('일정 삭제'))
    fireEvent.click(screen.getByText('삭제'))
    expect(await screen.findByRole('alert')).toHaveTextContent('삭제하지 못했어요')
    expect(refresh).not.toHaveBeenCalled()
  })
})

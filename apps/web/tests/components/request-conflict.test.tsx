import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RequestSummary } from '@/components/RequestCard'

describe('confirmed meeting that clashes with my calendar', () => {
  const base = { name: '김민준', label: '10월 12일(월) 12:00 · 온라인 · 30분 미팅', status: 'accepted', message: '' }
  it('says so, points to the right week, and reassures that nothing was cancelled', () => {
    render(<RequestSummary {...base} conflictHref="/calendar?w=1" />)
    expect(screen.getByRole('note')).toHaveTextContent('자동으로 취소되지 않아요')
    expect(screen.getByRole('link', { name: '내 캘린더에서 확인' })).toHaveAttribute('href', '/calendar?w=1')
  })
  it('stays quiet when there is no clash', () => {
    render(<RequestSummary {...base} />)
    expect(screen.queryByRole('note')).toBeNull()
  })
})

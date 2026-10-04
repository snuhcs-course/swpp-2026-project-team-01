"use client"
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { syncViewSchema } from '@/contracts/calendar'
import { useMutationOperation } from '@/components/hooks/useMutationOperation'
import { Button, Spinner } from '@/components/ui'

/** Fetches the selected calendars again. A failed fetch leaves the schedule that is already stored untouched, and says so. */
export function RefreshCalendarButton({ selectionRevision, scope }: { selectionRevision: number; scope: 'full' | 'future' }) {
  const router = useRouter(), op = useMutationOperation<unknown>(), [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const done = (r: Awaited<ReturnType<typeof op.run>>) => {
    if (r?.ok) { setMessage({ ok: true, text: 'Google 일정을 새로 가져왔어요.' }); router.refresh() }
    else if (r) setMessage({ ok: false, text: `${r.error.message} 기존 일정은 그대로 유지했어요.` })
  }
  return <span className="inline-flex flex-wrap items-center gap-2">
    <Button size="sm" disabled={op.pending} onClick={() => { setMessage(null); void op.run({ method: 'POST', url: '/api/calendar/sync', kind: `calendar.sync.${scope}`, payload: { expectedSelectionRevision: selectionRevision, scope }, schema: syncViewSchema }).then(done) }}>
      {op.pending && <Spinner />}일정 새로 가져오기
    </Button>
    {op.phase === 'reconciling' && <Button size="sm" onClick={() => void op.recover().then(done)}>가져오기 결과 확인</Button>}
    {message && <span role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-small font-medium text-success' : 'text-small font-medium text-danger'}>{message.text}</span>}
  </span>
}

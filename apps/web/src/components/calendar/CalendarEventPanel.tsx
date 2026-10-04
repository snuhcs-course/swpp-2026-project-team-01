"use client"
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { importedEventDetailSchema, type ImportedEventDetail } from '@/contracts/calendar'
import { request } from '@/components/api'
import { Alert, Spinner, XIcon, cn } from '@/components/ui'
import { EventAnnotationForm } from './EventAnnotationForm'
import { PROVIDER_LABEL, type ProviderKey } from './format'

export interface Related { title: string; timeText: string }
export type PanelTarget =
  | { type: 'google'; provider: ProviderKey; eventId: string; title: string; timeText: string; calendarNames: string[]; tentative: boolean; related: Related[] }
  | { type: 'booking'; title: string; timeText: string; placeText: string; related: Related[] }
  | { type: 'manual'; title: string; timeText: string; placeText: string }

const TYPE_LABEL = { booking: '확정 미팅', manual: '직접 추가한 일정' } as const

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex gap-3 py-1.5"><dt className="w-24 shrink-0 text-muted">{label}</dt><dd className="min-w-0 break-words text-ink">{children}</dd></div>
}

function GoogleSections({ target }: { target: Extract<PanelTarget, { type: 'google' }> }) {
  const [state, setState] = useState<{ phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; data: ImportedEventDetail }>({ phase: 'loading' })
  useEffect(() => {
    let live = true
    void request('GET', `/api/imported-events/${target.eventId}`, importedEventDetailSchema).then(r => {
      if (live) setState(r.ok ? { phase: 'ready', data: r.data } : { phase: 'error', message: r.error.message })
    })
    return () => { live = false }
  }, [target.eventId])
  if (state.phase === 'loading') return <p className="flex items-center gap-2 text-small text-muted" role="status"><Spinner />불러오는 중…</p>
  if (state.phase === 'error') return <Alert tone="danger" role="alert">{state.message} 일정이 바뀌었거나 연결이 해제됐을 수 있어요. 창을 닫고 Calendar 연결에서 다시 가져와 주세요.</Alert>
  const { data } = state, d = data.detail
  const place = d.providedLocation ?? (d.onlineLink ? null : '미확인')
  return <>
    <section aria-labelledby="orig-heading" className="space-y-1">
      <h3 id="orig-heading" className="text-small font-semibold text-ink-soft">{PROVIDER_LABEL[target.provider]}에서 가져온 원본 <span className="font-normal text-muted">(읽기 전용)</span></h3>
      <dl className="divide-y divide-border rounded-control border border-border bg-surface-sunken/50 px-3 text-small">
        <Row label="캘린더">{target.calendarNames.length ? target.calendarNames.join(', ') : d.calendarName}</Row>
        <Row label="상태">{d.status === 'tentative' ? '미정' : '확정'}</Row>
        <Row label="바쁨 여부">{d.busy ? '바쁨으로 표시' : '한가함으로 표시'}</Row>
        <Row label="제공된 장소">{place ?? '제공되지 않음'}</Row>
        <Row label="화상회의">{d.onlineLink ? '링크 있음' : '링크 없음'}</Row>
      </dl>
    </section>
    <section aria-labelledby="mine-heading" className="space-y-2">
      <h3 id="mine-heading" className="text-small font-semibold text-ink-soft">내가 보완한 내용 <span className="font-normal text-muted">(이 앱에만 적용돼요)</span></h3>
      <p className="text-caption text-muted">보완 저장은 앱 안의 해석만 바꾸고 원본({PROVIDER_LABEL[target.provider]})은 바꾸지 않아요. 화상회의 링크가 있어도 참석 방식을 자동으로 정하지 않아요.</p>
      <EventAnnotationForm saved={data} onSaved={next => setState({ phase: 'ready', data: { ...data, ...next } })} />
    </section>
  </>
}

function EventPanel({ target, onClose }: { target: PanelTarget; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  const related = target.type === 'manual' ? [] : target.related
  const relatedTitle = target.type === 'google' ? '겹치는 확정 미팅' : '겹치는 외부 일정'
  return <dialog
    ref={ref} aria-labelledby="event-panel-title" onClose={onClose}
    onClick={e => { if (e.target === ref.current) ref.current?.close() }}
    className={cn('fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-md overflow-y-auto border-l border-border bg-surface p-5 text-ink shadow-raised', 'backdrop:bg-black/40')}
  >
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption font-semibold text-primary">{target.type === 'google' ? `${PROVIDER_LABEL[target.provider]} 일정` : TYPE_LABEL[target.type]}</p>
          <h2 id="event-panel-title" className="break-words text-h3 font-semibold text-ink">{target.title}</h2>
          <p className="mt-1 text-small text-muted tabular">{target.timeText}{target.type === 'google' && target.tentative ? ' · 미정' : ''}</p>
        </div>
        <button type="button" aria-label="닫기" onClick={() => ref.current?.close()} className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-sunken hover:text-ink"><XIcon size={16} /></button>
      </header>
      {related.length > 0 && <section aria-labelledby="related-heading" className="space-y-2">
        <Alert tone="warn" role="note">
          {target.type === 'google' ? '이 일정은 이미 확정된 미팅과 시간이 겹쳐요.' : '이 미팅을 확정한 뒤 겹치는 외부 일정이 생겼어요.'} 확정 미팅은 자동으로 취소되지 않으니 직접 확인해 주세요.
        </Alert>
        <h3 id="related-heading" className="text-small font-semibold text-ink-soft">{relatedTitle}</h3>
        <ul className="space-y-1.5 text-small">{related.map((r, i) => <li key={i} className="rounded-control border border-border px-3 py-2"><div className="font-medium break-words">{r.title}</div><div className="text-caption text-muted tabular">{r.timeText}</div></li>)}</ul>
      </section>}
      {target.type === 'google' ? <GoogleSections target={target} /> : <dl className="divide-y divide-border rounded-control border border-border bg-surface-sunken/50 px-3 text-small"><Row label="장소">{target.placeText || '지정하지 않음'}</Row></dl>}
      {target.type === 'booking' && <p className="text-caption text-muted">확정 미팅은 이 앱에서 만든 일정이에요. 요청함에서 상태를 확인할 수 있어요.</p>}
    </div>
  </dialog>
}

/** Wraps one entry of the week grid; activating it opens the detail panel (S13) and closing returns focus to the entry. */
export function CalendarEventButton({ target, children, className }: { target: PanelTarget; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={cn('block w-full rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus', className)}>{children}</button>
    {open && <EventPanel target={target} onClose={() => setOpen(false)} />}
  </>
}

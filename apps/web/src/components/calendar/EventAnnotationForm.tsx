"use client"
import { useState } from 'react'
import { importedEventViewSchema, type ImportedEventView } from '@/contracts/calendar'
import { useMutationOperation } from '@/components/hooks/useMutationOperation'
import { Button, Field, Input, Select, Spinner } from '@/components/ui'
import { aiHint, CLASS_LABEL } from './format'

/** The user's own reading of one imported event. Saving changes only this app's interpretation, never the Google original. */
export function EventAnnotationForm({ saved, onSaved }: { saved: ImportedEventView; onSaved: (event: ImportedEventView) => void }) {
  const [locationKind, setKind] = useState(saved.locationKind), [classification, setClassification] = useState(saved.classification)
  const [placeRef, setPlace] = useState(String(saved.patch.placeRef ?? '')), [error, setError] = useState<string | null>(null), [justSaved, setJustSaved] = useState(false)
  const op = useMutationOperation<ImportedEventView>()
  const accept = (r: Awaited<ReturnType<typeof op.run>>) => {
    if (r?.ok) { onSaved(r.data); setError(null); setJustSaved(true) } else if (r) { setError(r.error.message); setJustSaved(false) }
  }
  return <div className="space-y-3">
    {saved.needsConfirmation && <p className="text-small font-medium text-warn-ink">원본이 변경돼 보정 내용을 다시 확인해 주세요.</p>}
    <div className="grid gap-3 sm:grid-cols-[repeat(2,minmax(0,10rem))_minmax(0,1fr)] sm:items-end">
      <Field label="분류" hint={aiHint(saved)}><Select value={classification} onChange={e => { setClassification(e.target.value); setJustSaved(false) }}><option value="unknown">확인 필요</option><option value="business">업무</option><option value="personal">개인</option></Select></Field>
      <Field label="장소"><Select value={locationKind} onChange={e => { setKind(e.target.value); setJustSaved(false) }}><option value="none">알 수 없음</option><option value="office">회사</option><option value="place">직접 지정</option><option value="online">온라인</option></Select></Field>
      {locationKind === 'place' && <Input aria-label="장소 이름" placeholder="장소 이름" value={placeRef} onChange={e => { setPlace(e.target.value); setJustSaved(false) }} />}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" size="sm" disabled={op.pending} onClick={() => void op.run({ method: 'POST', url: `/api/imported-events/${saved.eventId}/annotation`, kind: 'calendar.annotation', payload: { expectedRevision: saved.revision, sourceFingerprint: saved.sourceFingerprint, patch: { classification, locationKind, placeRef: locationKind === 'place' ? placeRef : null } }, schema: importedEventViewSchema }).then(accept)}>{op.pending && <Spinner />}보정 저장</Button>
      {saved.aiClassification && saved.aiClassification !== 'unknown' && classification !== saved.aiClassification && <Button variant="link" size="sm" onClick={() => { setClassification(saved.aiClassification!); setJustSaved(false) }}>AI 제안({CLASS_LABEL[saved.aiClassification]}) 적용</Button>}
      {justSaved && !error && <span className="text-small font-medium text-success">저장했어요</span>}
      {op.phase === 'reconciling' && <Button size="sm" onClick={() => void op.recover().then(accept)}>보정 결과 확인</Button>}
    </div>
    {error && <p role="alert" className="rounded-control border border-danger/25 bg-danger-soft px-3 py-2 text-small font-medium text-danger-ink">{error}</p>}
  </div>
}

'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { profileDraftViewSchema, profileViewSchema, type ProfileDraftView, type ProfileView } from '@/contracts/profile'
import { useMutationOperation } from '@/components/hooks/useMutationOperation'
import { useDraftAutosave } from './useDraftAutosave'
import { parseForm } from './draftReducer'
import { ProfileEditor } from './ProfileEditor'
import { ProfileSummary } from './ProfileSummary'
import { OnboardingChat } from './OnboardingChat'
import { WeekSchedule } from './WeekSchedule'
import { Alert, Button, buttonClass, Card, CheckIcon, SectionHeader, Spinner, StatusPill, Stepper } from '@/components/ui'

export function OnboardingWorkspace({ initialDraft, initialReview = false, autoAnalyze = false, onReview, onComplete }: { initialDraft: ProfileDraftView; initialReview?: boolean; autoAnalyze?: boolean; onReview?: (id: string) => void; onComplete?: () => void }) {
  const draft = useDraftAutosave(initialDraft)
  const ai = useMutationOperation<ProfileDraftView>()
  const confirm = useMutationOperation<ProfileView>()
  const [text, setText] = useState('')
  const sentText = useRef('')
  const [review, setReview] = useState(initialReview)
  const [preparing, setPreparing] = useState(false)
  const preparingRef = useRef(false)
  const [complete, setComplete] = useState(initialDraft.status === 'confirmed')
  const parsed = parseForm(draft.state.form)
  const ready = draft.valid && !draft.state.conflict && !draft.error && !draft.operation.pending && !ai.pending && !confirm.pending && !preparing
  const processAI = async (result: Awaited<ReturnType<typeof ai.run>>) => {
    if (!result) return
    if (result.ok) {
      draft.dispatch({ type: 'saved', draft: result.data })
      setText(current => current === sentText.current ? '' : current)
    } else if (result.error.code === 'revision_conflict') await draft.refreshConflict()
    else draft.setError(result.error.message)
  }
  const send = async () => {
    if (preparingRef.current || !ready || !text.trim()) return
    preparingRef.current = true; setPreparing(true)
    const message = text.trim()
    if (!await draft.flush()) { preparingRef.current = false; setPreparing(false); return }
    const saved = draft.current.current.saved
    sentText.current = message
    const task = ai.run({ method: 'POST', url: `/api/profile-drafts/${encodeURIComponent(saved.draftId)}/turns`, kind: 'profile.draft.turn', payload: { expectedRevision: saved.revision, text: message }, schema: profileDraftViewSchema })
    preparingRef.current = false; setPreparing(false)
    await processAI(await task)
  }
  const analyze = async () => {
    if (!ready || !await draft.flush()) return
    const saved = draft.current.current.saved
    await processAI(await ai.run({method:'POST',url:`/api/profile-drafts/${encodeURIComponent(saved.draftId)}/analyze`,kind:'profile.draft.analyze',payload:{expectedRevision:saved.revision},schema:profileDraftViewSchema}))
  }
  // Started from the calendar screen: run the observation once. It only summarizes the past; the user still confirms the hours.
  const autoRan = useRef(false)
  useEffect(() => { if (autoAnalyze && ready && !autoRan.current && draft.current.current.saved.messages.length === 0) { autoRan.current = true; void analyze() } }, [autoAnalyze, ready])  // eslint-disable-line react-hooks/exhaustive-deps
  const showReview = async () => {
    if (preparingRef.current || !ready) return
    preparingRef.current = true; setPreparing(true)
    const ok = await draft.flush()
    preparingRef.current = false; setPreparing(false)
    if (ok) { if (onReview) onReview(draft.current.current.saved.draftId); else setReview(true) }
  }
  const processConfirm = (result: Awaited<ReturnType<typeof confirm.run>>) => {
    if (!result) return
    if (result.ok) { setComplete(true); onComplete?.() }
    else if (result.error.code === 'revision_conflict' || result.error.code === 'profile_version_conflict') { setReview(false); void draft.refreshConflict() }
    else draft.setError([result.error.message, ...Object.values(result.error.fieldErrors ?? {}).flat()].join(' '))
  }
  const apply = async () => {
    if (!ready || draft.dirty) return
    const saved = draft.current.current.saved
    processConfirm(await confirm.run({ method: 'POST', url: `/api/profile-drafts/${encodeURIComponent(saved.draftId)}/confirm`, kind: 'profile.draft.confirm', payload: { expectedRevision: saved.revision, baseProfileVersion: saved.baseProfileVersion }, schema: profileViewSchema }))
  }
  const statusTone = draft.operation.phase === 'reconciling' ? 'warn' : draft.operation.phase === 'submitting' ? 'primary' : draft.dirty ? 'neutral' : 'success'
  const topicsConfirmed = (['work', 'meetingWindows', 'preferences'] as const).filter(k => draft.state.form.topics[k] === 'confirmed').length
  const steps = ['직접 설정·대화', '최종 확인', '완료']
  if (complete) return <div className="space-y-6">
    <Stepper steps={steps} current={2} />
    <Card className="max-w-xl space-y-4 border-success/30">
      <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full bg-success-soft text-success"><CheckIcon size={22} /></span>
      <h1 className="text-h2 font-bold text-ink">프로필 설정을 완료했어요.</h1>
      <p className="text-muted">확정한 설정을 기준으로 미팅을 준비할 수 있어요.</p>
      <div className="flex flex-wrap gap-2"><Link className={buttonClass('primary')} href="/settings/availability">내 프로필 보기</Link><Link className={buttonClass('secondary')} href="/book">예약하기</Link></div>
    </Card>
  </div>
  return <div className="space-y-6">
    <Stepper steps={steps} current={review ? 1 : 0} />
    <header className="max-w-2xl space-y-1.5"><h1 className="text-h1 font-bold text-ink">{review ? '설정을 최종 확인해 주세요' : '나에게 맞는 미팅 시간'}</h1><p className="text-muted">직접 설정하고, 저장된 내용을 확인한 뒤 적용해요.</p></header>
    {(draft.error || draft.state.conflict) && <Alert role="alert" tone="warn"><p className="font-medium">{draft.error ?? '최신 서버 변경과 내 입력이 겹쳤어요. 비교 후 선택해 주세요.'}</p>
      {draft.state.conflict && <><details className="rounded-control bg-surface p-3 text-ink"><summary className="font-medium">최신 서버 설정 보기</summary><div className="mt-3"><ProfileSummary draft={draft.state.saved} /></div></details><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => { draft.dispatch({ type: 'resolve', keepLocal: true }); draft.setError(null) }}>내 입력으로 다시 저장</Button><Button size="sm" onClick={() => { draft.dispatch({ type: 'resolve', keepLocal: false }); draft.setError(null) }}>최신 저장값 사용</Button></div></>}
      {!draft.state.conflict && draft.operation.phase === 'idle' && <Button size="sm" onClick={() => { draft.setError(null); void draft.retry() }}>다시 시도</Button>}
    </Alert>}
    {(draft.operation.phase === 'reconciling' || ai.phase === 'reconciling' || confirm.phase === 'reconciling') && <div className="flex flex-wrap gap-2">
      {draft.operation.phase === 'reconciling' && <Button onClick={() => void draft.retry()}>저장 결과 확인</Button>}
      {ai.phase === 'reconciling' && <Button onClick={() => void ai.recover().then(processAI)}>AI 결과 확인</Button>}
      {confirm.phase === 'reconciling' && <Button onClick={() => void confirm.recover().then(processConfirm)}>확정 결과 확인</Button>}
    </div>}
    {review ? <Card className="space-y-5"><ProfileSummary draft={draft.state.saved} />
      {Object.values(draft.state.saved.topics).some(t => t !== 'confirmed') && <Alert tone="warn">직접 설정에서 세 주제를 모두 확인해 주세요.</Alert>}
    </Card> : <div className="grid items-start gap-6 lg:grid-cols-2">
      <Card><SectionHeader title="직접 설정" description="입력하면 잠시 뒤 초안에 자동 저장돼요." /><ProfileEditor form={draft.state.form} onChange={draft.edit} /></Card>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-dashed border-border-strong px-4 py-3"><p className="text-small text-muted">Calendar에서 가져온 일정이 있다면</p><Button size="sm" disabled={!ready} onClick={() => void analyze()}>가져온 일정에서 선호 단서 찾기</Button></div>
        <OnboardingChat messages={draft.state.saved.messages} text={text} onText={setText} onSend={() => void send()} disabled={!ready} pending={ai.pending} />
        <WeekSchedule values={parsed.success ? parsed.data : draft.state.saved.values} />
        {!parsed.success && <p className="text-caption text-warn-ink">잘못된 입력은 주간표에 적용하지 않았어요. 마지막 저장값을 표시해요.</p>}
      </div>
    </div>}
    <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-border bg-surface/95 px-4 py-3 shadow-raised backdrop-blur">
      <StatusPill role="status" data-testid="save-status" tone={statusTone} busy={draft.operation.phase === 'submitting' || ai.pending}>{draft.operation.phase === 'reconciling' ? '저장 결과 확인 필요 · 미저장 입력을 보존하고 있어요' : draft.operation.phase === 'submitting' ? '저장 중 · 미저장 입력이 있어요' : draft.dirty ? '미저장 변경이 있어요' : '저장됨'}{ai.pending ? ' · AI 응답 확인 중' : ''}</StatusPill>
      {!review && <span className="hidden text-small text-muted tabular sm:inline">주제 확인 {topicsConfirmed}/3</span>}
      <div className="ml-auto flex flex-wrap gap-2">
        {review ? <>
          <Button disabled={confirm.pending} onClick={() => setReview(false)}>돌아가서 수정</Button>
          <Button variant="primary" disabled={!ready || draft.dirty || Object.values(draft.state.saved.topics).some(t => t !== 'confirmed')} onClick={() => void apply()}>{confirm.pending && <Spinner />}이 설정으로 확정</Button>
        </> : <Button variant="primary" size="lg" disabled={!ready} onClick={() => void showReview()}>최종 확인</Button>}
      </div>
    </div>
  </div>
}

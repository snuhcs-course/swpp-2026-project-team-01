"use client"
import {useEffect,useRef,useState} from 'react'
import {useRouter} from 'next/navigation'
import {calendarConnectionViewSchema,syncViewSchema,type CalendarConnectionView} from '@/contracts/calendar'
import {useMutationOperation} from '@/components/hooks/useMutationOperation'
import {request} from '@/components/api'
import {GoogleConnect} from '@/components/GoogleConnect'
import {profileDraftViewSchema,type ProfileDraftView} from '@/contracts/profile'
import {ImportReviewDialog} from './ImportReviewDialog'
import {DAY_MS,kstDayStart} from '@/core/time'
import {Alert,Button,Card,Checkbox,CheckIcon,PageHeader,SectionHeader,Spinner,Stepper,StatusPill,type Tone} from '@/components/ui'
const labels={manual:'직접 설정 사용',connected:'일정 반영 중',needs_refresh:'일정을 가져와 주세요',reconnect_required:'권한 재연결 필요',decision_required:'Calendar 없이 계속할지 선택해 주세요'}
const tones:Record<keyof typeof labels,Tone>={manual:'neutral',connected:'success',needs_refresh:'warn',reconnect_required:'danger',decision_required:'warn'}
const STEPS=['연결','캘린더 선택','일정 가져오기','시간 프로필']
const when=(ms:number)=>new Date(ms).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})
const sameSet=(a:string[],b:string[])=>a.length===b.length&&a.every(x=>b.includes(x))
const pick=(v:CalendarConnectionView)=>{const saved=v.sources.filter(s=>s.selected).map(s=>s.id);return saved.length?saved:v.sources.filter(s=>s.access==='detail').map(s=>s.id)}
export function CalendarSettings({initial,mode}:{initial:CalendarConnectionView;mode:'demo'|'real'}) {
 const [view,setView]=useState(initial),[selected,setSelected]=useState(pick(initial)),[error,setError]=useState<string|null>(null),[imported,setImported]=useState(false)
 const router=useRouter(),[starting,setStarting]=useState(false),[review,setReview]=useState(false),[stage,setStage]=useState<string|null>(null)
 const draftOp=useMutationOperation<ProfileDraftView>(),analyzed=useRef<ProfileDraftView|null>(null)
 const op=useMutationOperation<CalendarConnectionView>(),sync=useMutationOperation<unknown>()
 const apply=(v:CalendarConnectionView)=>{setView(v);setSelected(pick(v))}
 const refresh=async()=>{const r=await request('GET','/api/calendar',calendarConnectionViewSchema);if(r.ok)apply(r.data)}
 const accept=async(r:Awaited<ReturnType<typeof op.run>>)=>{if(r?.ok){apply(r.data);return r.data}if(r)setError(r.error.message);return null}
 const act=async(name:string,kind:string,payload:unknown)=>{setError(null);return accept(await op.run({method:'POST',url:`/api/calendar/${name}`,kind,payload,schema:calendarConnectionViewSchema}))}
 const busy=op.pending||sync.pending
 // A demo account that has not connected yet (or disconnected) can attach its example calendar; nothing else touches Google.
 const canMockConnect=mode==='demo'&&(view.status==='manual'||view.status==='decision_required')&&view.sources.length===0
 const linked=view.sources.length>0||view.status==='connected'||view.status==='needs_refresh'
 const needsReconnect=view.status==='reconnect_required'
 const hasImport=!!(view.analysis||view.schedule)
 const step=!linked&&!needsReconnect?0:view.sources.length===0?1:!hasImport?2:3
 // Right after the account is linked there is nothing to choose from yet, so fetch the calendar list without another click.
 const autoListed=useRef(false)
 useEffect(()=>{if(autoListed.current||!linked||needsReconnect||view.sources.length>0)return;autoListed.current=true;void act('catalog','calendar.catalog',{})},[])  // eslint-disable-line react-hooks/exhaustive-deps
 const connectMock=async()=>{const v=await act('mock-connect','calendar.mock.connect',{});if(v&&v.sources.length===0)await act('catalog','calendar.catalog',{})}
 // One action: save the choice if it changed, then import with the revision that save produced.
 const importSelected=async(force=true)=>{
  setError(null);setImported(false)
  let current=view
  const changed=!sameSet(selected,view.sources.filter(s=>s.selected).map(s=>s.id))
  if(!force&&!changed&&hasImport)return true   // already saved and imported with this selection
  if(changed){const v=await act('selection','calendar.selection',{expectedSelectionRevision:view.selectionRevision,calendarIds:selected});if(!v)return false;current=v}
  const r=await sync.run({method:'POST',url:'/api/calendar/sync',kind:'calendar.sync.full',payload:{expectedSelectionRevision:current.selectionRevision},schema:syncViewSchema})
  await refresh()
  if(r&&!r.ok){setError(r.error.message);return false}
  if(r?.ok)setImported(true)
  return !!r?.ok
 }
 // Import, let the AI read the past eight weeks, then show what it made of them before moving on to the hours.
 const analyze=async(draft:ProfileDraftView)=>{const r=await draftOp.run({method:'POST',url:`/api/profile-drafts/${encodeURIComponent(draft.draftId)}/analyze`,kind:'profile.draft.analyze',payload:{expectedRevision:draft.revision},schema:profileDraftViewSchema});if(r?.ok){analyzed.current=r.data;return true}if(r)setError(r.error.message);return false}
 const startWithAi=async()=>{
  setStarting(true);setStage('일정을 저장하는 중…')
  if(!await importSelected(false)){setStarting(false);setStage(null);return}
  setStage('AI가 일정을 분류하는 중이에요 (최대 1분)')
  const d=await draftOp.run({method:'POST',url:'/api/profile-drafts',kind:'profile.draft.create',payload:{purpose:'onboarding'},schema:profileDraftViewSchema})
  if(!d?.ok){if(d)setError(d.error.message);setStarting(false);setStage(null);return}
  const ok=d.data.messages.some(m=>m.role==='assistant'&&!!m.evidenceIds?.length)?(analyzed.current=d.data,true):await analyze(d.data)
  setStarting(false);setStage(null)
  if(ok)setReview(true)
 }
 const finishReview=async(changed:boolean)=>{
  // Corrections change what the AI should see, so it reads the history again before the profile screen opens.
  if(changed&&analyzed.current){setStarting(true);setStage('보정한 내용으로 다시 분석하는 중…');await analyze(analyzed.current);setStarting(false);setStage(null)}
  router.push('/onboarding')
 }
 return <div className="space-y-6">
  <PageHeader eyebrow="설정" title="Calendar 연결" description="선택한 캘린더를 읽어 기존 일정과 겹치지 않게 준비해요. 과거 8주 관찰과 앞으로 60일의 일정을 사용해요." actions={<StatusPill role="status" tone={tones[view.status]} busy={busy}>{labels[view.status]}</StatusPill>} className="mb-0"/>
  <Stepper steps={STEPS} current={step} label="Calendar 연결 단계"/>
  {error&&<Alert tone="danger" role="alert">{error}</Alert>}
  {imported&&!error&&<Alert tone="success" role="status">일정을 가져와 저장했어요.</Alert>}
  {(op.phase==='reconciling'||sync.phase==='reconciling')&&<div className="flex flex-wrap gap-2">{op.phase==='reconciling'&&<Button onClick={()=>void op.recover().then(accept)}>작업 결과 확인</Button>}{sync.phase==='reconciling'&&<Button onClick={()=>void sync.recover().then(refresh)}>가져오기 결과 확인</Button>}</div>}
  <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
   <Card className="space-y-4">
    <SectionHeader title="1. 계정 연결" description={mode==='real'?'Google Calendar를 읽기 전용 권한으로 연결해요.':'데모 계정은 Google 대신, 이 계정에 미리 세팅된 예시 일정을 가져와요.'} className="mb-0"/>
    {mode==='real'
     ?linked&&!needsReconnect
      ?<Button disabled aria-label="Google Calendar 연결됨"><CheckIcon/>Google Calendar 연결됨</Button>
      :<div className="flex flex-wrap items-center gap-3"><GoogleConnect purpose="calendar" returnPath="/settings/calendars" label={needsReconnect?'Google Calendar 다시 연결':undefined}/>{!needsReconnect&&<a href="/onboarding" className="text-small font-medium text-primary underline-offset-4 hover:underline">Calendar 없이 직접 설정하기</a>}</div>
     :canMockConnect
      ?<Button variant="primary" disabled={busy} onClick={()=>void connectMock()}>{busy&&<Spinner/>}예시 Calendar 연결</Button>
      :<p className="flex items-center gap-1.5 rounded-control bg-surface-sunken px-3 py-2.5 text-small text-ink-soft"><CheckIcon/>예시 Calendar 연결됨 · Google에는 접속하지 않아요</p>}
    {linked&&<Button disabled={busy} onClick={()=>void act('catalog','calendar.catalog',{})}>캘린더 목록 새로고침</Button>}
    {hasImport&&<dl className="grid gap-1 border-t border-border pt-4 text-small">
     {view.analysis&&<div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted">과거 분석 기준</dt><dd className="font-medium text-ink tabular">{when(view.analysis.completedAt)}</dd></div>}
     {view.schedule&&<div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted">일정 확인</dt><dd className="font-medium text-ink tabular">{when(view.schedule.completedAt)}</dd></div>}
    </dl>}
    {view.status==='decision_required'&&!canMockConnect&&<Button disabled={busy} onClick={()=>void act('decision','calendar.use',{expectedRevision:view.revision,choice:'continue_without_calendar'})}>Calendar 없이 계속</Button>}
   </Card>
   <Card>
    <fieldset disabled={busy} className="min-w-0">
     <legend className="mb-1 text-h3 font-semibold text-ink">2. 사용할 캘린더</legend>
     <p className="mb-3 text-small text-muted">{view.sources.length?'가져올 캘린더를 고르세요. 선택은 가져올 때 함께 저장돼요.':linked?'캘린더 목록을 불러오는 중이거나 아직 없어요.':'계정을 연결하면 캘린더 목록이 나타나요.'}</p>
     <div className="divide-y divide-border">{view.sources.map(s=><Checkbox key={s.id} checked={selected.includes(s.id)} onChange={e=>setSelected(e.target.checked?[...selected,s.id]:selected.filter(id=>id!==s.id))} label={s.name} description={`${s.access==='busy'?'바쁜 시간만':'일정 정보'} · ${s.timeZone}`}/>)}</div>
    </fieldset>
    {view.sources.length>0&&<div className="mt-4 space-y-3 border-t border-border pt-4">
     <div className="flex flex-wrap items-center gap-2">
      <Button disabled={busy||starting||selected.length===0} onClick={()=>void importSelected()}>{sync.pending&&!starting&&<Spinner/>}저장하기</Button>
      <Button variant="primary" disabled={busy||starting||selected.length===0} onClick={()=>void startWithAi()}>{starting&&<Spinner/>}AI로 설정 시작하기</Button>
      <Button variant="danger" disabled={busy||starting} onClick={()=>void act('disconnect','calendar.disconnect',{expectedSelectionRevision:view.selectionRevision})}>연결 해제 · 가져온 정보 삭제</Button>
     </div>
     {stage&&<p role="status" className="flex items-center gap-2 text-small text-ink-soft"><Spinner/>{stage}</p>}
     <p className="text-small text-muted">저장하기는 선택한 캘린더의 일정을 가져와 저장해요. AI로 설정 시작하기는 저장한 뒤 AI가 지난 8주 일정을 분류하고, 그 결과를 확인한 다음 시간 프로필 설정으로 이어가요. 미팅 가능 시간은 직접 확인해야 확정돼요.</p>
     {selected.length===0&&<p className="text-small text-muted">가져올 캘린더를 하나 이상 선택해 주세요.</p>}
    </div>}
   </Card>
  </div>
 {review&&<ImportReviewDialog confirmLabel="확인했어요 · AI 설정 계속" analysisWindow={view.analysis?{fromMs:kstDayStart(view.analysis.startedAt)-56*DAY_MS,toMs:kstDayStart(view.analysis.startedAt)}:undefined} onConfirm={c=>void finishReview(c)} onClose={()=>setReview(false)}/>}
 </div>
}

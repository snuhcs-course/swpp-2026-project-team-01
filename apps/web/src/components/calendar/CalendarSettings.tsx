"use client"
import {useState} from 'react'
import Link from 'next/link'
import {calendarConnectionViewSchema,syncViewSchema,type CalendarConnectionView} from '@/contracts/calendar'
import {useMutationOperation} from '@/components/hooks/useMutationOperation'
import {request} from '@/components/api'
import {GoogleConnect} from '@/components/GoogleConnect'
import {Alert,Button,Card,Checkbox,PageHeader,SectionHeader,Spinner,StatusPill,buttonClass,type Tone} from '@/components/ui'
const labels={manual:'직접 설정 사용',connected:'일정 반영 중',needs_refresh:'일정을 가져와 주세요',reconnect_required:'권한 재연결 필요',decision_required:'Calendar 없이 계속할지 선택해 주세요'}
const tones:Record<keyof typeof labels,Tone>={manual:'neutral',connected:'success',needs_refresh:'warn',reconnect_required:'danger',decision_required:'warn'}
const when=(ms:number)=>new Date(ms).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})
export function CalendarSettings({initial,mode}:{initial:CalendarConnectionView;mode:'demo'|'real'}) {
 const [view,setView]=useState(initial),[selected,setSelected]=useState(initial.sources.filter(s=>s.selected).map(s=>s.id)),[error,setError]=useState<string|null>(null)
 const op=useMutationOperation<CalendarConnectionView>(),sync=useMutationOperation<unknown>()
 const refresh=async()=>{const r=await request('GET','/api/calendar',calendarConnectionViewSchema);if(r.ok){setView(r.data);setSelected(r.data.sources.filter(s=>s.selected).map(s=>s.id))}}
 const accept=async(r:Awaited<ReturnType<typeof op.run>>)=>{if(r?.ok){setView(r.data);setSelected(r.data.sources.filter(s=>s.selected).map(s=>s.id))}else if(r)setError(r.error.message)}
 const act=async(name:string,kind:string,payload:unknown)=>{setError(null);await accept(await op.run({method:'POST',url:`/api/calendar/${name}`,kind,payload,schema:calendarConnectionViewSchema}))}
 const busy=op.pending||sync.pending
 // A demo account that has not connected yet (or disconnected) can attach its example calendar; nothing else touches Google.
 const canMockConnect=mode==='demo'&&(view.status==='manual'||view.status==='decision_required')
 return <div className="space-y-6">
  <PageHeader eyebrow="설정" title="Calendar 연결" description="선택한 캘린더를 읽어 기존 일정과 겹치지 않게 준비해요. 과거 8주 관찰과 앞으로 60일의 일정을 사용해요." actions={<StatusPill role="status" tone={tones[view.status]} busy={busy}>{labels[view.status]}</StatusPill>} className="mb-0"/>
  {error&&<Alert tone="danger" role="alert">{error}</Alert>}
  {(op.phase==='reconciling'||sync.phase==='reconciling')&&<div className="flex flex-wrap gap-2">{op.phase==='reconciling'&&<Button onClick={()=>void op.recover().then(accept)}>작업 결과 확인</Button>}{sync.phase==='reconciling'&&<Button onClick={()=>void sync.recover().then(refresh)}>가져오기 결과 확인</Button>}</div>}
  <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
   <Card className="space-y-4">
    <SectionHeader title="계정 연결" description={mode==='real'?'Google Calendar를 읽기 전용 권한으로 연결해요.':'데모 계정은 Google 대신, 이 계정에 미리 세팅된 예시 일정을 가져와요.'} className="mb-0"/>
    {mode==='real'?<GoogleConnect purpose="calendar" returnPath="/settings/calendars"/>:canMockConnect?<Button variant="primary" disabled={busy} onClick={()=>void act('mock-connect','calendar.mock.connect',{})}>{busy&&<Spinner/>}예시 Calendar 연결</Button>:<p className="rounded-control bg-surface-sunken px-3 py-2.5 text-small text-ink-soft">예시 Calendar에 연결돼 있어요. Google에는 접속하지 않아요.</p>}
    {(mode==='real'||!canMockConnect)&&<Button disabled={busy} onClick={()=>void act('catalog','calendar.catalog',{})}>캘린더 목록 불러오기</Button>}
    {(view.analysis||view.schedule)&&<dl className="grid gap-1 border-t border-border pt-4 text-small">
     {view.analysis&&<div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted">과거 분석 기준</dt><dd className="font-medium text-ink tabular">{when(view.analysis.completedAt)}</dd></div>}
     {view.schedule&&<div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted">일정 확인</dt><dd className="font-medium text-ink tabular">{when(view.schedule.completedAt)}</dd></div>}
    </dl>}
    {view.status==='decision_required'&&<Button disabled={busy} onClick={()=>void act('decision','calendar.use',{expectedRevision:view.revision,choice:'continue_without_calendar'})}>Calendar 없이 계속</Button>}
   </Card>
   <Card>
    <fieldset disabled={busy} className="min-w-0">
     <legend className="mb-1 text-h3 font-semibold text-ink">사용할 캘린더</legend>
     <p className="mb-3 text-small text-muted">{view.sources.length?'확인할 캘린더를 고르고 저장한 뒤 일정을 가져와요.':'불러온 캘린더가 없어요.'}</p>
     <div className="divide-y divide-border">{view.sources.map(s=><Checkbox key={s.id} checked={selected.includes(s.id)} onChange={e=>setSelected(e.target.checked?[...selected,s.id]:selected.filter(id=>id!==s.id))} label={s.name} description={`${s.access==='busy'?'바쁜 시간만':'일정 정보'} · ${s.timeZone}`}/>)}</div>
     {view.sources.length>0&&<div className="mt-4 flex flex-wrap gap-2"><Button onClick={()=>void act('selection','calendar.selection',{expectedSelectionRevision:view.selectionRevision,calendarIds:selected})}>선택 저장</Button></div>}
    </fieldset>
    {(view.sources.some(s=>s.selected)||view.sources.length>0)&&<div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
     {view.sources.some(s=>s.selected)&&<Button variant="primary" disabled={busy} onClick={async()=>{setError(null);const r=await sync.run({method:'POST',url:'/api/calendar/sync',kind:'calendar.sync.full',payload:{expectedSelectionRevision:view.selectionRevision},schema:syncViewSchema});if(r&&!r.ok)setError(r.error.message);await refresh()}}>{sync.pending&&<Spinner/>}선택한 일정 가져오기</Button>}
     {view.sources.length>0&&<Button variant="danger" disabled={busy} onClick={()=>void act('disconnect','calendar.disconnect',{expectedSelectionRevision:view.selectionRevision})}>연결 해제 · 가져온 정보 삭제</Button>}
    </div>}
   </Card>
  </div>
  <p><Link href="/onboarding" className={buttonClass('link')}>시간 프로필 설정으로 이동</Link></p>
 </div>
}

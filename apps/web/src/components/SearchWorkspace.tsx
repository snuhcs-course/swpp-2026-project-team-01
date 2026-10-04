"use client"
import {useEffect,useRef,useState} from 'react'
import {useRouter} from 'next/navigation'
import Link from 'next/link'
import {searchScreenViewSchema,type SearchScreenView} from '@/contracts/search'
import {requestViewSchema,type RequestView} from '@/contracts/booking'
import {useMutationOperation} from './hooks/useMutationOperation'
import {request} from './api'
import {Alert,Button,ChatBubble,ChatPending,ClockIcon,Card,cn,Field,Input,PageHeader,SectionHeader,SendIcon,Spinner,Textarea,buttonClass,CheckIcon,XIcon} from './ui'
const dimensionNames:Record<string,string>={weekdays:'요일',timeOfDay:'시작 시간',location:'장소·온라인',meetingTypes:'미팅 양식',dateRange:'날짜',order:'정렬',slack:'앞뒤 여유'}
export function SearchWorkspace({hostId,hostName,initial,previous}:{hostId:string;hostName:string;initial:SearchScreenView|null;previous:{id:string}[]}) {
 const router=useRouter(),[state,setState]=useState(initial),[text,setText]=useState(''),[error,setError]=useState<string|null>(null),[selected,setSelected]=useState<number|null>(null),[message,setMessage]=useState(''),[sent,setSent]=useState(false)
 const requestRef=useRef<HTMLElement>(null)
 useEffect(()=>{if(selected!==null)requestRef.current?.querySelector('textarea')?.focus()},[selected])
 const op=useMutationOperation<SearchScreenView>(),booking=useMutationOperation<RequestView>(),busy=op.pending||booking.pending
 const accept=async(r:Awaited<ReturnType<typeof op.run>>)=>{if(r?.ok){setState(r.data);setText('');setSelected(null);setError(null);router.replace(`/book/${encodeURIComponent(hostId)}?search=${encodeURIComponent(r.data.searchId)}`)}else if(r){setError(r.error.message);if(r.error.code==='revision_conflict'&&state){const current=await request('GET',`/api/searches/${state.searchId}`,searchScreenViewSchema);if(current.ok)setState(current.data)}}}
 const act=(path:string,kind:string,payload:unknown)=>op.run({method:'POST',url:path,kind,payload,schema:searchScreenViewSchema}).then(accept)
 const condition=(command:unknown)=>state&&act(`/api/searches/${state.searchId}/conditions`,'search.conditions',{expectedRevision:state.revision,commands:[command]})
 const booked=(r:Awaited<ReturnType<typeof booking.run>>)=>{if(r?.ok){setSent(true);setError(null)}else if(r)setError(r.error.message)}
 return <div className="space-y-6">
  <PageHeader eyebrow="예약하기" title={`${hostName}님과 미팅`} description="원하는 조건을 말하면 AI가 가능한 시간을 다시 찾아요."/>
  {!state?<Card className="max-w-xl space-y-5">
   <div className="space-y-1"><p className="text-lead font-semibold text-ink">내 기본 선호를 적용해서 새로 찾아볼까요?</p><p className="text-small text-muted">이번 예약의 조건은 기본 선호와 별도로 유지돼요.</p></div>
   <div className="flex flex-wrap items-center gap-3"><Button variant="primary" disabled={busy} onClick={()=>void act('/api/searches','search.create',{hostId})}>{op.pending&&<Spinner/>}새 예약 탐색 시작</Button><Link href="/settings/availability" className={buttonClass('link')}>내 기본 선호 설정</Link></div>
   {previous.length>0&&<div className="border-t border-border pt-4"><h2 className="mb-2 text-small font-semibold text-ink-soft">이전 탐색 이어가기</h2><ul className="flex flex-wrap gap-2">{previous.map((s,i)=><li key={s.id}><Link className={buttonClass('secondary','sm')} href={`/book/${hostId}?search=${s.id}`}>이전 탐색 {i+1}</Link></li>)}</ul></div>}
  </Card>:<>
   <section aria-label="적용 중인 조건" className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
     {state.chips.length===0&&<span className="text-small text-muted">적용 중인 조건이 없어요.</span>}
     {state.chips.map(chip=>{const inherited=state.sources[chip.key==='places'?'location':chip.key]==='inherit';return <span key={chip.key} className={cn('inline-flex min-h-9 items-center gap-1 rounded-full border py-1 pr-1 pl-3 text-small',inherited?'border-border-strong bg-surface text-ink-soft':'border-primary/40 bg-primary-soft text-primary-soft-ink')}>
      <span className="font-medium">{chip.label}</span><span aria-hidden="true">·</span><span className="text-caption">{inherited?'기본 선호':'이번 예약'}</span>
      <button disabled={busy} aria-label={`${chip.text} 조건 끄기`} className="ml-0.5 inline-flex size-7 items-center justify-center rounded-full hover:bg-surface-sunken disabled:opacity-40" onClick={()=>void condition({kind:'disable',dimension:chip.key==='places'?'location':chip.key})}><XIcon size={14}/></button>
     </span>})}
    </div>
    <details className="group rounded-card border border-border bg-surface px-4 py-3 text-small"><summary className="font-medium text-ink-soft">기본 선호 복원·갱신</summary>
     <div className="mt-3 space-y-3"><p className="text-muted">기본 프로필 버전 <span className="tabular">{state.inheritedProfileVersion??'없음'}</span>. 이번 예약의 조건은 별도로 유지돼요.</p>
      <div className="flex flex-wrap gap-2">{Object.entries(dimensionNames).map(([key,name])=><Button size="sm" disabled={busy} key={key} onClick={()=>void condition({kind:'restore_inherited',dimension:key})}>{name} 복원</Button>)}</div>
      <Button variant="link" disabled={busy} onClick={()=>void condition({kind:'apply_latest_defaults'})}>최신 기본 선호 가져오기</Button></div>
    </details>
   </section>
   {state.candidateState!=='ready'&&<Alert tone="warn" role="status">일정 또는 설정이 바뀌었어요. 후보를 새로 확인해 주세요.</Alert>}
   <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
    <Card className="flex flex-col gap-4">
     <SectionHeader title="예약 도우미와 대화" description="예: 다음 주 화·목 오후가 좋아요" className="mb-0"/>
     <section className="space-y-4" role="log" aria-label="예약 대화">{state.messages.map(m=><ChatBubble key={m.id} from={m.role==='assistant'?'assistant':'user'} name={m.role==='assistant'?'예약 도우미':'나'}><p className="whitespace-pre-wrap">{m.content}</p></ChatBubble>)}{op.pending&&<ChatPending>가능한 시간을 찾고 있어요…</ChatPending>}</section>
     <form className="flex gap-2 border-t border-border pt-4" onSubmit={e=>{e.preventDefault();if(text.trim())void act(`/api/searches/${state.searchId}/turns`,'search.turn',{expectedRevision:state.revision,text})}}><Input aria-label="예약 조건 메시지" className="min-w-0 flex-1" value={text} onChange={e=>setText(e.target.value)} placeholder="예: 다음 주 화·목 오후가 좋아요"/><Button type="submit" variant="primary" disabled={busy||!text.trim()}><SendIcon/>보내기</Button></form>
    </Card>
    <div className="space-y-4">
     <Card>
      <SectionHeader title="가능한 시간" description={state.candidates.length?`후보 ${state.candidates.length}개 · 하나를 골라 요청을 보내요`:'조건에 맞는 후보가 없어요. 조건을 바꿔 보세요.'} actions={<Button size="sm" disabled={busy} onClick={()=>void act(`/api/searches/${state.searchId}/refresh`,'search.refresh',{expectedRevision:state.revision})}>가능한 시간 다시 확인</Button>}/>
      <ul className="space-y-2">{state.candidates.map((slot,i)=><li key={`${slot.startAt}-${slot.placeId}-${slot.meetingTypeId}`}><button aria-pressed={selected===i} disabled={busy||state.candidateState!=='ready'} className={cn('flex min-h-12 w-full items-center gap-3 rounded-control border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',selected===i?'border-primary bg-primary-soft text-primary-soft-ink':'border-border bg-surface hover:border-primary')} onClick={()=>{setSelected(i);setSent(false)}}><ClockIcon className={selected===i?'text-primary':'text-muted'}/><span className="flex-1 font-medium tabular">{state.labels[i]}</span>{selected===i&&<CheckIcon className="text-primary"/>}</button></li>)}</ul>
     </Card>
     {selected!==null&&<section ref={requestRef} aria-labelledby="request-heading" onKeyDown={e=>{if(e.key==='Escape')setSelected(null)}} className="space-y-4 rounded-card border-2 border-primary bg-surface p-5 shadow-raised">
      <div><p className="text-caption font-semibold text-primary">예약 요청</p><h2 id="request-heading" className="text-h3 font-semibold text-ink tabular">{state.labels[selected]}</h2></div>
      {sent?<Alert tone="success" role="status">요청을 보냈어요. <Link className={buttonClass('link')} href="/requests/sent">내 요청 보기</Link></Alert>:<>
       <Field label="보낼 메시지" hint="최대 500자. 호스트가 요청과 함께 읽어요."><Textarea maxLength={500} value={message} onChange={e=>setMessage(e.target.value)}/></Field>
      </>}
      <div className="flex flex-wrap items-center gap-2">{!sent&&<Button variant="primary" disabled={busy||!message.trim()} onClick={()=>void booking.run({method:'POST',url:'/api/requests',kind:'request.create',payload:{searchId:state.searchId,expectedSearchRevision:state.revision,slot:state.candidates[selected],message},schema:requestViewSchema}).then(booked)}>{booking.pending&&<Spinner/>}요청 보내기</Button>}<Button variant="ghost" disabled={busy} onClick={()=>setSelected(null)}>닫기</Button></div>
     </section>}
    </div>
   </div>
   <Link href={`/book/${hostId}`} className={buttonClass('link')}>다른 예약 탐색 시작</Link></>}
  {error&&<Alert tone="warn" role="alert"><p>{error} <Link href="/settings/calendars" className={buttonClass('link')}>Calendar 연결</Link></p></Alert>}
  {(op.phase==='reconciling'||booking.phase==='reconciling')&&<div className="flex flex-wrap gap-2">{op.phase==='reconciling'&&<Button onClick={()=>void op.recover().then(accept)}>탐색 결과 확인</Button>}{booking.phase==='reconciling'&&<Button onClick={()=>void booking.recover().then(booked)}>예약 요청 결과 확인</Button>}</div>}
 </div>
}

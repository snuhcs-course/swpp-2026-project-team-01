"use client"
import {useEffect,useRef,useState} from 'react'
import {z} from 'zod'
import {request} from '@/components/api'
import {importedEventViewSchema,type ImportedEventView} from '@/contracts/calendar'
import {Alert,Badge,Button,Spinner} from '@/components/ui'
import {EventEditor} from './ImportedEvents'
import {CLASS_LABEL,LOCATION_LABEL} from './format'
type Event=ImportedEventView
type View='class'|'place'
// An AI suggestion counts as the group an event is shown under until the user confirms or changes it.
const classOf=(e:Event)=>e.classification!=='unknown'?e.classification:(e.aiClassification&&e.aiClassification!=='unknown'?e.aiClassification:'unknown')
const GROUPS:Record<View,{keys:string[];of:(e:Event)=>string;label:Record<string,string>}>={
 class:{keys:['business','personal','unknown'],of:classOf,label:CLASS_LABEL},
 place:{keys:['office','place','online','none'],of:e=>e.locationKind,label:LOCATION_LABEL},
}
/** After an import: look through what was brought in, grouped by category or by place, fix anything wrong, then continue. */
export function ImportReviewDialog({confirmLabel,onConfirm,onClose}:{confirmLabel:string;onConfirm:(changed:boolean)=>void;onClose:()=>void}){
 const [events,setEvents]=useState<Event[]|null>(null),[error,setError]=useState<string|null>(null),[view,setView]=useState<View>('class'),[changed,setChanged]=useState(false)
 const ref=useRef<HTMLDivElement>(null)
 useEffect(()=>{void request('GET','/api/imported-events',z.array(importedEventViewSchema)).then(r=>{if(r.ok)setEvents(r.data);else setError(r.error.message)})},[])
 useEffect(()=>{ref.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)},[onClose])
 const g=GROUPS[view]
 const update=(e:Event)=>{setChanged(true);setEvents(list=>list?.map(x=>x.eventId===e.eventId?e:x)??null)}
 return <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-6" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="import-review-title" className="flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-t-card bg-surface shadow-xl outline-none sm:rounded-card">
   <div className="space-y-3 border-b border-border px-5 py-4">
    <div className="flex items-start justify-between gap-3"><div><h2 id="import-review-title" className="text-h2 font-bold text-ink">가져온 일정 확인</h2><p className="text-small text-muted">분류와 장소가 맞는지 살펴보세요. 고친 내용은 이 앱에만 적용되고 Google 일정은 바뀌지 않아요.</p></div><Button variant="link" size="sm" onClick={onClose} aria-label="닫기">닫기</Button></div>
    <div role="tablist" aria-label="보기 기준" className="flex gap-2">{(['class','place'] as View[]).map(v=><Button key={v} size="sm" role="tab" aria-selected={view===v} variant={view===v?'primary':'secondary'} onClick={()=>setView(v)}>{v==='class'?'분류별':'장소별'}</Button>)}</div>
   </div>
   <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
    {error&&<Alert tone="danger" role="alert">{error}</Alert>}
    {!events&&!error&&<p className="flex items-center gap-2 text-small text-muted"><Spinner/>일정을 불러오는 중…</p>}
    {events&&events.length===0&&<p className="rounded-control border border-dashed border-border-strong px-4 py-6 text-center text-small text-muted">가져온 일정이 없어요.</p>}
    {events&&events.length>0&&g.keys.map(key=>{const list=events.filter(e=>g.of(e)===key);return <details key={key} open={list.length>0&&list.length<=8} className="rounded-control border border-border">
     <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 py-2 font-medium text-ink"><span>{g.label[key]}{view==='class'&&key==='unknown'&&<span className="ml-2 text-caption font-normal text-muted">AI도 판단하지 못했거나 아직 분류 전</span>}</span><Badge tone={list.length?'primary':'neutral'}>{list.length}건</Badge></summary>
     <ul className="space-y-2 border-t border-border p-2">{list.length===0?<li className="px-2 py-3 text-small text-muted">해당하는 일정이 없어요.</li>:list.map(e=><EventEditor key={`${e.eventId}-${e.revision}`} event={e} hidden={false} onChange={update}/>)}</ul>
    </details>})}
   </div>
   <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
    {changed&&<span className="mr-auto text-small font-medium text-success">보정 내용이 저장됐어요</span>}
    <Button variant="primary" disabled={!events} onClick={()=>onConfirm(changed)}>{confirmLabel}</Button>
   </div>
  </div>
 </div>
}

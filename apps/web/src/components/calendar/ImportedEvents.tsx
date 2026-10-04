"use client"
import {useState} from 'react'
import {z} from 'zod'
import {request} from '@/components/api'
import {useMutationOperation} from '@/components/hooks/useMutationOperation'
import {importedEventViewSchema,type ImportedEventView} from '@/contracts/calendar'
import {Alert,Badge,Button,Card,ChevronDownIcon,Input,SearchIcon,SectionHeader,Select,Spinner} from '@/components/ui'
import {EventAnnotationForm} from './EventAnnotationForm'
import {CLASS_LABEL,LOCATION_LABEL,formatEventRange} from './format'
export {formatEventRange}
const eventSchema=importedEventViewSchema
type Event=ImportedEventView
function EventEditor({event,hidden}:{event:Event;hidden:boolean}){
 const [saved,setSaved]=useState(event)
 const range=formatEventRange(event)
 return <li hidden={hidden} className="rounded-control border border-border bg-surface">
  <details className="group">
   <summary className="flex min-h-12 list-none items-center gap-3 px-3 py-2.5 hover:bg-surface-sunken/70 [&::-webkit-details-marker]:hidden">
    <span className="min-w-0 flex-1">
     <span className="block truncate font-medium text-ink">{event.title}</span>
     <span className="block text-caption text-muted tabular">{range.text}</span>
    </span>
    <span className="hidden flex-wrap justify-end gap-1 sm:flex">
     {saved.needsConfirmation&&<Badge tone="warn">다시 확인 필요</Badge>}
     {saved.classification!=='unknown'&&<Badge tone="primary">{CLASS_LABEL[saved.classification]??saved.classification}</Badge>}
     {saved.classification==='unknown'&&saved.aiClassification&&saved.aiClassification!=='unknown'&&<Badge>AI 제안 · {CLASS_LABEL[saved.aiClassification]}</Badge>}
     {saved.locationKind!=='none'&&<Badge>{LOCATION_LABEL[saved.locationKind]??saved.locationKind}</Badge>}
    </span>
    {saved.needsConfirmation&&<span className="sm:hidden"><Badge tone="warn">확인</Badge></span>}
    <ChevronDownIcon className="shrink-0 text-muted transition-transform group-open:rotate-180"/>
   </summary>
   <div className="border-t border-border px-3 pt-3 pb-4"><EventAnnotationForm saved={saved} onSaved={setSaved}/></div>
  </details>
 </li>
}

type Filter='all'|'attention'|'unclassified'
export function ImportedEvents(){
 const [events,setEvents]=useState<Event[]|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false),[query,setQuery]=useState(''),[filter,setFilter]=useState<Filter>('all')
 const q=query.trim().toLowerCase()
 const visible=(e:Event)=>(!q||e.title.toLowerCase().includes(q))&&(filter==='all'||(filter==='attention'?e.needsConfirmation:e.classification==='unknown'))
 const shown=events?.filter(visible).length??0
 return <Card className="space-y-4">
  <SectionHeader title="가져온 일정" description="최근 일정 최대 500건을 표시해요. 보정은 이 앱에만 적용돼요." className="mb-0" actions={<Button disabled={loading} onClick={async()=>{setLoading(true);const r=await request('GET','/api/imported-events',z.array(eventSchema));setLoading(false);if(r.ok){setEvents(r.data);setError(null)}else setError(r.error.message)}}>{loading&&<Spinner/>}가져온 일정 확인·보정</Button>}/>
  {error&&<Alert tone="danger" role="alert">{error}</Alert>}
  {events&&<>
   <div className="flex flex-wrap items-end gap-3">
    <label className="relative min-w-0 flex-1 basis-56"><span className="sr-only">일정 검색</span><SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"/><Input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="제목으로 찾기" className="w-full pl-9"/></label>
    <label className="flex items-center gap-2 text-small"><span className="text-muted">표시 범위</span><Select value={filter} onChange={e=>setFilter(e.target.value as Filter)} wrapperClassName="w-40"><option value="all">전체</option><option value="attention">다시 확인 필요</option><option value="unclassified">분류 확인 필요</option></Select></label>
    <p className="ml-auto text-small text-muted tabular" aria-live="polite">{events.length}건 중 {shown}건</p>
   </div>
   {events.length===0?<p className="rounded-control border border-dashed border-border-strong px-4 py-6 text-center text-small text-muted">가져온 일정이 없어요. 위에서 캘린더를 선택하고 일정을 가져와 주세요.</p>:
    shown===0&&<p className="rounded-control border border-dashed border-border-strong px-4 py-6 text-center text-small text-muted">조건에 맞는 일정이 없어요.</p>}
   <ul className="space-y-2">{events.map(e=><EventEditor key={`${e.eventId}-${e.revision}`} event={e} hidden={!visible(e)}/>)}</ul>
  </>}
 </Card>
}

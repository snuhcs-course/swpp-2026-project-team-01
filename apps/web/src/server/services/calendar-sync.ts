import {projectAnnotation,type AnnotationProjection} from '@/core/annotations'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { DomainError, type OperationMeta } from '@/contracts/common'
import { selectionSchema,syncSchema,useDecisionSchema,type SyncInput,type SyncView,type CalendarConnectionView } from '@/contracts/calendar'
import { DAY_MS, kstDayStart } from '@/core/time'
import { normalizeCalendarEvents,zonedDateStart,type CalendarSourceInput } from '@/core/calendar'
import type { ServiceContext } from '../runtime'
import { all, insertMany, lock, one, run, type Db } from '../db/client'
import type { CalendarProvider } from '../providers/google-calendar'
import { beginOperation,finishOperation,failOperation,runOperation } from './operations'
interface Connection {id:string;user_id:string;status:string;revision:number;selection_revision:number;generation:number;analysis_snapshot_id:string|null;schedule_snapshot_id:string|null}
interface Source {id:string;provider_calendar_id:string;name:string;timezone:string|null;access_role:string;selected:number}
// Readers take the executor (`ctx.db` or the open transaction). `forUpdate` locks the connection row until the transaction ends,
// so selection changes, disconnects and sync commits cannot interleave on one connection.
async function connection(db:Db,userId:string,required=true,forUpdate=false) {
 const row=await one<Connection>(db,`SELECT * FROM calendar_connections WHERE user_id=?${forUpdate?' FOR UPDATE':''}`,[userId])
 if(!row&&required)throw new DomainError('not_found','Calendar 연결을 찾을 수 없어요')
 return row
}
function sources(db:Db,id:string){return all<Source>(db,'SELECT * FROM calendar_sources WHERE connection_id=? ORDER BY provider_calendar_id',[id])}
async function view(db:Db,id:string|null):Promise<SyncView|null> {
 if(!id)return null
 const row=await one<{id:string;generation:number;selection_revision:number;scope:string;from_at:number;to_at:number;started_at:number;completed_at:number}>(db,'SELECT * FROM calendar_snapshots WHERE id=?',[id])
 return row?{snapshotId:row.id,generation:row.generation,selectionRevision:row.selection_revision,scope:row.scope==='full'?'full':'future',fromMs:row.from_at,toMs:row.to_at,startedAt:row.started_at,completedAt:row.completed_at}:null
}
export async function readCalendarConnection(db:Db,userId:string):Promise<CalendarConnectionView> {
 const c=await connection(db,userId,false)
 const user=await one<{calendar_use_state:string;calendar_use_revision:number}>(db,'SELECT calendar_use_state,calendar_use_revision FROM users WHERE id=?',[userId])
 if(!user)throw new DomainError('not_found','사용자를 찾을 수 없어요')
 let status=user.calendar_use_state==='not_connected'?'manual':user.calendar_use_state
 if(c?.status==='reconnect_required')status='reconnect_required'
 const last=c?await one<{error_json:string}>(db,"SELECT error_json FROM calendar_sync_runs WHERE connection_id=? AND error_json IS NOT NULL ORDER BY started_at DESC LIMIT 1",[c.id]):undefined
 return {status:status as CalendarConnectionView['status'],revision:user.calendar_use_revision,selectionRevision:c?.selection_revision??0,sources:c?(await sources(db,c.id)).map(s=>({id:s.provider_calendar_id,name:s.name,selected:!!s.selected,timeZone:s.timezone??'Asia/Seoul',access:s.access_role==='freeBusyReader'?'busy':'detail'})):[],analysis:await view(db,c?.analysis_snapshot_id??null),schedule:await view(db,c?.schedule_snapshot_id??null),lastError:last?JSON.parse(last.error_json).code:null}
}
async function checkConnection(db:Db,userId:string,expected:number) {
 const c=(await connection(db,userId,true,true))!
 if(c.selection_revision!==expected)throw new DomainError('calendar_snapshot_changed','캘린더 선택이 변경됐어요')
 if(c.status!=='connected')throw new DomainError('calendar_reconnect_required','Calendar를 다시 연결해 주세요')
 return c
}
async function assertBasis(db:Db,userId:string,base:Connection) {
 const c=(await connection(db,userId,true,true))!
 if(c.id!==base.id||c.generation!==base.generation||c.selection_revision!==base.selection_revision||c.status!=='connected')throw new DomainError('calendar_snapshot_changed','캘린더 선택 또는 연결이 변경됐어요')
}
async function clearDerived(db:Db,c:Connection,removeAnnotations=true) {
 await run(db,`UPDATE draft_messages SET content='근거 제거됨',proposal_json=NULL,evidence_id=NULL WHERE role='assistant' AND evidence_id IN (SELECT e.id FROM analysis_evidence e JOIN analysis_runs a ON a.id=e.analysis_id WHERE a.user_id=?)`,[c.user_id])
 await run(db,'DELETE FROM analysis_runs WHERE user_id=?',[c.user_id])
 await run(db,'DELETE FROM event_classifications WHERE connection_id=?',[c.id])
 // The connection still points at its snapshots; detach them first so the foreign keys allow the delete.
 await run(db,'UPDATE calendar_connections SET analysis_snapshot_id=NULL,schedule_snapshot_id=NULL WHERE id=?',[c.id])
 await run(db,'DELETE FROM calendar_snapshots WHERE connection_id=?',[c.id])
 if(removeAnnotations)await run(db,'DELETE FROM event_annotations WHERE connection_id=?',[c.id])
}
export async function saveCalendarSelection(ctx:ServiceContext,userId:string,input:z.infer<typeof selectionSchema>,op:OperationMeta) {
 const parsed=selectionSchema.parse(input)
 return runOperation(ctx,userId,'calendar.selection',parsed,op,async tx=>{
  const c=await checkConnection(tx,userId,parsed.expectedSelectionRevision),known=await sources(tx,c.id)
  if(parsed.calendarIds.some(id=>!known.some(s=>s.provider_calendar_id===id)))throw new DomainError('invalid_input','선택 가능한 캘린더를 확인해 주세요')
  if(known.every(s=>!!s.selected===parsed.calendarIds.includes(s.provider_calendar_id)))return readCalendarConnection(tx,userId)
  await clearDerived(tx,c,false)
  for(const s of known)if(!parsed.calendarIds.includes(s.provider_calendar_id))await run(tx,'DELETE FROM event_annotations WHERE connection_id=? AND calendar_id=?',[c.id,s.provider_calendar_id])
  for(const s of known)await run(tx,'UPDATE calendar_sources SET selected=?,revision=revision+1 WHERE id=?',[parsed.calendarIds.includes(s.provider_calendar_id)?1:0,s.id])
  await run(tx,'UPDATE calendar_connections SET selection_revision=selection_revision+1,generation=generation+1,revision=revision+1 WHERE id=?',[c.id])
  await run(tx,'UPDATE users SET calendar_use_state=?,calendar_use_revision=calendar_use_revision+1,schedule_revision=schedule_revision+1 WHERE id=?',[parsed.calendarIds.length?'needs_refresh':'decision_required',userId])
  return readCalendarConnection(tx,userId)
 })
}
export async function continueWithoutCalendar(ctx:ServiceContext,userId:string,input:z.infer<typeof useDecisionSchema>,op:OperationMeta) {
 const parsed=useDecisionSchema.parse(input)
 return runOperation(ctx,userId,'calendar.use',parsed,op,async tx=>{
  await lock(tx,`calendar-use:${userId}`)
  const v=await readCalendarConnection(tx,userId)
  if(v.revision!==parsed.expectedRevision)throw new DomainError('revision_conflict','연결 상태가 변경됐어요')
  if(v.status!=='decision_required'&&v.status!=='manual')throw new DomainError('calendar_decision_required','연결을 해제하거나 캘린더 선택을 비운 뒤 결정해 주세요')
  await run(tx,"UPDATE users SET calendar_use_state='manual',calendar_use_revision=calendar_use_revision+1 WHERE id=?",[userId])
  return readCalendarConnection(tx,userId)
 })
}
export async function disconnectCalendar(ctx:ServiceContext,userId:string,input:SyncInput,op:OperationMeta) {
 const parsed=syncSchema.parse(input)
 return runOperation(ctx,userId,'calendar.disconnect',parsed,op,async tx=>{
  const c=(await connection(tx,userId,true,true))!
  if(c.selection_revision!==parsed.expectedSelectionRevision)throw new DomainError('calendar_snapshot_changed','캘린더 선택이 변경됐어요')
  await clearDerived(tx,c)
  await run(tx,'DELETE FROM calendar_sources WHERE connection_id=?',[c.id])
  await run(tx,"UPDATE calendar_connections SET status='disconnected',refresh_token_ciphertext=NULL,key_version=NULL,analysis_snapshot_id=NULL,schedule_snapshot_id=NULL,generation=generation+1,selection_revision=selection_revision+1,revision=revision+1 WHERE id=?",[c.id])
  await run(tx,"UPDATE users SET calendar_use_state='decision_required',calendar_use_revision=calendar_use_revision+1,schedule_revision=schedule_revision+1 WHERE id=?",[userId])
  return readCalendarConnection(tx,userId)
 })
}
const catalogItem=z.object({id:z.string().min(1),summary:z.string().optional(),timeZone:z.string().optional(),accessRole:z.enum(['owner','writer','writerWithoutPrivateAccess','reader','freeBusyReader'])})
async function collectPages(fetchPage:(token?:string)=>Promise<{items:unknown[];nextPageToken?:string}>,budget:{pages:number;items:number},check:()=>void) {
 const result:unknown[]=[];let token:string|undefined
 do {
  check();if(budget.pages>=100)throw new DomainError('calendar_limit_exceeded','캘린더 페이지가 너무 많아요. 선택 범위를 줄여 주세요')
  const page=await fetchPage(token);check();budget.pages++;budget.items+=page.items.length
  if(budget.items>50000)throw new DomainError('calendar_limit_exceeded','캘린더 일정이 너무 많아요. 선택 범위를 줄여 주세요')
  result.push(...page.items);token=page.nextPageToken
 }while(token)
 return result
}
function deadline(ctx:ServiceContext,start:number){if(ctx.clock.now()-start>=60000)throw new DomainError('operation_timeout','캘린더 가져오기 시간이 초과됐어요',true)}
export async function refreshCalendarCatalog(ctx:ServiceContext,userId:string,op:OperationMeta,port:CalendarProvider) {
 const claim=await beginOperation(ctx,userId,'calendar.catalog',{},op);if(claim.replay)return claim.result as CalendarConnectionView
 try {
  const c=(await connection(ctx.db,userId))!,raw=await collectPages(t=>port.listCalendars(c.id,{pageToken:t}),{pages:0,items:0},()=>deadline(ctx,claim.startedAt))
  const parsed=z.array(catalogItem).safeParse(raw)
  if(!parsed.success||new Set(parsed.data.map(s=>s.id)).size!==parsed.data.length)throw new DomainError('calendar_fetch_failed','캘린더 목록을 확인할 수 없어요',true)
  return await finishOperation(ctx,claim,async tx=>{
   await assertBasis(tx,userId,c)
   const old=await sources(tx,c.id),changed=old.some(s=>s.selected&&!parsed.data.some(n=>n.id===s.provider_calendar_id&&n.accessRole===s.access_role))
   if(changed){await clearDerived(tx,c);await run(tx,'UPDATE calendar_connections SET selection_revision=selection_revision+1,generation=generation+1 WHERE id=?',[c.id]);await run(tx,"UPDATE users SET calendar_use_state='needs_refresh',calendar_use_revision=calendar_use_revision+1 WHERE id=?",[userId])}
   for(const s of old)if(!parsed.data.some(n=>n.id===s.provider_calendar_id))await run(tx,'DELETE FROM calendar_sources WHERE id=?',[s.id])
   for(const s of parsed.data)await run(tx,`INSERT INTO calendar_sources(id,connection_id,provider_calendar_id,name,timezone,access_role) VALUES (?,?,?,?,?,?) ON CONFLICT(connection_id,provider_calendar_id) DO UPDATE SET name=excluded.name,timezone=excluded.timezone,access_role=excluded.access_role,revision=calendar_sources.revision+1`,[ctx.id(),c.id,s.id,s.summary??s.id,s.timeZone??'Asia/Seoul',s.accessRole])
   return readCalendarConnection(tx,userId)
  })
 }catch(e){await failOperation(ctx,claim,e);throw e}
}
const datePart=z.object({dateTime:z.string().optional(),date:z.string().optional(),timeZone:z.string().optional()})
const googleEvent=z.object({id:z.string().min(1),summary:z.string().optional(),description:z.string().optional(),location:z.string().optional(),status:z.enum(['confirmed','tentative','cancelled']).optional(),transparency:z.enum(['opaque','transparent']).optional(),start:datePart.optional(),end:datePart.optional(),recurringEventId:z.string().optional(),originalStartTime:datePart.optional(),iCalUID:z.string().optional(),eventType:z.string().optional(),hangoutLink:z.string().optional(),conferenceData:z.unknown().optional(),attendees:z.array(z.object({self:z.boolean().optional(),responseStatus:z.enum(['accepted','tentative','needsAction','declined']).optional()})).optional()})
export const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
function convert(raw:unknown,s:Source):CalendarSourceInput|null {
 const parsed=googleEvent.safeParse(raw);if(!parsed.success)throw new DomainError('calendar_fetch_failed','일정 형식을 확인할 수 없어요',true)
 const e=parsed.data;if(e.status==='cancelled')return null
 const allDay=e.start?.date&&e.end?.date?{startDate:e.start.date,endDate:e.end.date,timeZone:e.start.timeZone??s.timezone??'Asia/Seoul'}:undefined
 const instant=(value:string|undefined)=>value&&/(Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN
 let startMs:number,endMs:number
 try{startMs=allDay?zonedDateStart(allDay.startDate,allDay.timeZone):instant(e.start?.dateTime);endMs=allDay?zonedDateStart(allDay.endDate,allDay.timeZone):instant(e.end?.dateTime)}catch{throw new DomainError('calendar_fetch_failed','일정 시간대를 확인할 수 없어요',true)}
 if(!Number.isSafeInteger(startMs)||!Number.isSafeInteger(endMs)||startMs>=endMs)throw new DomainError('calendar_fetch_failed','일정 시간 범위를 확인할 수 없어요',true)
 const hasOnlineLink=!!(e.hangoutLink||e.conferenceData),responseStatus=e.attendees?.find(a=>a.self)?.responseStatus
 return {sourceKey:JSON.stringify([s.provider_calendar_id,e.id]),title:e.summary,startMs,endMs,allDay,iCalUID:e.iCalUID,recurringEventId:e.recurringEventId,originalStartTime:e.originalStartTime?.dateTime??e.originalStartTime?.date,status:e.status,transparency:e.transparency,responseStatus,eventType:(['workingLocation','focusTime','outOfOffice'].includes(e.eventType??'')?e.eventType:'default') as CalendarSourceInput['eventType'],hasOnlineLink,kind:hasOnlineLink&&!e.location?'online':'none',placeRef:e.location??null}
}
export async function syncCalendar(ctx:ServiceContext,userId:string,input:SyncInput,op:OperationMeta,port:CalendarProvider,scope:'full'|'future'='full'):Promise<SyncView> {
 const parsed=syncSchema.parse(input),claim=await beginOperation(ctx,userId,`calendar.sync.${scope}`,parsed,op)
 if(claim.replay)return claim.result as SyncView
 let c:Connection|undefined;let runId:string|undefined
 try {
  c=await checkConnection(ctx.db,userId,parsed.expectedSelectionRevision)
  const base=c,selected=(await sources(ctx.db,c.id)).filter(s=>s.selected)
  if(!selected.length)throw new DomainError('calendar_decision_required','가져올 캘린더를 선택해 주세요')
  const key=`calendar:${c.id}`,fromMs=kstDayStart(claim.startedAt)-(scope==='full'?56*DAY_MS:0)-180*60000,toMs=kstDayStart(claim.startedAt)+60*DAY_MS+180*60000
  runId=ctx.id()
  await ctx.db.transaction(async tx=>{
   await lock(tx,key)
   const lease=await one<{lease_until:number}>(tx,'SELECT lease_until FROM service_leases WHERE resource_key=?',[key])
   if(lease&&lease.lease_until>ctx.clock.now())throw new DomainError('calendar_busy','다른 캘린더 가져오기가 진행 중이에요',true)
   await run(tx,'INSERT INTO service_leases(resource_key,owner_operation_id,fence,lease_until) VALUES (?,?,?,?) ON CONFLICT(resource_key) DO UPDATE SET owner_operation_id=excluded.owner_operation_id,fence=excluded.fence,lease_until=excluded.lease_until,revision=service_leases.revision+1',[key,claim.id,claim.fence,claim.leaseUntil])
   await run(tx,"INSERT INTO calendar_sync_runs(id,connection_id,operation_id,selection_revision,base_generation,scope,from_at,to_at,started_at,lease_until,fence,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,'running')",[runId,base.id,claim.id,base.selection_revision,base.generation,scope==='full'?'full':'schedule',fromMs,toMs,claim.startedAt,claim.leaseUntil,claim.fence])
  })
  const budget={pages:0,items:0},events:{source:Source;raw:unknown;value:CalendarSourceInput}[]=[],busy:{calendarId:string;start:number;end:number}[]=[]
  for(const source of selected) {
   deadline(ctx,claim.startedAt)
   if(source.access_role==='freeBusyReader') {
    if(budget.pages>=100)throw new DomainError('calendar_limit_exceeded','캘린더 페이지가 너무 많아요')
    budget.pages++
    const raw=await port.freeBusy(base.id,[source.provider_calendar_id],{fromMs,toMs});deadline(ctx,claim.startedAt)
    const parsedBusy=z.object({calendars:z.record(z.string(),z.object({busy:z.array(z.object({start:z.string(),end:z.string()})),errors:z.array(z.unknown()).optional()}))}).safeParse(raw)
    const calendar=parsedBusy.success?parsedBusy.data.calendars[source.provider_calendar_id]:undefined
    if(!calendar||calendar.errors?.length)throw new DomainError('calendar_fetch_failed','선택한 캘린더의 바쁜 시간을 모두 가져오지 못했어요',true)
    budget.items+=calendar.busy.length;if(budget.items>50000)throw new DomainError('calendar_limit_exceeded','일정이 너무 많아요')
    for(const interval of calendar.busy){const start=Date.parse(interval.start),end=Date.parse(interval.end);if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)throw new DomainError('calendar_fetch_failed','바쁜 시간을 확인할 수 없어요',true);busy.push({calendarId:source.provider_calendar_id,start,end})}
   } else {
    const raw=await collectPages(t=>port.listEvents(base.id,source.provider_calendar_id,{fromMs,toMs,pageToken:t}),budget,()=>deadline(ctx,claim.startedAt))
    for(const item of raw){const value=convert(item,source);if(value)events.push({source,raw:item,value})}
   }
  }
  normalizeCalendarEvents(events.map(e=>e.value))
  return await finishOperation(ctx,claim,async tx=>{
   deadline(ctx,claim.startedAt);await assertBasis(tx,userId,base)
   const lease=await one<{owner_operation_id:string;fence:number}>(tx,'SELECT owner_operation_id,fence FROM service_leases WHERE resource_key=?',[key])
   if(lease?.owner_operation_id!==claim.id||lease.fence!==claim.fence)throw new DomainError('operation_lease_lost','이전 가져오기는 저장할 수 없어요',true)
   const snapshotId=ctx.id(),generation=base.generation+1,completedAt=ctx.clock.now()
   await run(tx,'INSERT INTO calendar_snapshots(id,connection_id,sync_run_id,generation,scope,from_at,to_at,selection_revision,started_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[snapshotId,base.id,runId,generation,scope==='full'?'full':'schedule',fromMs,toMs,base.selection_revision,claim.startedAt,completedAt])
   const rows=events.map(({source,raw,value:v})=>{const e=googleEvent.parse(raw);const isBusy=v.transparency!=='transparent'&&v.responseStatus!=='declined'&&v.eventType!=='workingLocation';return [ctx.id(),snapshotId,source.provider_calendar_id,e.id,e.recurringEventId??null,String(v.originalStartTime??'')||null,e.iCalUID??null,e.summary??null,e.description??null,e.location??null,e.status??'confirmed',e.transparency??'opaque',v.startMs!,v.endMs!,v.allDay?1:0,v.allDay?.startDate??null,v.allDay?.endDate??null,v.allDay?.timeZone??source.timezone,isBusy?1:0,v.kind??'none',v.placeRef??null,fingerprint(v),JSON.stringify({source:v,location:fingerprint([e.location,e.hangoutLink,e.conferenceData]),classification:fingerprint([e.summary,e.description,v.startMs,v.endMs])})]})
   await insertMany(tx,'imported_events',['id','snapshot_id','calendar_id','provider_event_id','recurring_event_id','original_start_time','ical_uid','title','description','location','status','transparency','start_at','end_at','all_day','start_date','end_date','timezone','busy','location_kind','place_ref','content_fingerprint','field_fingerprints_json'],rows)
   await insertMany(tx,'imported_busy_intervals',['id','snapshot_id','calendar_id','start_at','end_at'],busy.map(b=>[ctx.id(),snapshotId,b.calendarId,b.start,b.end]))
   await run(tx,`UPDATE calendar_connections SET generation=?,schedule_snapshot_id=?,${scope==='full'?'analysis_snapshot_id=?,':''}revision=revision+1 WHERE id=?`,scope==='full'?[generation,snapshotId,snapshotId,base.id]:[generation,snapshotId,base.id])
   await run(tx,"UPDATE calendar_sync_runs SET status='succeeded',revision=revision+1 WHERE id=?",[runId])
   // Older snapshots nothing points at any more would otherwise pile up with every import. Keep any an analysis was built on.
   await run(tx,'DELETE FROM calendar_snapshots s WHERE s.connection_id=? AND s.id NOT IN (SELECT x FROM (SELECT schedule_snapshot_id x FROM calendar_connections WHERE id=? UNION SELECT analysis_snapshot_id FROM calendar_connections WHERE id=?) p WHERE x IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM analysis_runs a WHERE a.snapshot_id=s.id)',[base.id,base.id,base.id])
   await run(tx,"UPDATE users SET calendar_use_state='connected',calendar_use_revision=calendar_use_revision+1,schedule_revision=schedule_revision+1 WHERE id=?",[userId])
   return (await view(tx,snapshotId))!
  })
 }catch(error){
  const safe=error instanceof DomainError?error:new DomainError('calendar_fetch_failed','캘린더를 모두 가져오지 못했어요',true)
  if(runId)await run(ctx.db,"UPDATE calendar_sync_runs SET status='failed',error_json=? WHERE id=? AND status='running'",[JSON.stringify({code:safe.code}),runId])
  if(c&&safe.code==='calendar_reconnect_required')await run(ctx.db,"UPDATE calendar_connections SET status='reconnect_required',revision=revision+1 WHERE id=? AND generation=? AND status='connected'",[c.id,c.generation])
  await failOperation(ctx,claim,safe);throw safe
 }finally{if(c)await run(ctx.db,'DELETE FROM service_leases WHERE resource_key=? AND owner_operation_id=? AND fence=?',[`calendar:${c.id}`,claim.id,claim.fence])}
}
export async function readScheduleSources(db:Db,userId:string,scope:'schedule'|'analysis'='schedule'):Promise<CalendarSourceInput[]> {
 const c=await connection(db,userId,false);if(!c||c.status==='disconnected')return []
 const snapshot=scope==='schedule'?c.schedule_snapshot_id:c.analysis_snapshot_id;if(!snapshot)return []
 // The user's supplements come back in the same query: this runs for both people on every candidate computation.
 const rows=await all<{field_fingerprints_json:string;a_fields:string|null;a_values:string|null;a_revision:number|null}>(db,'SELECT e.field_fingerprints_json,a.field_fingerprints_json a_fields,a.values_json a_values,a.revision a_revision FROM imported_events e JOIN calendar_sources s ON s.connection_id=? AND s.provider_calendar_id=e.calendar_id AND s.selected=1 LEFT JOIN event_annotations a ON a.connection_id=s.connection_id AND a.calendar_id=e.calendar_id AND a.provider_event_id=e.provider_event_id WHERE e.snapshot_id=?',[c.id,snapshot])
 const result:CalendarSourceInput[]=rows.map(row=>projectAnnotation(row.field_fingerprints_json,row.a_fields===null?undefined:{field_fingerprints_json:row.a_fields,values_json:row.a_values!,revision:row.a_revision!}))
 const busy=await all<{id:string;start_at:number;end_at:number}>(db,'SELECT b.* FROM imported_busy_intervals b JOIN calendar_sources s ON s.connection_id=? AND s.provider_calendar_id=b.calendar_id AND s.selected=1 WHERE b.snapshot_id=?',[c.id,snapshot])
 return result.concat(busy.map(b=>({sourceKey:b.id,startMs:b.start_at,endMs:b.end_at,eventType:'freeBusy' as const})))
}

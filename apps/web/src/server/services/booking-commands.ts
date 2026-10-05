import {createHmac,timingSafeEqual} from 'node:crypto'
import {DomainError,type OperationMeta} from '@/contracts/common'
import {createRequestSchema,acceptRequestSchema,requestDecisionSchema,type CreateRequestInput,type AcceptRequestInput,type RequestView,type AcceptResult} from '@/contracts/booking'
import {applyFilter} from '@/core/filter'
import {resolvePreferences} from '@/core/preferences'
import type {ServiceContext} from '../runtime'
import {lock,one,run,all,type Db} from '../db/client'
import {beginOperation,finishOperation,failOperation,runOperation} from './operations'
import {preflightCalendars,checkReceipts} from './preflight'
import {readSearch} from './search'
import {computeBookable} from './schedule'
interface Row {id:string;client_id:string;host_id:string;revision:number;start_at:string;end_at:string;place_id:string;meeting_type_id:string;message:string;status:RequestView['status'];duration_min_snapshot:number|null;meeting_type_name_snapshot:string|null;place_snapshot_json:string|null;definition_state:string}
async function owned(db:Db,userId:string,id:string,role:'client'|'host'|'either'='either',forUpdate=false) {
 const r=await one<Row>(db,`SELECT * FROM requests WHERE id=?${forUpdate?' FOR UPDATE':''}`,[id])
 if(!r||role==='client'&&r.client_id!==userId||role==='host'&&r.host_id!==userId||role==='either'&&r.client_id!==userId&&r.host_id!==userId)throw new DomainError('not_found','요청을 찾을 수 없어요')
 return r
}
function view(ctx:ServiceContext,r:Row):RequestView{return {id:r.id,revision:r.revision,clientId:r.client_id,hostId:r.host_id,startAt:Date.parse(r.start_at),endAt:Date.parse(r.end_at),placeId:r.place_id,meetingTypeId:r.meeting_type_id,message:r.message,status:r.status,expired:r.status==='pending'&&Date.parse(r.start_at)<ctx.clock.now(),conflict:false}}
function pending(ctx:ServiceContext,r:Row,expected:number) {
 if(r.revision!==expected)throw new DomainError('revision_conflict','요청 상태가 바뀌었어요',false,undefined,r.revision)
 if(r.status!=='pending')throw new DomainError('request_not_pending','이미 처리된 요청이에요')
 if(Date.parse(r.start_at)<ctx.clock.now())throw new DomainError('request_expired','시작 시각이 지났어요')
}
async function definitions(db:Db,hostId:string,placeId:string,typeId:string) {
 const place=await one<{id:string;kind:string;name:string}>(db,'SELECT id,kind,name FROM places WHERE id=? AND host_id=? AND active=1',[placeId,hostId])
 const type=await one<{name:string;duration_min:number}>(db,'SELECT name,duration_min FROM meeting_types WHERE id=? AND host_id=? AND active=1',[typeId,hostId])
 if(!place||!type)throw new DomainError('meeting_definition_changed','장소 또는 미팅 양식이 변경됐어요. 새로 요청해 주세요')
 return {place,type}
}
// Bookings change two people's calendars at once. Every command that does so takes the per-user locks below (sorted, so they cannot deadlock),
// which is what the single SQLite writer used to guarantee.
const userLock=(id:string)=>`user:${id}`
export async function requestMeeting(ctx:ServiceContext,userId:string,input:CreateRequestInput,op:OperationMeta):Promise<RequestView> {
 const parsed=createRequestSchema.parse(input),claim=await beginOperation(ctx,userId,'request.create',parsed,op)
 if(claim.replay)return claim.result as RequestView
 try {
  const search=await readSearch(ctx.db,userId,parsed.searchId)
  if(search.revision!==parsed.expectedSearchRevision)throw new DomainError('revision_conflict','탐색 조건이 변경됐어요',false,undefined,search.revision)
  if(!search.candidates.some(s=>s.startAt===parsed.slot.startAt&&s.endAt===parsed.slot.endAt&&s.placeId===parsed.slot.placeId&&s.meetingTypeId===parsed.slot.meetingTypeId))throw new DomainError('slot_unavailable','현재 탐색에서 제안한 시간을 골라 주세요')
  if(search.candidateState!=='ready')throw new DomainError('slot_unavailable','후보가 오래됐어요. 가능한 시간을 다시 확인해 주세요')
  const receipts=await preflightCalendars(ctx,[userId,search.hostId],`${claim.id}.${claim.attempt}`)
  return await finishOperation(ctx,claim,async tx=>{
   await lock(tx,userLock(userId),userLock(search.hostId))
   await checkReceipts(tx,receipts)
   const current=await readSearch(tx,userId,search.searchId)
   if(current.revision!==search.revision)throw new DomainError('revision_conflict','탐색이 변경됐어요')
   const {slots,places}=await computeBookable(tx,userId,search.hostId,ctx.clock.now())
   const effective=resolvePreferences(current.inheritedPreferences,current.overrides)
   if(!applyFilter(slots,effective,places).some(s=>s.startMs===parsed.slot.startAt&&s.endMs===parsed.slot.endAt&&s.placeId===parsed.slot.placeId&&s.meetingTypeId===parsed.slot.meetingTypeId))throw new DomainError('slot_unavailable','그 사이 일정이 바뀌었어요. 가능한 시간을 다시 찾아 주세요')
   const start=new Date(parsed.slot.startAt).toISOString(),end=new Date(parsed.slot.endAt).toISOString()
   const overlap=await one(tx,"SELECT id FROM requests WHERE client_id=? AND status='pending' AND start_at::timestamptz>=?::timestamptz AND start_at::timestamptz<?::timestamptz AND end_at::timestamptz>?::timestamptz",[userId,new Date(ctx.clock.now()).toISOString(),end,start])
   if(overlap)throw new DomainError('overlapping_request','이미 요청한 다른 미팅과 시간이 겹쳐요')
   const {place,type}=await definitions(tx,search.hostId,parsed.slot.placeId,parsed.slot.meetingTypeId),id=ctx.id()
   await run(tx,"INSERT INTO requests(id,client_id,host_id,start_at,end_at,place_id,meeting_type_id,message,status,created_at,search_id,duration_min_snapshot,meeting_type_name_snapshot,place_snapshot_json,definition_state) VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,'confirmed')",[id,userId,search.hostId,start,end,place.id,parsed.slot.meetingTypeId,parsed.message,new Date(ctx.clock.now()).toISOString(),search.searchId,type.duration_min,type.name,JSON.stringify(place)])
   return view(ctx,await owned(tx,userId,id))
  })
 }catch(e){await failOperation(ctx,claim,e);throw e}
}
function impacts(db:Db,r:Row) {return all<{id:string;revision:number}>(db,"SELECT id,revision FROM requests WHERE host_id=? AND id<>? AND status='pending' AND start_at::timestamptz<?::timestamptz AND end_at::timestamptz>?::timestamptz ORDER BY id",[r.host_id,r.id,r.end_at,r.start_at])}
function signingKey(ctx:ServiceContext){if(ctx.config.impactSigningKey)return ctx.config.impactSigningKey;if(ctx.config.mode==='demo')return 'local-demo-impact-key';throw new DomainError('internal_error','예약 확인 서명 설정이 필요해요')}
function sign(ctx:ServiceContext,text:string){return createHmac('sha256',signingKey(ctx)).update(text).digest('base64url')}
export async function previewAccept(ctx:ServiceContext,userId:string,id:string) {
 const r=await owned(ctx.db,userId,id,'host');pending(ctx,r,r.revision)
 const affected=await impacts(ctx.db,r),payload=Buffer.from(JSON.stringify({requestId:id,revision:r.revision,hostId:userId,affected,expiresAt:ctx.clock.now()+300000})).toString('base64url')
 return {requestId:id,revision:r.revision,affectedIds:affected.map(r=>r.id),impactToken:`${payload}.${sign(ctx,payload)}`}
}
async function checkImpact(ctx:ServiceContext,db:Db,userId:string,r:Row,token:string) {
 const [payload,signature,extra]=token.split('.')
 const invalid=()=>new DomainError('accept_impact_changed','자동 거절되는 요청이 바뀌었거나 확인이 만료됐어요. 수락 내용을 다시 확인해 주세요')
 if(!payload||!signature||extra)throw invalid()
 const expected=Buffer.from(sign(ctx,payload)),actual=Buffer.from(signature)
 if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw invalid()
 let data:Record<string,unknown>;try{data=JSON.parse(Buffer.from(payload,'base64url').toString())}catch{throw invalid()}
 if(data.requestId!==r.id||data.hostId!==userId||data.revision!==r.revision||typeof data.expiresAt!=='number'||data.expiresAt<=ctx.clock.now()||JSON.stringify(data.affected)!==JSON.stringify(await impacts(db,r)))throw invalid()
}
export async function acceptMeeting(ctx:ServiceContext,userId:string,input:AcceptRequestInput,op:OperationMeta):Promise<AcceptResult> {
 const {requestId,...body}=input,parsed=acceptRequestSchema.parse(body),claim=await beginOperation(ctx,userId,'request.accept',{requestId,...parsed},op)
 if(claim.replay)return claim.result as AcceptResult
 try {
  const before=await owned(ctx.db,userId,requestId,'host');pending(ctx,before,parsed.expectedRevision);await checkImpact(ctx,ctx.db,userId,before,parsed.impactToken)
  const receipts=await preflightCalendars(ctx,[before.client_id,before.host_id],`${claim.id}.${claim.attempt}`)
  return await finishOperation(ctx,claim,async tx=>{
   await lock(tx,userLock(before.client_id),userLock(before.host_id))
   await checkReceipts(tx,receipts)
   const r=await owned(tx,userId,requestId,'host',true);pending(ctx,r,parsed.expectedRevision);await checkImpact(ctx,tx,userId,r,parsed.impactToken)
   const {place,type}=await definitions(tx,r.host_id,r.place_id,r.meeting_type_id)
   if(r.definition_state!=='confirmed'||r.duration_min_snapshot!==type.duration_min||r.meeting_type_name_snapshot!==type.name||r.place_snapshot_json!==JSON.stringify(place)||Date.parse(r.end_at)-Date.parse(r.start_at)!==type.duration_min*60000)throw new DomainError('meeting_definition_changed','요청 당시의 장소나 미팅 양식이 변경됐어요. 새로 요청해 주세요')
   const {slots}=await computeBookable(tx,r.client_id,r.host_id,ctx.clock.now(),0)
   if(!slots.some(s=>s.startMs===Date.parse(r.start_at)&&s.endMs===Date.parse(r.end_at)&&s.placeId===r.place_id&&s.meetingTypeId===r.meeting_type_id))throw new DomainError('slot_unavailable','그 사이 일정이 바뀌어 이 시간에 만날 수 없어요')
   const affected=await impacts(tx,r),decided=new Date(ctx.clock.now()).toISOString()
   await run(tx,"UPDATE requests SET status='accepted',revision=revision+1,decided_at=? WHERE id=?",[decided,r.id])
   for(const a of affected)await run(tx,"UPDATE requests SET status='declined',revision=revision+1,decided_at=? WHERE id=?",[decided,a.id])
   const eventIds:string[]=[]
   // Each calendar entry names the other person, so the calendar alone says who the meeting is with.
   const names=new Map((await all<{id:string;name:string}>(tx,'SELECT id,name FROM users WHERE id IN (?,?)',[r.client_id,r.host_id])).map(u=>[u.id,u.name]))
   for(const participant of [r.client_id,r.host_id]){const other=participant===r.client_id?r.host_id:r.client_id,id=ctx.id();eventIds.push(id);await run(tx,"INSERT INTO events(id,user_id,title,start_at,end_at,location_kind,place_ref,source,request_id) VALUES (?,?,?,?,?,?,?,'booking',?)",[id,participant,`미팅 · ${names.get(other)??'상대'} · ${type.name}`,r.start_at,r.end_at,place.kind==='online'?'online':'place',place.kind==='online'?null:place.id,r.id]);await run(tx,'UPDATE users SET schedule_revision=schedule_revision+1 WHERE id=?',[participant])}
   return {request:view(ctx,await owned(tx,userId,r.id)),declinedIds:affected.map(a=>a.id),eventIds}
  })
 }catch(e){await failOperation(ctx,claim,e);throw e}
}
export async function decideRequest(ctx:ServiceContext,userId:string,id:string,action:'decline'|'withdraw',input:{expectedRevision:number},op:OperationMeta) {
 const parsed=requestDecisionSchema.parse(input)
 return runOperation(ctx,userId,`request.${action}`,{requestId:id,...parsed},op,async tx=>{
  const first=await owned(tx,userId,id,action==='decline'?'host':'client')
  await lock(tx,userLock(first.client_id),userLock(first.host_id))
  const r=await owned(tx,userId,id,action==='decline'?'host':'client',true);pending(ctx,r,parsed.expectedRevision)
  await run(tx,'UPDATE requests SET status=?,revision=revision+1,decided_at=? WHERE id=?',[action==='decline'?'declined':'withdrawn',new Date(ctx.clock.now()).toISOString(),id])
  return view(ctx,await owned(tx,userId,id))
 })
}

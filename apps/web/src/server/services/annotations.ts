import {DomainError,type OperationMeta} from '@/contracts/common'
import {annotationSchema,type SaveAnnotationInput,type ImportedEventDetail} from '@/contracts/calendar'
import type {ServiceContext} from '../runtime'
import {all,lock,one,run,type Db} from '../db/client'
import {runOperation} from './operations'
import {projectAnnotation,type AnnotationProjection} from '@/core/annotations'
import {CLASSIFICATION_SCHEMA_VERSION} from '@/llm/classify'
interface EventRow{id:string;connection_id:string;calendar_id:string;provider_event_id:string;title:string|null;start_at:number;end_at:number;content_fingerprint:string;field_fingerprints_json:string;all_day:number;start_date:string|null;end_date:string|null;timezone:string|null;status:string|null;busy:number;location:string|null}
async function event(db:Db,userId:string,id:string){const row=await one<EventRow>(db,`SELECT e.*,c.id connection_id FROM imported_events e JOIN calendar_connections c ON (e.snapshot_id=c.analysis_snapshot_id OR e.snapshot_id=c.schedule_snapshot_id) JOIN calendar_sources s ON s.connection_id=c.id AND s.provider_calendar_id=e.calendar_id WHERE c.user_id=? AND e.id=? AND s.selected=1 AND c.status<>'disconnected'`,[userId,id]);if(!row)throw new DomainError('not_found','가져온 일정을 찾을 수 없어요');return row}
function annotation(db:Db,e:EventRow){return one<AnnotationProjection>(db,'SELECT * FROM event_annotations WHERE connection_id=? AND calendar_id=? AND provider_event_id=?',[e.connection_id,e.calendar_id,e.provider_event_id])}
/** The newest AI proposal for exactly this content under the current labelling rules, whichever model produced it. Never an authority: the user's own value wins. */
async function aiClassification(db:Db,e:EventRow):Promise<'business'|'personal'|'unknown'|null>{
 const row=await one<{p:string}>(db,'SELECT proposal_json p FROM event_classifications WHERE connection_id=? AND calendar_id=? AND provider_event_id=? AND content_fingerprint=? AND schema_version=? ORDER BY seq DESC LIMIT 1',[e.connection_id,e.calendar_id,e.provider_event_id,e.content_fingerprint,CLASSIFICATION_SCHEMA_VERSION])
 if(!row)return null
 try{const value=JSON.parse(row.p).classification;return value==='business'||value==='personal'||value==='unknown'?value:null}catch{return null}
}
async function toView(db:Db,e:EventRow){const a=await annotation(db,e),source=projectAnnotation(e.field_fingerprints_json,a),patch=a?JSON.parse(a.values_json):{},fields=JSON.parse(e.field_fingerprints_json),old=a?JSON.parse(a.field_fingerprints_json):fields;return {eventId:e.id,title:e.title??'제목 없음',startAt:e.start_at,endAt:e.end_at,allDay:!!e.all_day,startDate:e.start_date,endDate:e.end_date,timezone:e.timezone,revision:a?.revision??0,sourceFingerprint:e.content_fingerprint,patch,needsConfirmation:!!a&&((patch.locationKind&&old.location!==fields.location)||(patch.classification&&old.classification!==fields.classification)),locationKind:source.confirmedLocation?.kind??source.kind??'none',classification:source.userClassification??'unknown',aiClassification:await aiClassification(db,e)}}
/** One owned event for the detail panel: what the source provided (read-only) beside the user's supplement. */
export async function getImportedEventDetail(ctx:ServiceContext,userId:string,eventId:string):Promise<ImportedEventDetail>{
 const e=await event(ctx.db,userId,eventId)
 const name=(await one<{name:string}>(ctx.db,'SELECT name FROM calendar_sources WHERE connection_id=? AND provider_calendar_id=?',[e.connection_id,e.calendar_id]))?.name??'알 수 없는 캘린더'
 let source:{placeRef?:string|null;kind?:string;hasOnlineLink?:boolean}={}
 try{source=JSON.parse(e.field_fingerprints_json).source??{}}catch{/* columns alone are enough */}
 const kind=source.kind==='office'||source.kind==='place'||source.kind==='online'||source.kind==='none'?source.kind:null
 return {...await toView(ctx.db,e),detail:{calendarName:name,status:e.status==='tentative'?'tentative':'confirmed',busy:!!e.busy,providedLocation:(source.placeRef??e.location)||null,providedKind:kind,onlineLink:!!source.hasOnlineLink}}
}
export async function listImportedEvents(ctx:ServiceContext,userId:string){
 const rows=await all<{id:string}>(ctx.db,`SELECT e.id FROM imported_events e JOIN calendar_connections c ON (e.snapshot_id=c.schedule_snapshot_id OR e.snapshot_id=c.analysis_snapshot_id) JOIN calendar_sources s ON s.connection_id=c.id AND s.provider_calendar_id=e.calendar_id WHERE c.user_id=? AND s.selected=1 AND c.status<>'disconnected' ORDER BY e.start_at DESC LIMIT 500`,[userId])
 const seen=new Set<string>(),views=[]
 for(const r of rows){const e=await event(ctx.db,userId,r.id),key=JSON.stringify([e.calendar_id,e.provider_event_id]);if(seen.has(key))continue;seen.add(key);views.push(await toView(ctx.db,e))}
 return views
}
export function saveAnnotation(ctx:ServiceContext,userId:string,input:SaveAnnotationInput,op:OperationMeta){const {eventId,...body}=input,parsed=annotationSchema.parse(body);return runOperation(ctx,userId,'calendar.annotation',{eventId,...parsed},op,async tx=>{
 await lock(tx,`annotation:${userId}`)
 const e=await event(tx,userId,eventId),old=await annotation(tx,e)
 if(e.content_fingerprint!==parsed.sourceFingerprint)throw new DomainError('source_changed','원본 일정이 변경됐어요. 최신 내용을 확인해 주세요')
 if((old?.revision??0)!==parsed.expectedRevision)throw new DomainError('revision_conflict','다른 화면에서 보정 내용이 바뀌었어요')
 const values={...(old?JSON.parse(old.values_json):{}),...parsed.patch},previous=old?JSON.parse(old.field_fingerprints_json):{},current=JSON.parse(e.field_fingerprints_json),fields={...previous}
 if(parsed.patch.locationKind!==undefined||parsed.patch.placeRef!==undefined)fields.location=current.location
 if(parsed.patch.classification!==undefined||parsed.patch.businessMeeting!==undefined)fields.classification=current.classification
 await run(tx,`INSERT INTO event_annotations(id,connection_id,calendar_id,provider_event_id,revision,field_fingerprints_json,values_json,confirmations_json) VALUES (?,?,?,?,1,?,?,'{}') ON CONFLICT(connection_id,calendar_id,provider_event_id) DO UPDATE SET revision=event_annotations.revision+1,field_fingerprints_json=excluded.field_fingerprints_json,values_json=excluded.values_json`,[ctx.id(),e.connection_id,e.calendar_id,e.provider_event_id,JSON.stringify(fields),JSON.stringify(values)])
 await run(tx,'UPDATE users SET annotation_revision=annotation_revision+1,schedule_revision=schedule_revision+1 WHERE id=?',[userId])
 return toView(tx,e)
})}

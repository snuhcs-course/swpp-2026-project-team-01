import { DomainError,type OperationMeta } from '@/contracts/common'
import { analyzeDraftSchema,type AnalyzeDraftInput,type ProfileDraftView } from '@/contracts/profile'
import { normalizeCalendarEvents } from '@/core/calendar'
import { analyzeHistory,type AnalysisEvent } from '@/core/analysis'
import { DAY_MS,kstDayStart,weekdayKo } from '@/core/time'
import { classifyEvents,CLASSIFICATION_SCHEMA_VERSION } from '@/llm/classify'
import type { ServiceContext } from '../runtime'
import { all, lock, one, run } from '../db/client'
import { logEvent,roundMs } from '../log'
import { readCalendarConnection,readScheduleSources } from './calendar-sync'
import { getDraft } from './profile'
import { beginOperation,finishOperation,failOperation } from './operations'
export async function analyzeDraft(ctx:ServiceContext,userId:string,input:AnalyzeDraftInput,op:OperationMeta):Promise<ProfileDraftView> {
 const {draftId,...body}=input,parsed=analyzeDraftSchema.parse(body),claim=await beginOperation(ctx,userId,'profile.draft.analyze',{draftId,...parsed},op)
 if(claim.replay)return claim.result as ProfileDraftView
 try {
  const draft=await getDraft(ctx.db,userId,draftId),calendar=await readCalendarConnection(ctx.db,userId),snapshot=calendar.analysis
  if(draft.status!=='active'||draft.revision!==parsed.expectedRevision)throw new DomainError('revision_conflict','초안이 변경됐어요')
  if(!snapshot||calendar.status!=='connected')throw new DomainError('calendar_snapshot_changed','선택한 캘린더를 먼저 가져와 주세요')
  const annotationNow=async(db:typeof ctx.db)=>(await one<{n:number}>(db,'SELECT annotation_revision n FROM users WHERE id=?',[userId]))!.n,annotation=await annotationNow(ctx.db)
  const fromMs=kstDayStart(snapshot.startedAt)-56*DAY_MS,toMs=kstDayStart(snapshot.startedAt)
  const events:AnalysisEvent[]=normalizeCalendarEvents(await readScheduleSources(ctx.db,userId,'analysis')).analysisEvents.filter(e=>e.startMs>=fromMs&&e.startMs<toMs)
  const cacheRows=await all<{connection_id:string;calendar_id:string;provider_event_id:string;content_fingerprint:string;field_fingerprints_json:string}>(ctx.db,'SELECT c.id connection_id,e.calendar_id,e.provider_event_id,e.content_fingerprint,e.field_fingerprints_json FROM imported_events e JOIN calendar_connections c ON c.analysis_snapshot_id=e.snapshot_id WHERE c.user_id=?',[userId])
  const model=(ctx.llm as {model?:string}|undefined)?.model??'unconfigured'
  const fresh:AnalysisEvent[]=[]
  for(const event of events){
   if(event.userClassification!==undefined)continue
   const source=cacheRows.find(row=>event.sourceKeys.includes(JSON.parse(row.field_fingerprints_json).source.sourceKey))
   const cached=source?await one<{proposal_json:string}>(ctx.db,'SELECT proposal_json FROM event_classifications WHERE user_id=? AND connection_id=? AND calendar_id=? AND provider_event_id=? AND content_fingerprint=? AND model_version=? AND schema_version=?',[userId,source.connection_id,source.calendar_id,source.provider_event_id,source.content_fingerprint,model,CLASSIFICATION_SCHEMA_VERSION]):undefined
   if(cached)event.classification=JSON.parse(cached.proposal_json).classification
   else fresh.push(event)
  }
  for(let offset=0;ctx.llm&&offset<Math.min(fresh.length,120)&&ctx.clock.now()-claim.startedAt<65000;offset+=40){
   const batch=fresh.slice(offset,offset+40),started=Date.now(),result=await classifyEvents(ctx.llm,batch.map(e=>({eventId:e.id,title:e.title,startMs:e.startMs,endMs:e.endMs})))
   logEvent('analysis.classify',{batch:batch.length,classified:result.classifications.length,failed:result.failed,ms:roundMs(Date.now()-started),...result.stats})
   for(const item of result.classifications){const event=batch.find(e=>e.id===item.eventId);if(event)event.classification=item.classification}
  }
  const summary=analyzeHistory(events,{fromMs,toMs})
  return await finishOperation(ctx,claim,async tx=>{
   await lock(tx,`profile:${userId}`)
   if(ctx.clock.now()-claim.startedAt>=90000)throw new DomainError('operation_timeout','분석 시간이 초과됐어요',true)
   const latest=await readCalendarConnection(tx,userId),current=await getDraft(tx,userId,draftId)
   if(latest.analysis?.snapshotId!==snapshot.snapshotId||latest.status!=='connected'||(await annotationNow(tx))!==annotation)throw new DomainError('source_changed','분석 근거가 변경됐어요')
   if(current.revision!==draft.revision||current.status!=='active')throw new DomainError('revision_conflict','초안이 변경됐어요')
   for(const event of fresh.filter(e=>e.classification!==undefined))for(const source of cacheRows.filter(row=>event.sourceKeys.includes(JSON.parse(row.field_fingerprints_json).source.sourceKey))){
    await run(tx,'INSERT INTO event_classifications(id,user_id,connection_id,calendar_id,provider_event_id,content_fingerprint,model_version,schema_version,proposal_json) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',[ctx.id(),userId,source.connection_id,source.calendar_id,source.provider_event_id,source.content_fingerprint,model,CLASSIFICATION_SCHEMA_VERSION,JSON.stringify({classification:event.classification})])
   }
   const id=ctx.id(),evidence=ctx.id()
   await run(tx,'INSERT INTO analysis_runs(id,user_id,snapshot_id,annotation_revision,from_at,to_at,status,coverage_json,summary_json) VALUES (?,?,?,?,?,?,?,?,?)',[id,userId,snapshot.snapshotId,annotation,fromMs,toMs,summary.coverage.partial?'partial':'complete',JSON.stringify(summary.coverage),JSON.stringify(summary)])
   await run(tx,'INSERT INTO analysis_evidence(id,analysis_id,aggregation_rule_json,observation_count,from_at,to_at) VALUES (?,?,?,?,?,?)',[evidence,id,JSON.stringify({rule:'business-starts-within-history',version:1}),summary.counts.business,fromMs,toMs])
   const weekdays=summary.businessByWeekday.map((count,day)=>({count,day})).filter(d=>d.count).sort((a,b)=>b.count-a.count).slice(0,3)
   const late=summary.lateBusinessEventIds.length?` 저녁 업무 일정도 ${summary.lateBusinessEventIds.length}건 있었지만, 앞으로 그 시간에 미팅을 허용한다는 뜻은 아니에요.`:''
   const text=`지난 8주 일정 ${summary.coverage.eligible}건 중 업무 ${summary.counts.business}건, 개인 ${summary.counts.personal}건, 확인 필요 ${summary.counts.unknown}건을 관찰했어요.${summary.coverage.partial?` AI가 분류하지 못한 일정 ${summary.coverage.eligible-summary.coverage.classified}건은 확인 필요에 포함돼 있어요.`:''}${weekdays.length?` 업무 일정은 ${weekdays.map(d=>weekdayKo(d.day)+'요일 '+d.count+'건').join(', ')}에 있었어요. 이 요일을 선호하시나요?`: '일정만으로 근무시간과 선호를 알기 어려워요. 직접 알려 주세요.'}${late} 실제 근무시간과 미팅 허용 시간은 직접 확인해 주세요.`
   await run(tx,"INSERT INTO draft_messages(id,draft_id,operation_id,role,content,evidence_id,created_at) VALUES (?,?,?,'assistant',?,?,?)",[ctx.id(),draftId,claim.id,text,evidence,ctx.clock.now()])
   await run(tx,'UPDATE profile_drafts SET analysis_id=?,revision=revision+1,updated_at=? WHERE id=?',[id,ctx.clock.now(),draftId])
   return getDraft(tx,userId,draftId)
  })
 }catch(e){await failOperation(ctx,claim,e);throw e}
}

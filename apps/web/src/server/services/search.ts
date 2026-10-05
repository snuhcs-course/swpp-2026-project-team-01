import { z } from 'zod'
import { DomainError,type OperationMeta } from '@/contracts/common'
import { createSearchSchema,conditionsSchema,refreshSearchSchema,searchTurnSchema,type CreateSearchInput,type ChangeConditionsInput,type RefreshSearchInput,type SearchTurnInput } from '@/contracts/search'
import { resolvePreferences } from '@/core/preferences'
import { rankForParticipants } from '@/core/filter'
import { decideOptions } from '@/core/options'
import { summarize } from '@/core/summary'
import { filterChips,slotLabel } from '@/core/chips'
import { selectionBasis,basisSentence } from '@/core/explain'
import type { PreferenceOverrides,PreferenceDimension } from '@/core/types'
import type { ProfilePreferences } from '@/core/profile'
import { interpret } from '@/llm/interpret'
import { all, one, run, type Db } from '../db/client'
import type { ServiceContext } from '../runtime'
import { beginOperation,finishOperation,failOperation } from './operations'
import { getProfile,emptyProfile } from './profile'
import { canBook } from './contacts'
import { computeBookable } from './schedule'
import { preflightCalendars,checkReceipts,dataBasis } from './preflight'
interface SearchRow{id:string;client_id:string;host_id:string;revision:number;inherited_profile_version:number|null;inherited_preferences_json:string;overrides_json:string;initial_reply_state:string;last_result_json:string|null;data_basis_json:string|null}
async function row(db:Db,userId:string,id:string,forUpdate=false):Promise<SearchRow> {
 const result=await one<SearchRow>(db,`SELECT * FROM booking_searches WHERE id=? AND client_id=?${forUpdate?' FOR UPDATE':''}`,[id,userId])
 if(!result)throw new DomainError('not_found','예약 탐색을 찾을 수 없어요');return result
}
async function evaluate(db:Db,nowMs:number,s:SearchRow,initial=false) {
 const inherited=JSON.parse(s.inherited_preferences_json) as ProfilePreferences,overrides=JSON.parse(s.overrides_json) as PreferenceOverrides
 const effective=resolvePreferences(inherited,overrides),host=(await getProfile(db,s.host_id))?.values.preferences??emptyProfile().preferences
 const {slots,places,meetingTypes}=await computeBookable(db,s.client_id,s.host_id,nowMs),ranked=rankForParticipants(slots,effective,host,places)
 const chips=filterChips(effective,places,meetingTypes),decision=decideOptions(ranked,effective,true,initial),summary=summarize(ranked,effective,slots,places)
 const basis=selectionBasis({top:decision.top,ranked,filter:effective,chips,places,label:r=>slotLabel(r.slot,places,meetingTypes)})
 const {sources,...conditions}=effective
 return {effectiveConditions:conditions,sources,overrides,count:ranked.length,candidates:decision.top.map(r=>({startAt:r.slot.startMs,endAt:r.slot.endMs,placeId:r.slot.placeId,meetingTypeId:r.slot.meetingTypeId})),labels:decision.top.map(r=>slotLabel(r.slot,places,meetingTypes)),chips,basis,summary}
}
type Evaluation=Awaited<ReturnType<typeof evaluate>>
export async function readSearch(db:Db,userId:string,id:string) {
 const s=await row(db,userId,id),result=s.last_result_json?JSON.parse(s.last_result_json) as Evaluation:null
 const stale=s.data_basis_json!==JSON.stringify(await dataBasis(db,[userId,s.host_id]))
 const messages=await all<{id:string;role:'user'|'assistant';content:string}>(db,'SELECT id,role,content FROM search_messages WHERE search_id=? ORDER BY created_at,id',[id])
 return {searchId:s.id,hostId:s.host_id,revision:s.revision,inheritedProfileVersion:s.inherited_profile_version,inheritedPreferences:JSON.parse(s.inherited_preferences_json) as ProfilePreferences,effectiveConditions:result?.effectiveConditions??{},candidateState:(!result?'not_ready':stale?'stale':'ready') as 'not_ready'|'stale'|'ready',candidates:result?.candidates??[],count:result?.count??null,labels:result?.labels??[],chips:result?.chips??[],sources:result?.sources??{},overrides:JSON.parse(s.overrides_json) as PreferenceOverrides,messages,basis:result?.basis??null}
}
export type SearchView=Awaited<ReturnType<typeof readSearch>>
function message(db:Db,ctx:ServiceContext,id:string,operation:string,role:'user'|'assistant',content:string,offset=0) {return run(db,'INSERT INTO search_messages(id,search_id,operation_id,role,content,created_at) VALUES (?,?,?,?,?,?)',[ctx.id(),id,operation,role,content,new Date(ctx.clock.now()+offset).toISOString()])}
async function saveResult(tx:Db,ctx:ServiceContext,s:SearchRow,operation:string,initial=false,prefix='') {
 const result=await evaluate(tx,ctx.clock.now(),s,initial)
 const inherited=Object.values(result.sources??{}).some(v=>v==='inherit')&&Object.values(JSON.parse(s.inherited_preferences_json)).some(Boolean)
 const text=prefix+(initial&&inherited?'기본으로 선호하시는 조건을 적용해 찾아봤어요. ':'')+(result.count===0?'현재 허용 시간과 필수 조건에 맞는 후보가 없어요. 조건을 조정하거나 프로필을 확인해 주세요. ':result.summary.outcome==='preference_mismatch'?'가능한 시간은 있지만 선호와 모두 맞는 시간은 없어요. ':'')+basisSentence(result.basis,{added:[],replaced:[],removed:[]},result.candidates.length)+(result.basis.hostTieBreakUsed?' 사용자 선호 점수가 같은 후보에는 호스트 선호를 반영했어요.':'')
 await run(tx,"UPDATE booking_searches SET last_result_json=?,data_basis_json=?,initial_reply_state='ready',revision=revision+1 WHERE id=?",[JSON.stringify(result),JSON.stringify(await dataBasis(tx,[s.client_id,s.host_id])),s.id])
 await message(tx,ctx,s.id,operation,'assistant',text,1)
 return readSearch(tx,s.client_id,s.id)
}
export async function createSearch(ctx:ServiceContext,userId:string,input:CreateSearchInput,op:OperationMeta):Promise<SearchView> {
 const parsed=createSearchSchema.parse(input),claim=await beginOperation(ctx,userId,'search.create',parsed,op)
 if(claim.replay)return claim.result as SearchView
 try {
  if(parsed.hostId===userId)throw new DomainError('invalid_input','자기 자신에게 예약할 수 없어요')
  if(!(await canBook(ctx,userId,parsed.hostId)))throw new DomainError('not_found','호스트를 찾을 수 없어요. 상대의 예약 링크로 먼저 연락처에 추가해 주세요')
  if(!(await one(ctx.db,'SELECT id FROM users WHERE id=?',[parsed.hostId])))throw new DomainError('not_found','호스트를 찾을 수 없어요')
  // Reserve one resource before remote calls. Retrying this operation resumes the same search.
  const searchId=claim.resourceId??ctx.id()
  if(!claim.resourceId)await ctx.db.transaction(async tx=>{
   const profile=await getProfile(tx,userId),overrides=parsed.meetingTypeId?{meetingTypes:{state:'override',value:{ids:[parsed.meetingTypeId],strength:'must'}}}:{}
   if(parsed.meetingTypeId&&!(await one(tx,'SELECT id FROM meeting_types WHERE id=? AND host_id=? AND active=1',[parsed.meetingTypeId,parsed.hostId])))throw new DomainError('invalid_input','미팅 양식을 확인해 주세요')
   await run(tx,'INSERT INTO booking_searches(id,client_id,host_id,inherited_profile_version,inherited_preferences_json,overrides_json) VALUES (?,?,?,?,?,?)',[searchId,userId,parsed.hostId,profile?.version??null,JSON.stringify(profile?.values.preferences??emptyProfile().preferences),JSON.stringify(overrides)])
   await run(tx,"UPDATE mutation_operations SET reserved_resource_id=?,phase='reserved' WHERE id=? AND fence=?",[searchId,claim.id,claim.fence])
  })
  const receipts=await preflightCalendars(ctx,[userId,parsed.hostId],`${claim.id}.${claim.attempt}`)
  return await finishOperation(ctx,claim,async tx=>{await checkReceipts(tx,receipts);return saveResult(tx,ctx,await row(tx,userId,searchId,true),claim.id,true)})
 }catch(e){await failOperation(ctx,claim,e);throw e}
}
async function mutateSearch(ctx:ServiceContext,userId:string,searchId:string,expectedRevision:number,kind:string,input:unknown,op:OperationMeta,prepare:(s:SearchRow)=>Promise<{commands:z.infer<typeof conditionsSchema>['commands'];text?:string;failed?:boolean}>) {
 const claim=await beginOperation(ctx,userId,kind,{searchId,...input as object},op);if(claim.replay)return claim.result as SearchView
 try {
  const s=await row(ctx.db,userId,searchId);if(s.revision!==expectedRevision)throw new DomainError('revision_conflict','다른 화면에서 탐색 조건이 바뀌었어요',false,undefined,s.revision)
  const receipts=await preflightCalendars(ctx,[userId,s.host_id],`${claim.id}.${claim.attempt}`),change=await prepare(s)
  return await finishOperation(ctx,claim,async tx=>{
   if(ctx.clock.now()-claim.startedAt>=90000)throw new DomainError('operation_timeout','작업 시간이 초과됐어요',true)
   await checkReceipts(tx,receipts);const current=await row(tx,userId,searchId,true)
   if(current.revision!==s.revision)throw new DomainError('revision_conflict','다른 화면에서 탐색 조건이 바뀌었어요',false,undefined,current.revision)
   let inherited=JSON.parse(current.inherited_preferences_json),version=current.inherited_profile_version
   const overrides:PreferenceOverrides=JSON.parse(current.overrides_json)
   for(const command of change.commands){
    if(command.kind==='apply_latest_defaults'){const p=await getProfile(tx,userId);inherited=p?.values.preferences??emptyProfile().preferences;version=p?.version??null;continue}
    if(command.kind==='set')Object.assign(overrides,{[command.dimension]:{state:'override',value:command.value}})
    else Object.assign(overrides,{[command.dimension]:{state:command.kind==='disable'?'disabled':'inherit'}})
   }
   await run(tx,'UPDATE booking_searches SET inherited_profile_version=?,inherited_preferences_json=?,overrides_json=? WHERE id=?',[version,JSON.stringify(inherited),JSON.stringify(overrides),searchId])
   if(change.text)await message(tx,ctx,searchId,claim.id,'user',change.text)
   return saveResult(tx,ctx,await row(tx,userId,searchId,true),claim.id,false,change.failed?'말씀을 조건으로 해석하지 못해 기존 조건을 유지했어요. ':'')
  })
 }catch(e){await failOperation(ctx,claim,e);throw e}
}
export function changeConditions(ctx:ServiceContext,userId:string,input:ChangeConditionsInput,op:OperationMeta){const{searchId,...body}=input,parsed=conditionsSchema.parse(body);return mutateSearch(ctx,userId,searchId,parsed.expectedRevision,'search.conditions',parsed,op,async()=>({commands:parsed.commands}))}
export function refreshSearch(ctx:ServiceContext,userId:string,input:RefreshSearchInput,op:OperationMeta){const{searchId,...body}=input,parsed=refreshSearchSchema.parse(body);return mutateSearch(ctx,userId,searchId,parsed.expectedRevision,'search.refresh',parsed,op,async()=>({commands:[]}))}
export function searchTurn(ctx:ServiceContext,userId:string,input:SearchTurnInput,op:OperationMeta){const{searchId,...body}=input,parsed=searchTurnSchema.parse(body);return mutateSearch(ctx,userId,searchId,parsed.expectedRevision,'search.turn',parsed,op,async s=>{
 if(!ctx.llm)return {commands:[],text:parsed.text,failed:true}
 const conditions=resolvePreferences(JSON.parse(s.inherited_preferences_json),JSON.parse(s.overrides_json)),bookable=await computeBookable(ctx.db,userId,s.host_id,ctx.clock.now())
 const result=await interpret(ctx.llm,{nowMs:ctx.clock.now(),places:bookable.places,meetingTypes:bookable.meetingTypes,filter:conditions,history:[...(await readSearch(ctx.db,userId,searchId)).messages.map(m=>({role:m.role,content:m.content})),{role:'user',content:parsed.text}]})
 const commands:z.infer<typeof conditionsSchema>['commands']=[]
 for(const key of result.change.remove??[])commands.push({kind:'disable',dimension:key==='places'?'location':key})
 for(const [key,value] of Object.entries(result.change.set??{}))commands.push({kind:'set',dimension:key==='places'?'location':key as PreferenceDimension,value} as z.infer<typeof conditionsSchema>['commands'][number])
 return {commands,text:parsed.text,failed:result.failed}
})}

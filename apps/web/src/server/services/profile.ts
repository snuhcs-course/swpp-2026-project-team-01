import { normalizeWindows, validateProfile, type ProfileValues } from "@/core/profile"
import { DomainError, type OperationMeta } from "@/contracts/common"
import { createDraftSchema, patchDraftSchema, confirmProfileSchema, profileValuesSchema, topicsSchema, type CreateDraftInput, type PatchDraftInput, type ConfirmProfileInput, type ProfileDraftView, type ProfileView, type DraftTopics } from "@/contracts/profile"
import { all, lock, one, run, type Db } from "../db/client"
import type { ServiceContext } from "../runtime"
import { runOperation } from "./operations"

export const emptyProfile = (): ProfileValues => ({work:{mode:"none",windows:[]},meetingWindows:[],preferences:{weekdays:null,startTime:null,meetingMode:null,slack:null}})
interface DraftRow {id:string;user_id:string;status:"active"|"confirmed";revision:number;base_profile_version:number|null;values_json:string;topic_confirmations_json:string;updated_at:number}
// Readers take the executor (`ctx.db` or the open transaction) so a read inside a transaction sees that transaction's own writes.
export async function getProfile(db:Db,actorId:string):Promise<ProfileView|null> {
 const row=await one<{version:number;values_json:string;confirmed_at:number|null;origin:"legacy"|"user"}>(db,"SELECT p.* FROM users u JOIN profile_versions p ON p.user_id=u.id AND p.version=u.current_profile_version WHERE u.id=?",[actorId])
 return row?{version:row.version,values:profileValuesSchema.parse(JSON.parse(row.values_json)),confirmedAt:row.confirmed_at,origin:row.origin}:null
}
export async function getDraft(db:Db,actorId:string,draftId:string):Promise<ProfileDraftView> {
 const row=await one<DraftRow>(db,"SELECT * FROM profile_drafts WHERE id=? AND user_id=?",[draftId,actorId])
 if(!row) throw new DomainError("not_found","설정 초안을 찾을 수 없어요")
 const values=profileValuesSchema.parse(JSON.parse(row.values_json))
 const messages=await all<{id:string;role:"user"|"assistant";content:string;created_at:number}>(db,"SELECT id,role,content,created_at FROM draft_messages WHERE draft_id=? ORDER BY created_at,id",[draftId])
 return {draftId:row.id,revision:row.revision,baseProfileVersion:row.base_profile_version,values,topics:topicsSchema.parse(JSON.parse(row.topic_confirmations_json)),status:row.status,updatedAt:row.updated_at,fieldErrors:{...validateProfile(values).fieldErrors},messages:messages.map(m=>({id:m.id,role:m.role,content:m.content,createdAt:m.created_at}))}
}
export async function currentDraft(db:Db,actorId:string):Promise<ProfileDraftView|null> {
 const row=await one<{id:string}>(db,"SELECT id FROM profile_drafts WHERE user_id=? AND status='active'",[actorId])
 return row?getDraft(db,actorId,row.id):null
}
export async function createDraft(ctx:ServiceContext,actorId:string,input:CreateDraftInput,op:OperationMeta):Promise<ProfileDraftView> {
 const parsed=createDraftSchema.parse(input)
 return runOperation(ctx,actorId,"profile.draft.create",parsed,op,async tx=>{
  await lock(tx,`profile:${actorId}`)
  const active=await currentDraft(tx,actorId);if(active)return active
  const profile=await getProfile(tx,actorId),values=profile?.values??emptyProfile()
  if(!profile) {
   const rules=await all<{weekday:number;start_min:number;end_min:number}>(tx,"SELECT weekday,start_min,end_min FROM availability_rules WHERE user_id=? AND enabled",[actorId])
   values.meetingWindows=rules.map(r=>({weekday:r.weekday,startMin:r.start_min,endMin:r.end_min}))
  }
  const topics:DraftTopics=profile?.origin==="user"?{work:"confirmed",meetingWindows:"confirmed",preferences:"confirmed"}:{work:"unanswered",meetingWindows:"unanswered",preferences:"unanswered"}
  const id=ctx.id()
  await run(tx,"INSERT INTO profile_drafts(id,user_id,status,revision,base_profile_version,values_json,topic_confirmations_json,updated_at) VALUES (?,?,'active',0,?,?,?,?)",[id,actorId,profile?.version??null,JSON.stringify(values),JSON.stringify(topics),ctx.clock.now()])
  return getDraft(tx,actorId,id)
 })
}
export async function patchDraft(ctx:ServiceContext,actorId:string,input:PatchDraftInput,op:OperationMeta):Promise<ProfileDraftView> {
 const {draftId,...body}=input;const parsed=patchDraftSchema.parse(body)
 return runOperation(ctx,actorId,"profile.draft.patch",{draftId,...parsed},op,async tx=>{
  await lock(tx,`profile:${actorId}`)
  const draft=await getDraft(tx,actorId,draftId)
  if(draft.status!=="active"||draft.revision!==parsed.expectedRevision)throw new DomainError("revision_conflict","다른 화면에서 설정이 바뀌었어요. 최신 초안을 확인해 주세요",false,undefined,draft.revision)
  if(parsed.proposalId) throw new DomainError("source_changed","제안 근거를 다시 확인해 주세요")
  const values={...draft.values,...parsed.patch}
  values.work={...values.work,windows:normalizeWindows(values.work.windows)}
  values.meetingWindows=normalizeWindows(values.meetingWindows)
  const topics={...draft.topics,...parsed.topicConfirmations}
  await run(tx,"UPDATE profile_drafts SET values_json=?,topic_confirmations_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",[JSON.stringify(values),JSON.stringify(topics),ctx.clock.now(),draftId,parsed.expectedRevision])
  return getDraft(tx,actorId,draftId)
 })
}
export async function confirmProfile(ctx:ServiceContext,actorId:string,input:ConfirmProfileInput,op:OperationMeta):Promise<ProfileView> {
 const {draftId,...body}=input;const parsed=confirmProfileSchema.parse(body)
 return runOperation(ctx,actorId,"profile.draft.confirm",{draftId,...parsed},op,async tx=>{
  await lock(tx,`profile:${actorId}`)
  const active=await getProfile(tx,actorId)
  if((active?.version??null)!==parsed.baseProfileVersion)throw new DomainError("profile_version_conflict","이미 새 프로필이 저장됐어요. 최신 설정을 확인해 주세요")
  const draft=await getDraft(tx,actorId,draftId)
  if(draft.status!=="active"||draft.revision!==parsed.expectedRevision||draft.baseProfileVersion!==parsed.baseProfileVersion)throw new DomainError("revision_conflict","초안이 변경됐어요",false,undefined,draft.revision)
  if(Object.values(draft.topics).some(value=>value!=="confirmed"))throw new DomainError("invalid_input","근무시간·미팅 허용 시간·선호를 모두 확인해 주세요")
  const check=validateProfile(draft.values)
  if(!check.valid)throw new DomainError("preference_conflict","허용 시간과 선호가 맞는지 확인해 주세요",false,check.fieldErrors)
  const version=(active?.version??0)+1,now=ctx.clock.now()
  await run(tx,"INSERT INTO profile_versions(user_id,version,values_json,origin,confirmed_at) VALUES (?,?,?,'user',?)",[actorId,version,JSON.stringify(draft.values),now])
  await run(tx,"UPDATE users SET current_profile_version=?,setup_state='complete',schedule_revision=schedule_revision+1,revision=revision+1 WHERE id=?",[version,actorId])
  await run(tx,"UPDATE profile_drafts SET status='confirmed',revision=revision+1,updated_at=? WHERE id=?",[now,draftId])
  return (await getProfile(tx,actorId))!
 })
}
export async function profileReadiness(db:Db,userId:string):Promise<{ready:boolean;reason:string|null}> {
 const profile=await getProfile(db,userId)
 if(profile) return {ready:profile.values.meetingWindows.length>0,reason:profile.values.meetingWindows.length?null:"미팅 허용 시간이 없어요"}
 const rules=(await one<{n:number}>(db,"SELECT count(*) n FROM availability_rules WHERE user_id=? AND enabled",[userId]))!
 return {ready:rules.n>0,reason:rules.n?null:"미팅 프로필을 먼저 확인해 주세요"}
}

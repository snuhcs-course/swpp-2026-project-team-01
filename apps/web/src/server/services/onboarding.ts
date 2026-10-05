import { historyQuestion, answerFromHistory } from '@/core/briefing'
import { DomainError, type OperationMeta } from '@/contracts/common'
import { onboardingTurnSchema, type OnboardingTurnInput, type ProfileDraftView } from '@/contracts/profile'
import { interpretOnboarding, explainOnboarding } from '@/llm/onboarding'
import { lock, run , one } from '../db/client'
import type { ServiceContext } from '../runtime'
import { getDraft } from './profile'
import { beginOperation, finishOperation, failOperation } from './operations'
export async function onboardingTurn(ctx:ServiceContext, actorId:string, input:OnboardingTurnInput, op:OperationMeta):Promise<ProfileDraftView> {
 const {draftId,...body}=input, parsed=onboardingTurnSchema.parse(body)
 const claim=await beginOperation(ctx,actorId,'profile.draft.turn',{draftId,...parsed},op)
 if(claim.replay) return claim.result as ProfileDraftView
 try {
  const draft=await getDraft(ctx.db,actorId,draftId)
  if(draft.status!=='active'||draft.revision!==parsed.expectedRevision) throw new DomainError('revision_conflict','초안이 변경됐어요',false,undefined,draft.revision)
  const client=ctx.llm ?? {chat:async()=>{throw new Error('Unavailable')}}
  const interpreted=await interpretOnboarding(client,{text:parsed.text,values:draft.values})
  const topics={...draft.topics};for(const topic of interpreted.confirmedTopics)topics[topic]='confirmed'
  const asked=historyQuestion(parsed.text)
  const analysis=asked?await one<{summary_json:string}>(ctx.db,'SELECT r.summary_json FROM analysis_runs r JOIN profile_drafts d ON d.analysis_id=r.id WHERE d.id=?',[draftId]):undefined
  const answer=asked?answerFromHistory(analysis?JSON.parse(analysis.summary_json):null,asked):undefined
  const reply=await explainOnboarding(client,{values:interpreted.values,topics,changed:interpreted.changed,interpretFailed:interpreted.failed,answer})
  return await finishOperation(ctx,claim,async tx=>{
   await lock(tx,`profile:${actorId}`)
   if(ctx.clock.now()-claim.startedAt>=90000)throw new DomainError('operation_timeout','시간이 초과됐어요. 다시 시도해 주세요',true)
   const current=await getDraft(tx,actorId,draftId)
   if(current.status!=='active'||current.revision!==draft.revision)throw new DomainError('revision_conflict','초안이 변경됐어요',false,undefined,current.revision)
   await run(tx,'UPDATE profile_drafts SET values_json=?,topic_confirmations_json=?,revision=revision+1,updated_at=? WHERE id=?',[JSON.stringify(interpreted.values),JSON.stringify(topics),ctx.clock.now(),draftId])
   const insert='INSERT INTO draft_messages(id,draft_id,operation_id,role,content,created_at) VALUES (?,?,?,?,?,?)'
   await run(tx,insert,[ctx.id(),draftId,claim.id,'user',parsed.text,ctx.clock.now()]);await run(tx,insert,[ctx.id(),draftId,claim.id,'assistant',reply.text,ctx.clock.now()+1])
   return getDraft(tx,actorId,draftId)
  })
 } catch(error){await failOperation(ctx,claim,error);throw error}
}

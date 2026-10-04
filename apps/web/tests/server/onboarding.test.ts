import { emptyDb } from './helpers'
import {describe,it,expect} from 'vitest'
import {createDb} from '@/server/db/client'
import {makeContext} from '@/server/runtime'
import {createDraft,getDraft} from '@/server/services/profile'
import {onboardingTurn} from '@/server/services/onboarding'
describe('onboarding turn commit',()=>{
 it('keeps manual settings on AI failure and replays one pair of messages',async()=>{
  const {db,sqlite}=await emptyDb();try{
   ;(await sqlite.exec("INSERT INTO users(id,name) VALUES ('u','U')"))
   const ctx=makeContext(db),draft=await createDraft(ctx,'u',{purpose:'onboarding'},{key:'create'})
   const input={draftId:draft.draftId,expectedRevision:0,text:'화요일에 만나고 싶어요'}
   const first=await onboardingTurn(ctx,'u',input,{key:'turn'})
   expect(first.values).toEqual(draft.values);expect(first.messages).toHaveLength(2)
   expect(await onboardingTurn(ctx,'u',input,{key:'turn'})).toEqual(first)
  }finally{sqlite.close()}
 })
 it('does not apply a delayed AI answer over a newer draft revision',async()=>{
  const {db,sqlite}=await emptyDb();try{
   ;(await sqlite.exec("INSERT INTO users(id,name) VALUES ('u','U')"))
   const ctx=makeContext(db),draft=await createDraft(ctx,'u',{purpose:'onboarding'},{key:'create'})
   ctx.llm={chat:async()=>{(await sqlite.prepare('UPDATE profile_drafts SET revision=revision+1 WHERE id=?').run(draft.draftId));return JSON.stringify({patch:{},confirmedTopics:[]})}}
   await expect(onboardingTurn(ctx,'u',{draftId:draft.draftId,expectedRevision:0,text:'설정해줘'},{key:'turn'})).rejects.toMatchObject({code:'revision_conflict'})
   expect((await getDraft(ctx.db,'u',draft.draftId)).messages).toHaveLength(0)
  }finally{sqlite.close()}
 })
})

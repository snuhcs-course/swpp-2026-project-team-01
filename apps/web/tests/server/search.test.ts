import { emptyDb } from './helpers'
import {describe,it,expect} from 'vitest'
import {createDb} from '@/server/db/client'
import {makeContext} from '@/server/runtime'
import {createSearch,changeConditions,readSearch} from '@/server/services/search'
import {createDraft,patchDraft,confirmProfile} from '@/server/services/profile'
export async function searchFixture(){
 const store=await emptyDb();(await store.sqlite.exec("INSERT INTO users(id,name) VALUES ('client','Client'),('host','Host');INSERT INTO places(id,host_id,kind,name) VALUES ('online','host','online','Online');INSERT INTO meeting_types(id,host_id,name,duration_min) VALUES ('short','host','Short',30)"))
 const ctx=makeContext(store.db,{now:()=>Date.parse('2026-10-05T00:00:00+09:00')})
 for(const user of ['client','host']){
  const draft=await createDraft(ctx,user,{purpose:'onboarding'},{key:'draft'})
  const patched=await patchDraft(ctx,user,{draftId:draft.draftId,expectedRevision:0,patch:{meetingWindows:[1,2,3,4,5].map(weekday=>({weekday,startMin:540,endMin:1080})),preferences:{weekdays:null,startTime:null,meetingMode:{value:'online',strength:'strong'},slack:null}},topicConfirmations:{work:'confirmed',meetingWindows:'confirmed',preferences:'confirmed'}},{key:'patch'})
  await confirmProfile(ctx,user,{draftId:draft.draftId,expectedRevision:patched.revision,baseProfileVersion:null},{key:'confirm'})
 }
 return {...store,ctx}
}
describe('booking search lifecycle',()=>{
 it('creates distinct visits, replays one search and inherits defaults',async()=>{
  const f=await searchFixture();try{
   const first=await createSearch(f.ctx,'client',{hostId:'host'},{key:'first'})
   expect(first.inheritedProfileVersion).toBe(1);expect(first.effectiveConditions.meetingMode?.value).toBe('online');expect(first.candidates).toHaveLength(3)
   expect(await createSearch(f.ctx,'client',{hostId:'host'},{key:'first'})).toEqual(first)
   expect((await createSearch(f.ctx,'client',{hostId:'host'},{key:'second'})).searchId).not.toBe(first.searchId)
   await expect(async () => await readSearch(f.ctx.db,'host',first.searchId)).rejects.toThrow()
  }finally{f.sqlite.close()}
 })
 it('disables inherited condition until explicitly restored, rejects stale edits',async()=>{
  const f=await searchFixture();try{
   const s=await createSearch(f.ctx,'client',{hostId:'host'},{key:'first'})
   const disabled=await changeConditions(f.ctx,'client',{searchId:s.searchId,expectedRevision:s.revision,commands:[{kind:'disable',dimension:'location'}]},{key:'disable'})
   expect(disabled.effectiveConditions.meetingMode).toBeUndefined()
   const restored=await changeConditions(f.ctx,'client',{searchId:s.searchId,expectedRevision:disabled.revision,commands:[{kind:'restore_inherited',dimension:'location'}]},{key:'restore'})
   expect(restored.effectiveConditions.meetingMode?.value).toBe('online')
   await expect(changeConditions(f.ctx,'client',{searchId:s.searchId,expectedRevision:s.revision,commands:[{kind:'disable',dimension:'location'}]},{key:'stale'})).rejects.toMatchObject({code:'revision_conflict'})
  }finally{f.sqlite.close()}
 })
 it('retries an interrupted creation without a duplicate search or first reply',async()=>{
  const f=await searchFixture();try{
   ;(await f.sqlite.exec("CREATE FUNCTION boom_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$; CREATE TRIGGER boom BEFORE INSERT ON search_messages FOR EACH ROW EXECUTE FUNCTION boom_fn()"))
   await expect(createSearch(f.ctx,'client',{hostId:'host'},{key:'flaky'})).rejects.toBeDefined()
   expect((await f.sqlite.prepare('SELECT count(*) n FROM booking_searches').get())).toEqual({n:1})
   ;(await f.sqlite.exec('DROP TRIGGER boom ON search_messages; DROP FUNCTION boom_fn'))
   const retry=await createSearch(f.ctx,'client',{hostId:'host'},{key:'flaky'})
   expect((await f.sqlite.prepare('SELECT count(*) n FROM booking_searches').get())).toEqual({n:1})
   expect(retry.messages.filter(m=>m.role==='assistant')).toHaveLength(1)
   expect((await f.sqlite.prepare('SELECT id FROM booking_searches').get())).toEqual({id:retry.searchId})
  }finally{f.sqlite.close()}
 })
})

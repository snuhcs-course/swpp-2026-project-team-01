import {it,expect,describe} from 'vitest'
import {searchFixture} from './search.test'
import {createSearch} from '@/server/services/search'
import {requestMeeting,previewAccept,acceptMeeting} from '@/server/services/booking-commands'
import {decideRequest} from '@/server/services/booking-commands'
import {createDraft,patchDraft,confirmProfile} from '@/server/services/profile'

type Fixture=Awaited<ReturnType<typeof searchFixture>>
async function addClient(f:Fixture,id:string){
 ;(await f.sqlite.prepare('INSERT INTO users(id,name) VALUES (?,?)').run(id,id))
 ;(await f.sqlite.prepare("INSERT INTO contacts(owner_id,contact_id,created_at) VALUES (?,'host',0),('host',?,0)").run(id,id))
 const draft=await createDraft(f.ctx,id,{purpose:'onboarding'},{key:'draft'})
 const patched=await patchDraft(f.ctx,id,{draftId:draft.draftId,expectedRevision:0,patch:{meetingWindows:[1,2,3,4,5].map(weekday=>({weekday,startMin:540,endMin:1080})),preferences:{weekdays:null,startTime:null,meetingMode:{value:'online',strength:'strong'},slack:null}},topicConfirmations:{work:'confirmed',meetingWindows:'confirmed',preferences:'confirmed'}},{key:'patch'})
 await confirmProfile(f.ctx,id,{draftId:draft.draftId,expectedRevision:patched.revision,baseProfileVersion:null},{key:'confirm'})
}
async function requestAt(f:Fixture,clientId:string,candidateIndex=0){
 const s=await createSearch(f.ctx,clientId,{hostId:'host'},{key:`search-${clientId}`})
 return (await requestMeeting(f.ctx,clientId,{searchId:s.searchId,expectedSearchRevision:s.revision,slot:s.candidates[candidateIndex],message:'Hello'},{key:`request-${clientId}`}))
}
describe('accept boundaries',()=>{
 it('accepts once when two connections race, leaving exactly two events',async()=>{
  const f=await searchFixture();try{
   const r=await requestAt(f,'client'),p=(await previewAccept(f.ctx,'host',r.id))
   const input={requestId:r.id,expectedRevision:r.revision,impactToken:p.impactToken}
   const results=await Promise.allSettled([acceptMeeting(f.ctx,'host',input,{key:'tab-a'}),acceptMeeting(f.ctx,'host',input,{key:'tab-b'})])
   expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1)
   const lost=results.find(x=>x.status==='rejected') as PromiseRejectedResult
   expect(['revision_conflict','request_not_pending']).toContain(lost.reason.code)
   expect((await f.sqlite.prepare("SELECT count(*) n FROM requests WHERE status='accepted'").get())).toEqual({n:1})
   expect((await f.sqlite.prepare("SELECT count(*) n FROM events WHERE source='booking'").get())).toEqual({n:2})
  }finally{f.sqlite.close()}
 })
 it('requires a new confirmation when the auto-declined set is replaced by one of the same size',async()=>{
  const f=await searchFixture();try{
   await addClient(f,'client2');await addClient(f,'client3')
   const target=await requestAt(f,'client'),other=await requestAt(f,'client2')
   const preview=(await previewAccept(f.ctx,'host',target.id))
   expect(preview.affectedIds).toEqual([other.id])
   await decideRequest(f.ctx,'client2',other.id,'withdraw',{expectedRevision:other.revision},{key:'withdraw'})
   const replacement=await requestAt(f,'client3')
   expect((await previewAccept(f.ctx,'host',target.id)).affectedIds).toEqual([replacement.id])
   await expect(acceptMeeting(f.ctx,'host',{requestId:target.id,expectedRevision:target.revision,impactToken:preview.impactToken},{key:'accept'})).rejects.toMatchObject({code:'accept_impact_changed'})
   expect((await f.sqlite.prepare('SELECT status FROM requests WHERE id=?').get(target.id))).toEqual({status:'pending'})
   expect((await f.sqlite.prepare('SELECT count(*) n FROM events').get())).toEqual({n:0})
  }finally{f.sqlite.close()}
 })
 it('rejects an expired impact confirmation',async()=>{
  const f=await searchFixture();try{
   const r=await requestAt(f,'client'),p=(await previewAccept(f.ctx,'host',r.id))
   const start=f.ctx.clock.now
   f.ctx.clock={now:()=>start()+5*60000+1}
   await expect(acceptMeeting(f.ctx,'host',{requestId:r.id,expectedRevision:r.revision,impactToken:p.impactToken},{key:'accept'})).rejects.toMatchObject({code:'accept_impact_changed'})
  }finally{f.sqlite.close()}
 })
})

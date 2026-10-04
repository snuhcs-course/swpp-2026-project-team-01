import {it,expect,describe} from 'vitest'
import {searchFixture} from './search.test'
import {createSearch} from '@/server/services/search'
import {requestMeeting,previewAccept,acceptMeeting} from '@/server/services/booking-commands'
describe('booking commit boundaries',()=>{
 it('replays successful request and acceptance with exactly two events',async()=>{
  const f=await searchFixture();try{
   const search=await createSearch(f.ctx,'client',{hostId:'host'},{key:'search'})
   const input={searchId:search.searchId,expectedSearchRevision:search.revision,slot:search.candidates[0],message:'Hello'}
   const request=await requestMeeting(f.ctx,'client',input,{key:'request'})
   expect(await requestMeeting(f.ctx,'client',input,{key:'request'})).toEqual(request)
   const preview=(await previewAccept(f.ctx,'host',request.id))
   const accepted=await acceptMeeting(f.ctx,'host',{requestId:request.id,expectedRevision:request.revision,impactToken:preview.impactToken},{key:'accept'})
   expect(accepted.eventIds).toHaveLength(2)
   expect(await acceptMeeting(f.ctx,'host',{requestId:request.id,expectedRevision:request.revision,impactToken:preview.impactToken},{key:'accept'})).toEqual(accepted)
   expect((await f.sqlite.prepare('SELECT count(*) n FROM events').get())).toEqual({n:2})
  }finally{f.sqlite.close()}
 })
 it('rejects a changed duration without changing the stored request end',async()=>{
  const f=await searchFixture();try{
   const s=await createSearch(f.ctx,'client',{hostId:'host'},{key:'search'})
   const r=await requestMeeting(f.ctx,'client',{searchId:s.searchId,expectedSearchRevision:s.revision,slot:s.candidates[0],message:'Hello'},{key:'request'})
   const p=(await previewAccept(f.ctx,'host',r.id))
   ;(await f.sqlite.exec("UPDATE meeting_types SET duration_min=60 WHERE id='short'"))
   await expect(acceptMeeting(f.ctx,'host',{requestId:r.id,expectedRevision:r.revision,impactToken:p.impactToken},{key:'accept'})).rejects.toMatchObject({code:'meeting_definition_changed'})
   expect((await f.sqlite.prepare('SELECT end_at,status FROM requests WHERE id=?').get(r.id))).toEqual({end_at:new Date(r.endAt).toISOString(),status:'pending'})
   expect((await f.sqlite.prepare('SELECT count(*) n FROM events').get())).toEqual({n:0})
  }finally{f.sqlite.close()}
 })
})

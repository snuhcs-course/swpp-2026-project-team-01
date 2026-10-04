import {describe,expect,it} from 'vitest'
import {searchFixture} from './search.test'
import {createSearch,changeConditions} from '@/server/services/search'
import {requestMeeting,previewAccept,acceptMeeting} from '@/server/services/booking-commands'
import {createDraft,patchDraft,confirmProfile,getProfile} from '@/server/services/profile'
describe('profile_to_booking_end_to_end (demo mode, no external services)',()=>{
 it('runs profile → first suggestions → this-time change → request → accept → later profile change',async()=>{
  const f=await searchFixture();try{
   // First suggestions inherit the confirmed profile.
   const search=await createSearch(f.ctx,'client',{hostId:'host'},{key:'search'})
   expect(search.inheritedProfileVersion).toBe(1)
   expect(search.candidates.length).toBeGreaterThan(0);expect(search.candidates.length).toBeLessThanOrEqual(3)
   // A this-time change affects only this search, not the profile.
   const changed=await changeConditions(f.ctx,'client',{searchId:search.searchId,expectedRevision:search.revision,commands:[{kind:'set',dimension:'order',value:'latest'}]},{key:'order'})
   expect(changed.overrides).toMatchObject({order:{state:'override',value:'latest'}})
   expect((await getProfile(f.ctx.db,'client'))?.version).toBe(1)
   // Request → accept.
   const request=await requestMeeting(f.ctx,'client',{searchId:changed.searchId,expectedSearchRevision:changed.revision,slot:changed.candidates[0],message:'Hello'},{key:'request'})
   const accepted=await acceptMeeting(f.ctx,'host',{requestId:request.id,expectedRevision:request.revision,impactToken:(await previewAccept(f.ctx,'host',request.id)).impactToken},{key:'accept'})
   expect(accepted.request.status).toBe('accepted');expect(accepted.eventIds).toHaveLength(2)
   // A later profile change creates version 2, keeps accepted events, and new searches inherit the latest version.
   const draft=await createDraft(f.ctx,'client',{purpose:'edit'},{key:'edit'})
   const patched=await patchDraft(f.ctx,'client',{draftId:draft.draftId,expectedRevision:draft.revision,patch:{preferences:{weekdays:null,startTime:null,meetingMode:null,slack:null}}},{key:'edit-patch'})
   const profile=await confirmProfile(f.ctx,'client',{draftId:draft.draftId,expectedRevision:patched.revision,baseProfileVersion:1},{key:'edit-confirm'})
   expect(profile.version).toBe(2)
   expect((await f.sqlite.prepare("SELECT id FROM events WHERE source='booking' ORDER BY id").all()).map((r:any)=>r.id).sort()).toEqual([...accepted.eventIds].sort())
   const later=await createSearch(f.ctx,'client',{hostId:'host'},{key:'later'})
   expect(later.inheritedProfileVersion).toBe(2);expect(later.searchId).not.toBe(search.searchId)
   expect(later.effectiveConditions.meetingMode).toBeUndefined()
  }finally{f.sqlite.close()}
 })
})

import { DomainError } from '@/contracts/common'
import type { ServiceContext } from '../runtime'
import { all, one, type Db } from '../db/client'
import { calendarProvider } from '../calendar-context'
import { readCalendarConnection,syncCalendar } from './calendar-sync'
import { profileReadiness } from './profile'
export type PreflightReceipt={userId:string;generation:number|null;selectionRevision:number;calendarUseRevision:number}
export async function preflightCalendars(ctx:ServiceContext,userIds:string[],key:string):Promise<PreflightReceipt[]> {
 const receipts:PreflightReceipt[]=[]
 for(const userId of [...new Set(userIds)]) {
  if(!(await profileReadiness(ctx.db,userId)).ready)throw new DomainError('setup_required','참여자 모두 미팅 허용 시간을 설정해야 해요')
  let view=await readCalendarConnection(ctx.db,userId)
  if(view.status==='reconnect_required')throw new DomainError('calendar_reconnect_required','참여자 캘린더 재연결이 필요해요')
  if(view.status==='decision_required')throw new DomainError('calendar_decision_required','Calendar 사용 여부를 먼저 확인해 주세요')
  if(view.status!=='manual') {
   if(!view.sources.some(s=>s.selected))throw new DomainError('calendar_decision_required','사용할 캘린더를 선택해 주세요')
   await syncCalendar(ctx,userId,{expectedSelectionRevision:view.selectionRevision},{key:`preflight.${key}.${userId}`.slice(0,200)},calendarProvider(userId),'future')
   view=await readCalendarConnection(ctx.db,userId)
  }
  receipts.push({userId,generation:view.status==='manual'?null:view.schedule!.generation,selectionRevision:view.selectionRevision,calendarUseRevision:view.revision})
 }
 return receipts
}
/** Run inside the committing transaction: the receipts must still describe the calendars exactly as they are at commit time. */
export async function checkReceipts(db:Db,receipts:PreflightReceipt[]) {
 for(const receipt of receipts){const view=await readCalendarConnection(db,receipt.userId);if(view.revision!==receipt.calendarUseRevision||view.selectionRevision!==receipt.selectionRevision||(receipt.generation===null?view.status!=='manual':view.status!=='connected'||view.schedule?.generation!==receipt.generation))throw new DomainError('calendar_snapshot_changed','확인 중 캘린더가 변경됐어요',true)}
}
export async function dataBasis(db:Db,userIds:string[]) {
 const out=[]
 for(const id of userIds)out.push({userId:id,user:await one(db,'SELECT current_profile_version,schedule_revision,host_settings_revision,annotation_revision,calendar_use_revision FROM users WHERE id=?',[id]),calendar:(await one(db,'SELECT generation,selection_revision,status FROM calendar_connections WHERE user_id=?',[id]))??null,
  rules:await all(db,'SELECT weekday,enabled,start_min,end_min FROM availability_rules WHERE user_id=? ORDER BY weekday',[id]),
  places:await all(db,'SELECT id,kind,name,revision,active FROM places WHERE host_id=? ORDER BY id',[id]),types:await all(db,'SELECT id,name,duration_min,revision,active FROM meeting_types WHERE host_id=? ORDER BY id',[id]),events:await all(db,'SELECT id,start_at,end_at,location_kind,place_ref,revision FROM events WHERE user_id=? ORDER BY id',[id])})
 return out
}

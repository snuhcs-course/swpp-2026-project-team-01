import {browserDraftInput,setupProgressInput,rebaseSetupInput,confirmSetupInput,setupState,setupRules,type SetupReadiness} from '../../contracts/setup.ts';
import {publicHandle} from '../../contracts/handles.ts';
import type {CalendarCatalog} from '../../contracts/calendar.ts';
import {Database} from '../database/client.ts';
import {CalendarSelection} from '../calendar/selection.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {ApplicationError} from '../errors.ts';
function selectedCalendarsAvailable(catalog:CalendarCatalog){
 const destination=catalog.calendars.find(c=>c.id===catalog.bookingCalendarId);
 return !!destination&&['owner','writer','writerWithoutPrivateAccess'].includes(destination.accessRole)&&catalog.conflictCalendarIds.length>0&&catalog.conflictCalendarIds.every(id=>catalog.calendars.some(c=>c.id===id));
}
export class HostSetup {
 constructor(private readonly database=new Database(),private readonly calendars=new CalendarSelection()){}
 private call(operation:string,credential:Credential,input:unknown){requireCredential(credential);if(credential.kind!=='host')throw new ApplicationError('FORBIDDEN',403);return this.database.rpc('fmat_host_setup',{p_operation:operation,p_credential:credential,p_input:input});}
 async read(credential:Credential){return setupState.parse(await this.call('read',credential,{}));}
 async readiness(credential:Credential):Promise<SetupReadiness>{
  const before=await this.read(credential),handle=publicHandle.safeParse(before.confirmed.handle);
  if(before.nextAction!=='settings_confirmed'||!handle.success||!before.confirmed.displayName||!setupRules.safeParse(before.confirmed.rules).success)return {ready:false,reason:'setup'};
  if(!before.calendarGeneration||!before.calendarSelected)return {ready:false,reason:'calendar'};
  const catalog=await this.calendars.list(credential);
  // Metadata is external I/O. Reauthorize and compare the exact setup snapshot
  // after it returns; neither stale permissions nor stale rules imply readiness.
  const after=await this.read(credential);
  if(after.revision!==before.revision||after.rulesVersion!==before.rulesVersion||after.calendarGeneration!==before.calendarGeneration||catalog.rulesVersion!==before.rulesVersion||catalog.generation!==before.calendarGeneration)throw new ApplicationError('STALE_REVISION',409);
  return selectedCalendarsAvailable(catalog)?{ready:true,handle:handle.data}:{ready:false,reason:'calendar'};
 }
 async draft(credential:Credential,input:unknown){return setupState.parse(await this.call('draft',credential,browserDraftInput.parse(input)));}
 async progress(credential:Credential,input:unknown){return setupState.parse(await this.call('progress',credential,setupProgressInput.parse(input)));}
 async rebase(credential:Credential,input:unknown){return setupState.parse(await this.call('rebase',credential,rebaseSetupInput.parse(input)));}
 async confirm(credential:Credential,input:unknown){
  const choice=confirmSetupInput.parse(input),replay=await this.call('confirm_replay',credential,choice);
  if(replay!==null)return setupState.parse(replay);
  const catalog=await this.calendars.list(credential);
  if(catalog.generation!==choice.calendarGeneration||catalog.rulesVersion!==choice.rulesVersion)throw new ApplicationError('STALE_REVISION',409);
  if(!selectedCalendarsAvailable(catalog))throw new ApplicationError('CALENDAR_ACCESS_INVALID',400);
  return setupState.parse(await this.call('confirm',credential,choice));
 }
}

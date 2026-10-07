import {browserDraftInput,setupProgressInput,rebaseSetupInput,confirmSetupInput,setupState} from '../../contracts/setup.ts';
import {Database} from '../database/client.ts';
import {CalendarSelection} from '../calendar/selection.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {ApplicationError} from '../errors.ts';
export class HostSetup {
 constructor(private readonly database=new Database(),private readonly calendars=new CalendarSelection()){}
 private call(operation:string,credential:Credential,input:unknown){requireCredential(credential);if(credential.kind!=='host')throw new ApplicationError('FORBIDDEN',403);return this.database.rpc('fmat_host_setup',{p_operation:operation,p_credential:credential,p_input:input});}
 async read(credential:Credential){return setupState.parse(await this.call('read',credential,{}));}
 async draft(credential:Credential,input:unknown){return setupState.parse(await this.call('draft',credential,browserDraftInput.parse(input)));}
 async progress(credential:Credential,input:unknown){return setupState.parse(await this.call('progress',credential,setupProgressInput.parse(input)));}
 async rebase(credential:Credential,input:unknown){return setupState.parse(await this.call('rebase',credential,rebaseSetupInput.parse(input)));}
 async confirm(credential:Credential,input:unknown){
  const choice=confirmSetupInput.parse(input),replay=await this.call('confirm_replay',credential,choice);
  if(replay!==null)return setupState.parse(replay);
  const catalog=await this.calendars.list(credential);
  if(catalog.generation!==choice.calendarGeneration||catalog.rulesVersion!==choice.rulesVersion)throw new ApplicationError('STALE_REVISION',409);
  const destination=catalog.calendars.find(c=>c.id===catalog.bookingCalendarId);
  if(!destination||!['owner','writer','writerWithoutPrivateAccess'].includes(destination.accessRole)||!catalog.conflictCalendarIds.length||catalog.conflictCalendarIds.some(id=>!catalog.calendars.some(c=>c.id===id)))throw new ApplicationError('CALENDAR_ACCESS_INVALID',400);
  return setupState.parse(await this.call('confirm',credential,choice));
 }
}

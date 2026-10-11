import {createHash} from 'node:crypto';
import {z} from 'zod';
import {configureCalendars} from '../../contracts/conversation-calendars.ts';
import {activeCalendars,calendarLabel} from '../../contracts/calendar-display.ts';
import {runtimeAuth} from '../identity/runtime-messages.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {TokenCipher} from './encryption.ts';
import {tokenBundle} from './google.ts';
import {GoogleCalendarProvider,type CalendarProvider} from './catalog.ts';
const grantSchema=z.object({connectionId:z.uuid(),generation:z.uuid(),principalId:z.uuid(),encryptedCredential:z.string(),rulesVersion:z.number().int(),conflictCalendarIds:z.array(z.string()),bookingCalendarId:z.string().nullable()});
const savedSchema=z.object({saved:z.literal(true),rulesVersion:z.number().int()});
const reference=(id:string)=>'cal_'+createHash('sha256').update(id).digest('hex').slice(0,24);
export class ConversationCalendars{
 constructor(private readonly database=new Database(),private readonly env=process.env,private readonly provider:CalendarProvider=new GoogleCalendarProvider(env)){}
 async execute(currentAuth:unknown,sessionId:string,input?:unknown){
  const auth=runtimeAuth.parse(currentAuth);
  const call=(operation:string,value:unknown)=>this.database.rpc('fmat_conversation_calendar',{p_grant_id:auth.principalId,p_conversation_id:auth.attributes.conversationId,p_session_id:sessionId,p_message_id:auth.attributes.messageId,p_operation:operation,p_input:value});
  const choice=input===undefined?undefined:configureCalendars.parse(input);
  if(choice){const replay=await call('replay',{choice});if(replay!==null)return savedSchema.parse(replay);}
  const grant=grantSchema.parse(await call('read',{})),cipher=new TokenCipher(this.env),context='google:host:'+grant.principalId;
  if(choice&&(choice.generation!==grant.generation||choice.rulesVersion!==grant.rulesVersion))throw new ApplicationError('STALE_REVISION',409);
  let bundle=tokenBundle.parse(cipher.open(grant.encryptedCredential,context));
  if(bundle.expiresAt<=Date.now()+60_000){
   bundle=await this.provider.refresh(bundle);
   await call('refresh',{connectionId:grant.connectionId,generation:grant.generation,previousCredential:grant.encryptedCredential,encryptedCredential:cipher.seal(bundle,context)});
  }
  const catalog=await this.provider.list(bundle.accessToken),calendars=activeCalendars(catalog);
  if(choice){
   const conflicts=choice.conflictCalendars.map(ref=>calendars.find(c=>reference(c.id)===ref)),booking=calendars.find(c=>reference(c.id)===choice.bookingCalendar);
   if(conflicts.some(c=>!c)||!booking||!['owner','writer','writerWithoutPrivateAccess'].includes(booking.accessRole))throw new ApplicationError('CALENDAR_ACCESS_INVALID',400);
   return savedSchema.parse(await call('select',{choice,selection:{generation:grant.generation,rulesVersion:grant.rulesVersion,connectionId:grant.connectionId,conflictCalendarIds:conflicts.map(c=>c!.id),bookingCalendarId:booking.id,verifiedCalendars:calendars.map(c=>({id:c.id,accessRole:c.accessRole}))}}));
  }
  await call('check',{connectionId:grant.connectionId,generation:grant.generation});
  return {generation:grant.generation,rulesVersion:grant.rulesVersion,total:calendars.length,calendars:calendars.slice(0,100).map(c=>({reference:reference(c.id),name:calendarLabel(c,catalog),primary:c.primary,writable:['owner','writer','writerWithoutPrivateAccess'].includes(c.accessRole),checksConflicts:grant.conflictCalendarIds.includes(c.id),receivesBookings:grant.bookingCalendarId===c.id}))};
 }
}

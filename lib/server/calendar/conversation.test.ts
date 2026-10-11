import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ConversationCalendars} from './conversation.ts';
import {TokenCipher} from './encryption.ts';
import {ApplicationError} from '../errors.ts';
import type {Database} from '../database/client.ts';
import type {CalendarProvider} from './catalog.ts';
import type {CalendarCatalog} from '../../contracts/calendar.ts';
function fixture(){
 const host=randomUUID(),env={TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,3).toString('base64')},auth={authenticator:'fmat-conversation',principalType:'user',principalId:randomUUID(),attributes:{conversationId:randomUUID(),messageId:randomUUID()}},calls:string[]=[];
 const bundle={accessToken:'private-access',refreshToken:'private-refresh',subject:'google',scopes:['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],expiresAt:Date.now()+3600000};
 const grant={connectionId:randomUUID(),generation:randomUUID(),principalId:host,rulesVersion:4,conflictCalendarIds:[],bookingCalendarId:null,encryptedCredential:new TokenCipher(env).seal(bundle,'google:host:'+host)};
 const calendars:CalendarCatalog['calendars']=[{id:'https://private-calendar.test/id',name:'Personal',primary:true,accessRole:'owner',active:true,timeZone:'Asia/Seoul',color:null},{id:'school',name:'School',primary:false,accessRole:'reader',active:true,timeZone:null,color:null},{id:'hidden',name:'Hidden',primary:false,accessRole:'owner',active:false,timeZone:null,color:null}];
 let replay:unknown=null,denied=false,selection:unknown;
 const database={rpc:async(_name:string,args:Record<string,unknown>)=>{assert.equal(args.p_message_id,auth.attributes.messageId);assert.equal(args.p_session_id,'current-runtime');const operation=String(args.p_operation);calls.push(operation);if(denied)throw new ApplicationError('UNAUTHORIZED',401);if(operation==='replay')return replay;if(operation==='read')return grant;if(operation==='select'){selection=args.p_input;return {saved:true,rulesVersion:5};}return {current:true};}} as unknown as Database;
 const provider:CalendarProvider={refresh:async()=>({...bundle,expiresAt:Date.now()+3600000}),list:async()=>{calls.push('provider');return calendars;}};
 return {auth,grant,calls,calendars,provider,service:new ConversationCalendars(database,env,provider,{recommend:async()=>({start:new Date().toISOString(),end:new Date().toISOString(),conflictCalendarIds:['school'],bookingCalendarId:calendars[0].id,evidence:[]})}),deny:()=>{denied=true;},replay:(value:unknown)=>{replay=value;},selection:()=>selection};
}
test('private Calendar tools expose safe active names/references and apply exact current choices',async()=>{
 const f=fixture(),list=await f.service.execute(f.auth,'current-runtime');assert.ok('calendars' in list);assert.equal(list.calendars.length,2);assert.doesNotMatch(JSON.stringify(list),/private-access|private-refresh|https:\/\/private-calendar|Hidden/);assert.deepEqual(f.calls,['read','provider','check']);
 const choice={generation:list.generation,rulesVersion:list.rulesVersion,conflictCalendars:list.calendars.map(c=>c.reference),bookingCalendar:list.calendars[0].reference};
 assert.deepEqual(await f.service.execute(f.auth,'current-runtime',choice),{saved:true,rulesVersion:5});
 assert.deepEqual((f.selection() as {selection:{conflictCalendarIds:string[]}}).selection.conflictCalendarIds,['https://private-calendar.test/id','school']);
 f.replay({saved:true,rulesVersion:5});f.calls.length=0;await f.service.execute(f.auth,'current-runtime',choice);assert.deepEqual(f.calls,['replay'],'exact recovery needs no second provider call');
});
test('Calendar tools reject stale revisions, hidden/read-only choices and revoked authority after provider I/O',async()=>{
 const f=fixture(),list=await f.service.execute(f.auth,'current-runtime');assert.ok('calendars' in list);
 const choice={generation:list.generation,rulesVersion:list.rulesVersion,conflictCalendars:[list.calendars[0].reference],bookingCalendar:list.calendars[0].reference};
 await assert.rejects(f.service.execute(f.auth,'current-runtime',{...choice,rulesVersion:3}),{code:'STALE_REVISION'});
 await assert.rejects(f.service.execute(f.auth,'current-runtime',{...choice,bookingCalendar:list.calendars[1].reference}),{code:'CALENDAR_ACCESS_INVALID'});
 f.calendars[0].active=false;await assert.rejects(f.service.execute(f.auth,'current-runtime',choice),{code:'CALENDAR_ACCESS_INVALID'});assert.equal(f.selection(),undefined);
 f.provider.list=async()=>{f.deny();return f.calendars;};await assert.rejects(f.service.execute(f.auth,'current-runtime'),{code:'UNAUTHORIZED'});
});

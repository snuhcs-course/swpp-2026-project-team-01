import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {HostSetup} from '../../lib/server/setup/commands.ts';
import type {CalendarProvider} from '../../lib/server/calendar/catalog.ts';
import {CalendarSelection} from '../../lib/server/calendar/selection.ts';
import {CalendarConsent} from '../../lib/server/calendar/consent.ts';
import {PublicIntake} from '../../lib/server/identity/public-intake.ts';
import {calendarScopes} from '../../lib/server/calendar/google.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import type {Credential} from '../../lib/server/identity/credentials.ts';
import type {Database} from '../../lib/server/database/client.ts';
import type {LocalSql} from './local-sql.ts';
import {setupInvalid,setupFalseCompletion,setupAmbiguous,setupDoubleWrite,setupReady} from '../runtime/setup-preferences.ts';

const errorCode=(code:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===code;

// Called inside the real signed-ingress/eve integration, after verified linking.
// The model is deterministic; Calendar metadata is an injected provider fixture.
export async function verifySharedSetupReview(input:{sql:LocalSql;database:Database;env:NodeJS.ProcessEnv;host:string;credential:Credential;scope:string;turn:(text:string)=>Promise<string>}){
 const {sql,database,env,host,credential,scope,turn}=input;
 const provider:CalendarProvider={async refresh(bundle){return bundle;},async list(){return [{id:'shared-setup',name:'Fixture calendar',accessRole:'owner' as const,primary:true,timeZone:'Asia/Seoul',color:null}];}};
 const calendars=new CalendarSelection(database,env,provider);
 const setup=new HostSetup(database,calendars);
 let state=await setup.read(credential);
 const original=state;
 assert.match(await turn(setupInvalid),/operation was rejected/);
 assert.deepEqual(await setup.read(credential),original,'invalid model input must not create a draft or revise settings');
 assert.match(await turn(setupFalseCompletion),/operation was rejected/);
 assert.deepEqual(await setup.read(credential),original,'false completion clarification must not create a draft or change settings');
 assert.equal(await turn(setupAmbiguous),'Which weekdays and start and end times work for meetings?');
 state=await setup.read(credential);
 assert.deepEqual(state.draft?.clarifications,['Which weekdays and start and end times work for meetings?']);
 assert.equal(state.review,null,'unresolved extraction cannot create a confirmable review');
 assert.deepEqual(state.confirmed,original.confirmed);
 let verifier='',nonce='';
 const consent=new CalendarConsent(database,env,{authorization(_kind,state,v,n){verifier=v;nonce=n;return 'https://accounts.google.com/o/oauth2/v2/auth?state='+state;},async exchange(_code,v,n,kind){assert.equal(v,verifier);assert.equal(n,nonce);return {accessToken:'shared-setup-fixture',refreshToken:'shared-setup-refresh',subject:'fixture',scopes:[...calendarScopes[kind]],expiresAt:Date.now()+3600_000};}});
 try{
 const denied=await consent.start(credential);assert.equal((await consent.callback(denied.state,denied.binding,null,true)).result,'denied');
 assert.deepEqual(await setup.read(credential),state,'Denied consent preserves the private draft');assert.equal((await consent.status(credential)).connected,false);
 const started=await consent.start(credential);assert.equal((await consent.callback(started.state,started.binding,'fixture-code',false)).result,'connected');
 const catalog=await calendars.list(credential);
 await calendars.select(credential,{generation:catalog.generation,rulesVersion:catalog.rulesVersion,conflictCalendarIds:['shared-setup'],bookingCalendarId:'shared-setup'});
 state=await setup.read(credential);
 if(state.nextAction==='refresh_draft')state=await setup.rebase(credential,{expectedRevision:state.revision,rulesVersion:state.rulesVersion,idempotencyKey:randomUUID()});
  // Explicit web answers resolve ambiguity. Duration remains an assistant
  // suggestion, so a later private turn can revise it without overriding a choice.
  state=await setup.draft(credential,{expectedRevision:state.revision,idempotencyKey:randomUUID(),patch:{displayName:'Shared setup',handle:'shared-'+host.slice(0,8),rules:{meetingMode:'either',locationPolicy:'preferred',locations:['Library lounge'],travelMode:'TRANSIT',travelBufferMinutes:20}},unresolved:[]});
  assert.ok(state.review);
  const beforeAssent=state;
  assert.equal(await turn('yes'),'Confirm the exact current settings in the protected review.');
  assert.deepEqual(await setup.read(credential),beforeAssent,'Bare private-channel assent cannot confirm a pending review or change its draft, even when the model asks');
  const confirmation=(value:typeof state)=>({expectedRevision:value.revision,draftRevision:value.review!.draftRevision,reviewRevision:value.review!.revision,rulesVersion:value.rulesVersion,calendarGeneration:value.calendarGeneration!,confirmed:true as const,idempotencyKey:randomUUID()});
  const oldReview=confirmation(state),before=state;
  assert.match(await turn(setupDoubleWrite),/operation was rejected/);
  state=await setup.read(credential);
  assert.equal(state.revision,before.revision+1,'changed tool-call IDs cannot create a second mutation for one message');
  assert.equal(state.draft?.settings.rules?.durationMinutes,45,'changed retry cannot overwrite the first committed extraction');
  assert.equal(state.draft?.provenance['rules.durationMinutes'],'assistant');
  assert.equal(state.draft?.provenance['rules.meetingMode'],'host');
  assert.deepEqual(state.confirmed,original.confirmed);
  await assert.rejects(setup.confirm(credential,oldReview),errorCode('STALE_REVISION'));
  assert.deepEqual(await setup.read(credential),state,'stale web confirmation preserves the newer private draft');
  const grant=await sql.query(`select grant_id from fmat.runtime_messages where conversation_id='${scope}' order by created_at desc limit 1;`);
  await assert.rejects(database.rpc('fmat_conversation_tool',{p_grant_id:grant,p_conversation_id:scope,p_operation:'setup_confirm',p_input:confirmation(state)}),errorCode('FORBIDDEN'));
  const current=confirmation(state),saved=await setup.confirm(credential,current);
  assert.equal(saved.confirmed.rules?.durationMinutes,45);
  assert.equal(saved.nextAction,'settings_confirmed');
  assert.deepEqual(await setup.readiness(credential),{ready:true,handle:saved.confirmed.handle});
  const profile=await new PublicIntake(database,env,provider).profile(saved.confirmed.handle!);
  assert.equal(await turn(setupReady),`Ready: ${env.APP_ORIGIN}/${saved.confirmed.handle} | ${env.APP_ORIGIN}/${saved.confirmed.handle}/SKILL.md`);
  assert.equal(profile.handle,saved.confirmed.handle);assert.deepEqual(Object.keys(profile).sort(),['displayName','durationMinutes','handle','timezone']);
  assert.equal((await setup.confirm(credential,current)).rulesVersion,saved.rulesVersion,'lost web response cannot save twice');
  assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where host_id='${host}';`),'0');
  assert.equal(await sql.query(`select count(*) from fmat.setup_turns t join fmat.setup_conversations c on c.id=t.conversation_id where c.host_id='${host}' and t.channel='imessage';`),'3','only valid private extractions create setup turns');
  await consent.disconnect(credential);assert.equal((await setup.readiness(credential)).ready,false);
  assert.deepEqual((await setup.read(credential)).confirmed,saved.confirmed,'Disconnect preserves confirmed settings but revokes readiness');
  await assert.rejects(new PublicIntake(database,env,provider).profile(saved.confirmed.handle!),errorCode('NOT_FOUND'));
  assert.equal(await turn(setupReady),'Setup is not ready; continue in the workspace.');
 }finally{
  await sql.query(`delete from fmat.oauth_exchanges where actor->>'id'='${host}';delete from fmat.calendar_connections where principal_kind='host' and principal_id='${host}';`);
 }
}

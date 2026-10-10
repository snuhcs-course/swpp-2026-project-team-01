import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Database} from '../../lib/server/database/client.ts';
import {HostSetup} from '../../lib/server/setup/commands.ts';
import {CalendarConsent} from '../../lib/server/calendar/consent.ts';
import {CalendarSelection} from '../../lib/server/calendar/selection.ts';
import {calendarScopes} from '../../lib/server/calendar/google.ts';
import type {CalendarProvider} from '../../lib/server/calendar/catalog.ts';
import type {Credential} from '../../lib/server/identity/credentials.ts';
import {dispatchPhotonInputs} from '../../lib/server/photon/execution.ts';
import {dispatchPhotonReplies} from '../../lib/server/photon/replies.ts';
import {describedPreferences,describedOnlinePreferences} from '../runtime/setup-preferences.ts';
import type {LocalSql} from './local-sql.ts';
const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";

/** Fresh admitted/linked hosts; actual signed ingress and eve extraction, with
 * synthetic Calendar/Photon transport. No browser preference acceptance. */
export async function verifyNativeSetupAnswers(input:{sql:LocalSql;database:Database;env:NodeJS.ProcessEnv;host:string;credential:Credential;scope:string;mode:'physical'|'online';receive:(text:string)=>Promise<string>;runRuntime:()=>Promise<void>;modelCount:()=>Promise<number>}){
 const {sql,database,env,host,credential,scope,mode,receive,runRuntime,modelCount}=input;
 let reads=0;
 const provider:CalendarProvider={async refresh(value){return value;},async list(){reads++;return [{id:'native-answers',name:'Native answers calendar',accessRole:'owner',primary:true,timeZone:'Asia/Seoul',color:null}];}};
 const selection=new CalendarSelection(database,env,provider),setup=new HostSetup(database,selection);
 const consent=new CalendarConsent(database,env,{authorization(){return 'https://accounts.google.com/fixture';},async exchange(_code,_verifier,_nonce,kind){return {accessToken:'native-fixture',refreshToken:'native-refresh',subject:'native-subject',scopes:[...calendarScopes[kind]],expiresAt:Date.now()+3600000};}});
 const owned:string[]=[],sent=new Set<string>(),selectedRequest=randomUUID();
 const enqueue=async(text:string)=>{const id=await receive(text);owned.push(id);return id;};
 const reply=(id:string)=>sql.query(`select text from fmat.photon_replies where inbox_id=${q(id)};`);
 async function drain(){for(let n=0;n<40;n++){
  const result=await dispatchPhotonReplies(database,env,{async send(_route,_phone,_text,id,authorize){await authorize();assert.ok(!sent.has(id),'Stable reply is sent once');sent.add(id);return {status:'delivered',providerReference:id};},async reconcile(_route,reference){assert.ok(reference);return {status:'delivered',providerReference:reference};}});
  if(result.claimed===0&&result.suppressed===0)return;
 }assert.fail('Native answer replies did not drain');}
 async function turn(text:string){const id=await enqueue(text);assert.equal((await dispatchPhotonInputs(database,env,provider)).accepted,1);return {id,text:await reply(id)};}
 async function review(){const result=await turn('review setup answers');const id=await sql.query(`select id from fmat.photon_setup_answer_reviews where inbox_id=${q(result.id)};`);assert.ok(id);assert.ok(result.text.includes(id));await drain();return {id,text:result.text};}
 try{
  const start=await consent.start(credential);assert.equal((await consent.callback(start.state,start.binding,'fixture',false)).result,'connected');
  const catalog=await selection.list(credential);await selection.select(credential,{generation:catalog.generation,rulesVersion:catalog.rulesVersion,conflictCalendarIds:['native-answers'],bookingCalendarId:'native-answers'});
  let state=await setup.read(credential);
  if(state.nextAction==='refresh_draft')state=await setup.rebase(credential,{expectedRevision:state.revision,rulesVersion:state.rulesVersion,idempotencyKey:randomUUID()});
  // Browser supplies only profile identity; every scheduling preference below
  // is extracted by the actual eve fixture and begins with assistant provenance.
  state=await setup.draft(credential,{expectedRevision:state.revision,idempotencyKey:randomUUID(),patch:{handle:'native-'+host.slice(0,8),displayName:'Native setup host'},unresolved:[]});
  const confirmed=state.confirmed;
  await enqueue(mode==='physical'?describedPreferences:describedOnlinePreferences);
  assert.equal((await dispatchPhotonInputs(database,env,provider)).accepted,1);await runRuntime();await drain();
  state=await setup.read(credential);assert.deepEqual(state.confirmed,confirmed);
  assert.equal(state.draft?.settings.rules?.meetingMode,mode==='physical'?'either':'online');
  assert.equal(state.draft?.provenance['rules.meetingMode'],'assistant');
  const extracted=state;
  // Bare assent still traverses eve and cannot confer confirmation authority.
  await enqueue('yes');assert.equal((await dispatchPhotonInputs(database,env,provider)).accepted,1);await runRuntime();await drain();
  assert.deepEqual(await setup.read(credential),extracted);
  const beforeModels=await modelCount(),beforeReads=reads;
  await sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values(${q(selectedRequest)},${q(host)},'{"purpose":"Native scope fixture"}',repeat('c',64),clock_timestamp()+interval '1 day');update fmat.photon_links set selected_request_id=${q(selectedRequest)} where host_id=${q(host)} and revoked_at is null;`);
  const premature=await turn('review setup');assert.match(premature.text,/Open your host workspace/u);await drain();
  let answer=await review();
  if(mode==='online'){assert.match(answer.text,/mode/u);assert.doesNotMatch(answer.text,/transport:|location:|travel_buffer:/u);}
  else {assert.match(answer.text,/Library lounge/u);assert.match(answer.text,/Public transit/u);}
  const malformed=await turn(`accept setup answers ${answer.id} all`);assert.match(malformed.text,/No answers were accepted/u);await drain();
  assert.deepEqual(await setup.read(credential),extracted);
  if(mode==='physical'){
   // A subset updates only the explicitly selected mode; remaining answers stay
   // assistant-owned and a fresh review is required for the rest.
   const partial=await turn(`accept setup answers ${answer.id} mode`);assert.match(partial.text,/Accepted the selected draft answers/u);await drain();
   state=await setup.read(credential);assert.equal(state.draft?.provenance['rules.meetingMode'],'host');assert.equal(state.draft?.provenance['rules.travelMode'],'assistant');assert.deepEqual(state.confirmed,confirmed);
   answer=await review();assert.doesNotMatch(answer.text,/^mode:/mu);
  }
  const beforeAccept=await setup.read(credential),keys=mode==='physical'?'location,transport,travel_buffer':'mode';
  const decision=await enqueue(`accept setup answers ${answer.id} ${keys}`),later=await enqueue('review setup answers');
  let lost=false;
  const lossy=new Database(env,async(url,options)=>{const response=await fetch(url,options),body=typeof options?.body==='string'?JSON.parse(options.body):{};
   if(!lost&&String(url).endsWith('/fmat_photon_setup_dispatch')&&body.p_operation==='operate_answers'&&body.p_input.operation==='accept'&&response.ok){lost=true;await response.arrayBuffer();throw new Error('Synthetic lost committed answer acceptance');}return response;});
  assert.equal((await dispatchPhotonInputs(lossy,env,provider)).accepted,0);assert.ok(lost);
  state=await setup.read(credential);assert.equal(state.revision,beforeAccept.revision+1);assert.deepEqual(state.confirmed,confirmed);
  assert.equal(await reply(decision),'');assert.equal(await sql.query(`select processed_at is null from fmat.photon_inbox where id=${q(later)};`),'t');
  assert.equal(state.draft?.provenance['rules.meetingMode'],'host');assert.equal(state.draft?.origins['rules.meetingMode']?.source,'assistant');
  if(mode==='physical')for(const key of ['locationPolicy','locations','travelMode','travelBufferMinutes'] as const){assert.equal(state.draft?.provenance['rules.'+key],'host');assert.equal(state.draft?.origins['rules.'+key]?.source,'assistant');}
  assert.deepEqual(state.draft?.clarifications,beforeAccept.draft?.clarifications);
  // A browser correction after the committed acceptance survives a new worker.
  state=await setup.draft(credential,{expectedRevision:state.revision,idempotencyKey:randomUUID(),patch:{rules:{bufferMinutes:15}},unresolved:state.draft?.clarifications??[]});
  const quota=await sql.query(`select minute_used from fmat.conversation_budgets where name=${q('host:'+host)};`);
  await sql.query(`update fmat.jobs set available_at=clock_timestamp() where payload->>'inboxId'=${q(decision)};`);
  assert.equal((await dispatchPhotonInputs(new Database(env),env,provider)).accepted,1);
  assert.equal(await sql.query(`select minute_used from fmat.conversation_budgets where name=${q('host:'+host)};`),quota);
  assert.deepEqual(await new HostSetup(new Database(env),selection).read(credential),state,'New browser service resumes exact latest draft');
  assert.match(await reply(decision),/Settings have not been saved/u);
  assert.equal((await dispatchPhotonInputs(database,env,provider)).accepted,1);assert.match(await reply(later),/Open your host workspace/u);await drain();
  assert.equal(reads,beforeReads,'Answer commands and replay require no provider calls');
  const final=await turn('review setup'),finalId=await sql.query(`select id from fmat.photon_setup_reviews where inbox_id=${q(final.id)};`);
  assert.ok(final.text.includes('confirm setup '+finalId));await drain();
  const saved=await turn('confirm setup '+finalId);assert.match(saved.text,/^Saved the settings from setup review/u);await drain();
  const resumed=await new HostSetup(new Database(env),selection).read(credential);
  assert.equal(resumed.confirmed.rules?.meetingMode,mode==='physical'?'either':'online');assert.equal(resumed.confirmed.rules?.bufferMinutes,15);
  assert.deepEqual(await setup.readiness(credential),{ready:true,handle:resumed.confirmed.handle});
  assert.equal(await modelCount(),beforeModels,'Exact answer/final commands never call model');
  assert.equal(await sql.query(`select selected_request_id from fmat.photon_links where host_id=${q(host)} and revoked_at is null;`),selectedRequest);
  assert.equal(await sql.query(`select bool_and(conversation_id=${q(scope)}) from fmat.photon_inbox where id in(${owned.slice(2).map(q).join(',')});`),'t','Answer commands preserve request selection and use canonical setup scope');
  assert.equal(await sql.query(`select count(*) from fmat.photon_setup_answer_acceptances where inbox_id=${q(decision)};`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.photon_replies where inbox_id=${q(decision)};`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.host_approvals where host_id=${q(host)};`),'0');
  assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where host_id=${q(host)};`),'0');
  assert.equal(await sql.query(`select count(*) from fmat.runtime_messages where id in(select runtime_message_id from fmat.photon_inbox where id in(${owned.slice(2).map(q).join(',')}));`),'0');
 }finally{
  await sql.query(`delete from fmat.photon_setup_answer_acceptances where review_id in(select id from fmat.photon_setup_answer_reviews where host_id=${q(host)});delete from fmat.photon_setup_answer_review_publications where review_id in(select id from fmat.photon_setup_answer_reviews where host_id=${q(host)});delete from fmat.photon_setup_answer_reviews where host_id=${q(host)};
   delete from fmat.photon_setup_confirmations where review_id in(select id from fmat.photon_setup_reviews where host_id=${q(host)});delete from fmat.photon_setup_permission_checks where review_id in(select id from fmat.photon_setup_reviews where host_id=${q(host)});delete from fmat.photon_setup_review_publications where review_id in(select id from fmat.photon_setup_reviews where host_id=${q(host)});delete from fmat.photon_setup_reviews where host_id=${q(host)};delete from fmat.photon_setup_dispatches where inbox_id in(select i.id from fmat.photon_inbox i join fmat.photon_links l on l.id=i.link_id where l.host_id=${q(host)});`);
  await sql.query(`update fmat.photon_links set selected_request_id=null where host_id=${q(host)};delete from fmat.requests where id=${q(selectedRequest)};`);
  await consent.disconnect(credential);
  await sql.query(`delete from fmat.oauth_exchanges where actor->>'id'=${q(host)};delete from fmat.calendar_connections where principal_kind='host' and principal_id=${q(host)};`);
 }
}

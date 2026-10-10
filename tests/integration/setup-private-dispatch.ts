import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Database} from '../../lib/server/database/client.ts';
import {HostSetup} from '../../lib/server/setup/commands.ts';
import {PublicIntake} from '../../lib/server/identity/public-intake.ts';
import {CalendarConsent} from '../../lib/server/calendar/consent.ts';
import {CalendarSelection} from '../../lib/server/calendar/selection.ts';
import {calendarScopes} from '../../lib/server/calendar/google.ts';
import type {CalendarProvider} from '../../lib/server/calendar/catalog.ts';
import type {Credential} from '../../lib/server/identity/credentials.ts';
import {dispatchPhotonInputs} from '../../lib/server/photon/execution.ts';
import {dispatchPhotonReplies} from '../../lib/server/photon/replies.ts';
import type {LocalSql} from './local-sql.ts';
const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";

/** Runs inside the signed-ingress/actual-eve fixture with an admitted browser
 * credential and linked private route. All Calendar/Photon I/O is synthetic. */
export async function verifyPrivateSetupDispatch(input:{sql:LocalSql;database:Database;env:NodeJS.ProcessEnv;host:string;credential:Credential;scope:string;selectedRequest:string;receive:(text:string)=>Promise<string>;runRuntime:()=>Promise<void>;modelCount:()=>Promise<number>}){
 const {sql,database,env,host,credential,scope,receive,runRuntime,modelCount}=input;
 let reads=0;
 const provider:CalendarProvider={async refresh(value){return value;},async list(){reads++;return [{id:'private-setup',name:'Private setup calendar',accessRole:'owner',primary:true,timeZone:'Asia/Seoul',color:null}];}};
 const selection=new CalendarSelection(database,env,provider),setup=new HostSetup(database,selection);
 const consent=new CalendarConsent(database,env,{authorization(){return 'https://accounts.google.com/fixture';},async exchange(_code,_verifier,_nonce,kind){return {accessToken:'private-dispatch-fixture',refreshToken:'private-refresh',subject:'private-subject',scopes:[...calendarScopes[kind]],expiresAt:Date.now()+3600000};}});
 const sent=new Map<string,string>(),owned:string[]=[];
 const enqueue=async(text:string)=>{const id=await receive(text);owned.push(id);return id;};
 const reply=(id:string)=>sql.query(`select text from fmat.photon_replies where inbox_id=${q(id)};`);
 const version=()=>sql.query(`select rules_version from fmat.hosts where id=${q(host)};`);
 async function drain(){
  for(let n=0;n<40;n++){
   const result=await dispatchPhotonReplies(database,env,{async send(_route,_phone,text,id,authorize){await authorize();assert.ok(!sent.has(id),'No duplicate provider send identity');sent.set(id,text);return {status:'delivered',providerReference:id};},async reconcile(_route,reference){assert.ok(reference);return {status:'delivered',providerReference:reference};}});
   if(result.claimed===0&&result.suppressed===0)return;
  }
  assert.fail('Private fixture replies did not drain');
 }
 async function turn(text:string){const id=await enqueue(text);assert.equal((await dispatchPhotonInputs(database,env,provider)).accepted,1);return {id,text:await reply(id)};}
 async function newReview(){const value=await turn('review setup'),reviewId=await sql.query(`select id from fmat.photon_setup_reviews where inbox_id=${q(value.id)};`);assert.ok(value.text.includes('confirm setup '+reviewId));await drain();return reviewId;}
 try{
  await sql.query(`update fmat.conversation_budgets set minute_used=0,hour_used=0 where name=${q('host:'+host)};`);
  const start=await consent.start(credential);assert.equal((await consent.callback(start.state,start.binding,'fixture',false)).result,'connected');
  const catalog=await selection.list(credential);await selection.select(credential,{generation:catalog.generation,rulesVersion:catalog.rulesVersion,conflictCalendarIds:['private-setup'],bookingCalendarId:'private-setup'});
  let state=await setup.read(credential);
  if(state.nextAction==='refresh_draft')state=await setup.rebase(credential,{expectedRevision:state.revision,rulesVersion:state.rulesVersion,idempotencyKey:randomUUID()});
  state=await setup.draft(credential,{expectedRevision:state.revision,idempotencyKey:randomUUID(),patch:{rules:{meetingMode:'online',bufferMinutes:15}},unresolved:[]});
  const initialVersion=await version(),beforeAssent=state;
  await enqueue('yes');assert.equal((await dispatchPhotonInputs(database,env,provider)).accepted,1);await runRuntime();
  assert.deepEqual(await setup.read(credential),beforeAssent,'Actual eve overinterpretation cannot save or mutate settings');
  await drain();const beforeModels=await modelCount();
  await sql.query(`update fmat.photon_links set selected_request_id=${q(input.selectedRequest)} where host_id=${q(host)} and revoked_at is null;`);
  const first=await newReview();
  assert.equal(await sql.query(`select selected_request_id from fmat.photon_links where host_id=${q(host)} and revoked_at is null;`),input.selectedRequest,'Setup review does not change selected request');
  assert.equal(await sql.query(`select conversation_id from fmat.photon_inbox where id=${q(owned.at(-1)!)};`),scope,'Selected request still routes setup command to canonical setup scope');
  state=await setup.draft(credential,{expectedRevision:state.revision,idempotencyKey:randomUUID(),patch:{rules:{bufferMinutes:20}},unresolved:[]});
  assert.match((await turn('confirm setup '+first)).text,/no longer current/u);assert.equal(await version(),initialVersion);await drain();
  const reviewId=await newReview();
  const confirmation=await enqueue('confirm setup '+reviewId),later=await enqueue('confirm setup malformed');
  const beforeReads=reads;
  let lost=false;
  const lossy=new Database(env,async(url,options)=>{
   const response=await fetch(url,options),body=typeof options?.body==='string'?JSON.parse(options.body):{};
   if(!lost&&String(url).endsWith('/fmat_photon_setup_dispatch')&&body.p_operation==='operate'&&body.p_input.operation==='finish_confirmation'&&response.ok){lost=true;await response.arrayBuffer();throw new Error('Synthetic loss after confirmed save');}
   return response;
  });
  assert.equal((await dispatchPhotonInputs(lossy,env,provider)).accepted,0);assert.equal(lost,true);
  assert.equal(reads,beforeReads+1);assert.equal(await version(),String(Number(initialVersion)+1));
  assert.equal(await sql.query(`select processed_at is null from fmat.photon_inbox where id=${q(later)};`),'t','Later command waits behind recovering confirmation');
  assert.equal(await reply(confirmation),'','Unacknowledged save does not fabricate a reply before recovery');
  const resumed=await setup.read(credential),readiness=await setup.readiness(credential);
  assert.deepEqual(readiness,{ready:true,handle:resumed.confirmed.handle},'Committed private confirmation exposes current readiness before a new draft');
  const publicProfile=await new PublicIntake(database,env,provider).profile(readiness.handle!);
  assert.equal(publicProfile.handle,resumed.confirmed.handle);
  assert.deepEqual(Object.keys(publicProfile).sort(),['displayName','durationMinutes','handle','timezone']);
  assert.doesNotMatch(JSON.stringify(publicProfile),/private-dispatch-fixture|private-refresh|private-subject|private-setup|bufferMinutes|preferences/u,'Public readiness never publishes provider credentials or private settings');
  const beforeReplayReads=reads;
  // The original committed receipt must survive a newer web draft and a worker
  // restart. No recheck of the provider can overwrite the saved old decision.
  state=await setup.read(credential);state=await setup.draft(credential,{expectedRevision:state.revision,idempotencyKey:randomUUID(),patch:{rules:{bufferMinutes:25}},unresolved:[]});
  await sql.query(`update fmat.jobs set available_at=clock_timestamp() where payload->>'inboxId'=${q(confirmation)};`);
  assert.equal((await dispatchPhotonInputs(database,env,provider)).accepted,1);assert.equal(reads,beforeReplayReads,'Replaying a committed confirmation performs no provider read');
  assert.match(await reply(confirmation),/^Saved the settings from setup review /u);
  assert.equal((await setup.read(credential)).draft?.settings.rules?.bufferMinutes,25);
  assert.equal((await setup.read(credential)).confirmed.rules?.bufferMinutes,20);
  assert.deepEqual(await setup.readiness(credential),{ready:false,reason:'setup'},'A newer unconfirmed browser draft prevents a completed-onboarding claim');
  assert.equal((await dispatchPhotonInputs(database,env,provider)).accepted,1);assert.match(await reply(later),/exact "confirm setup <reference>"/u);
  await drain();
  // A lost claim response recovers the same input after lease expiry without a
  // second quota charge, reference, publication or model invocation.
  const restartInput=await enqueue('review setup');let claimLost=false;
  const lostClaim=new Database(env,async(url,options)=>{const response=await fetch(url,options);if(!claimLost&&String(url).endsWith('/fmat_photon_dispatch')&&response.ok){claimLost=true;await response.arrayBuffer();throw new Error('Synthetic lost claim');}return response;});
  await assert.rejects(dispatchPhotonInputs(lostClaim,env,provider));
  const used=await sql.query(`select minute_used from fmat.conversation_budgets where name=${q('host:'+host)};`);
  await sql.query(`update fmat.jobs set lease_until=clock_timestamp()-interval '1 second' where payload->>'inboxId'=${q(restartInput)};`);
  assert.equal((await dispatchPhotonInputs(database,env,provider)).accepted,1);
  assert.equal(await sql.query(`select minute_used from fmat.conversation_budgets where name=${q('host:'+host)};`),used);
  assert.equal(await sql.query(`select count(*) from fmat.photon_replies where inbox_id=${q(restartInput)};`),'1');await drain();
  // Oversized reviews give browser continuation, never a partial confirmable
  // summary, despite a complete and otherwise valid draft.
  state=await setup.read(credential);await setup.draft(credential,{expectedRevision:state.revision,idempotencyKey:randomUUID(),patch:{rules:{preferences:'Long preference '.repeat(250)}},unresolved:[]});
  const oversized=await turn('review setup');assert.match(oversized.text,/Open your host workspace/u);assert.doesNotMatch(oversized.text,/confirm setup [0-9a-f-]{36}/u);
  assert.equal(await sql.query(`select count(*) from fmat.photon_setup_review_publications p join fmat.photon_setup_reviews r on r.id=p.review_id where r.inbox_id=${q(oversized.id)};`),'0');await drain();
  assert.equal(await modelCount(),beforeModels,'Deterministic setup commands never invoke actual eve model');
  assert.equal(await sql.query(`select count(*) from fmat.runtime_messages where id in(select runtime_message_id from fmat.photon_inbox where id in(${owned.slice(1).map(q).join(',')}));`),'0');
  assert.equal(await sql.query(`select count(*) from fmat.photon_setup_confirmations where inbox_id=${q(confirmation)};`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.host_approvals where host_id=${q(host)};`),'0');
 }finally{
  await sql.query(`update fmat.photon_links set selected_request_id=null where host_id=${q(host)};delete from fmat.photon_setup_confirmations where review_id in(select id from fmat.photon_setup_reviews where host_id=${q(host)});delete from fmat.photon_setup_permission_checks where review_id in(select id from fmat.photon_setup_reviews where host_id=${q(host)});delete from fmat.photon_setup_review_publications where review_id in(select id from fmat.photon_setup_reviews where host_id=${q(host)});delete from fmat.photon_setup_reviews where host_id=${q(host)};delete from fmat.photon_setup_dispatches where inbox_id in(select id from fmat.photon_inbox where project_id=${q(env.PHOTON_PROJECT_ID!)});`);
  await consent.disconnect(credential);
  await sql.query(`delete from fmat.oauth_exchanges where actor->>'id'=${q(host)};delete from fmat.calendar_connections where principal_kind='host' and principal_id=${q(host)};`);
 }
}

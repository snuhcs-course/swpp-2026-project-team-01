import {verifySchedulingDst} from './scheduling-dst.ts';
import {generateKeyPair,exportJWK} from 'jose';
import {AgentOAuthTokens,type AgentTokenGrant} from '../../lib/server/oauth/tokens.ts';
import {AgentCredentials} from '../../lib/server/oauth/credentials.ts';
import {AgentOperations} from '../../lib/server/oauth/operations.ts';
import {agentMcpHttp} from '../../lib/server/mcp/http.ts';
import {RequestReview} from '../../lib/server/identity/request-review.ts';
import {BookingReceipt} from '../../lib/server/booking/receipt.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {PrivateReview} from '../../lib/server/scheduling/private-review.ts';
import {SchedulingPublication} from '../../lib/server/scheduling/publication.ts';
import {CandidateRanking,type RankingInput} from '../../lib/server/scheduling/ranking.ts';
import {PreferenceDecisions} from '../../lib/server/scheduling/preference-decisions.ts';
import {TravelAllowances} from '../../lib/server/scheduling/allowances.ts';
import {AvailabilityEvaluation} from '../../lib/server/scheduling/availability.ts';
import {RequesterAvailability} from '../../lib/server/calendar/requester-availability.ts';
import {calendarScopes} from '../../lib/server/calendar/google.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {Database} from '../../lib/server/database/client.ts';
import {guestCredential,verifyHostToken,type Credential} from '../../lib/server/identity/credentials.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';
import {verifySchedulingStartCutoff} from './scheduling-start-cutoff.ts';
import {verifyRankingBudget} from './model-ranking.ts';
import {routeFingerprint} from '../../lib/server/routes/google.ts';
import type {RouteRequest} from '../../lib/contracts/travel.ts';
import type {TravelCommitment} from '../../lib/server/calendar/adjacent.ts';
const code=(value:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===value;

test('Authorized availability joins both calendars, pauses failures, and fences edits, revocation, competing reads and current accounts',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const env={...process.env,APP_ORIGIN:'http://localhost:3000',SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
 const headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 const sql=new LocalSql(),email=randomUUID()+'@example.test',password=randomUUID()+randomUUID(),invite=randomUUID(),requestId=randomUUID(),otherRequest=randomUUID(),farRequest=randomUUID(),token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
 const credential=guestCredential(requestId,token),database=new Database(env),cipher=new TokenCipher(env);let host='',hostCredential:Credential,authToken='';
 const day=new Date(Date.now()+2*86400000).toISOString().slice(0,10),at=(time:string)=>day+'T'+time+':00.000Z';
 const windows=[{start:at('10:00'),end:at('12:00')}],details={requesterName:'Fixture',requesterEmail:'requester@example.test',purpose:'Fixture',durationMinutes:30,timezone:'UTC',windows,mode:'online',location:''};
 const rules={timezone:'UTC',availability:[{days:[0,1,2,3,4,5,6],start:'00:00',end:'23:59'}],focusBlocks:[],bufferMinutes:10,durationMinutes:30,preferences:'Private host preference',travelMode:'NONE',meetingMode:'online',locationPolicy:'per_meeting',locations:[],travelBufferMinutes:0};
 let hostBusyOverride:{start:string;end:string}[]|null=null;
 const calls:{party:string;ids:string[];windows:unknown}[]=[];let failure:'host'|'guest'|null=null,refreshes=0,gate:()=>Promise<void>=async()=>{},gatedParty:'host'|'guest'='host';
 let eventGate=async()=>{},routeGate=async()=>{},saveGate=async()=>{},allowanceGate=async()=>{},publicationGate=async()=>{},eventFailure=false,routeUnavailable=false,inboundSeconds=600,outboundSeconds=600,eventReads=0;
 const originalRpc=database.rpc.bind(database);database.rpc=async(name,parameters)=>{if(name==='fmat_scheduling'&&parameters.p_operation==='publish')await publicationGate();if(name==='fmat_availability_evaluation'&&parameters.p_operation==='evidence_save')await saveGate();if(name==='fmat_travel_allowance'&&parameters.p_operation==='confirm')await allowanceGate();return originalRpc(name,parameters);};
 const routeCalls:RouteRequest[]=[],candidate={start:at('11:00'),end:at('11:30')};
 const commitment=(id:string,start:string,end:string):TravelCommitment=>({id,calendarId:'host-calendar',eventId:id,version:'v1',interval:{start:at(start),end:at(end)},location:{address:id}});
 let neighbors=[commitment('previous','10:00','10:30'),commitment('next','12:10','12:30')];
 const service=new AvailabilityEvaluation(database,env,{async refresh(bundle){refreshes++;return {...bundle,expiresAt:Date.now()+3600000};},async list(){return [];}},{async read(access,ids,ranges){
  const party=access==='host-access'?'host':'guest';calls.push({party,ids,windows:ranges});if(party===gatedParty)await gate();if(failure===party)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  return party==='host'?(hostBusyOverride??[{start:at('10:00'),end:at('10:30')}]):[{start:at('11:00'),end:at('11:30')}];
 }},{async read(access,ids,_candidate,assertCurrent){eventReads++;assert.equal(access,'host-access');assert.deepEqual(ids,['host-calendar']);await assertCurrent();await eventGate();if(eventFailure)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);return structuredClone(neighbors);}},{async estimate(request){routeCalls.push(request);await routeGate();if(routeUnavailable)return {status:'no_route',fingerprint:routeFingerprint(request),checkedAt:new Date().toISOString()};return {status:'success',fingerprint:routeFingerprint(request),checkedAt:new Date().toISOString(),departureTime:request.departureTime,durationNanoseconds:(BigInt('address' in request.origin&&request.origin.address==='previous'?inboundSeconds:outboundSeconds)*1000000000n).toString(),distanceMeters:500};}});
 const manual=new RequesterAvailability(database,env);
 const revision=async()=>Number(await sql.query(`select revision from fmat.requests where id='${requestId}';`));
 const check=async(actor=credential)=>service.read(actor,{requestId,revision:await revision()});
 const flags=()=>sql.query(`select host_availability_failed||','||availability_failed from fmat.requests where id='${requestId}';`);
 const bundle=(kind:'host'|'guest')=>({accessToken:kind+'-access',refreshToken:kind+'-refresh',subject:'fixture-'+kind,expiresAt:1,scopes:[...calendarScopes[kind]]});
 let testError:unknown;
 let agentClient:string|undefined,agentGrant='';
 let guestEncrypted='';
 const reconnect=async()=>{await sql.query(`update fmat.requests set availability_mode='calendar',revision=revision+1 where id='${requestId}';update fmat.calendar_connections set revoked_at=null,encrypted_credential='${guestEncrypted}',generation=gen_random_uuid(),selected_calendar_ids=array['guest-calendar'] where principal_id='${requestId}';`);};
 async function paused(mutate:()=>Promise<unknown>,expected='STALE_REVISION',actor=credential){
  let release!:()=>void,entered!:()=>void;const arrived=new Promise<void>(r=>entered=r),waiting=new Promise<void>(r=>release=r);gate=async()=>{entered();await waiting;};
  const pending=check(actor),rejected=assert.rejects(pending,code(expected));
  await Promise.race([arrived,rejected.then(()=>{throw new Error('Evaluation ended before its provider gate');})]);
  try{await mutate();}finally{release();}await rejected;gate=async()=>{};
 }
 try{
  const create=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(create.status,200);host=(await create.json()).id;
  const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);authToken=(await login.json()).access_token;hostCredential=await verifyHostToken(authToken,{env});
  guestEncrypted=cipher.seal(bundle('guest'),'google:guest:'+requestId);const hostEncrypted=cipher.seal(bundle('host'),'google:host:'+host);
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invite}','${email}','${createHash('sha256').update(invite).digest('hex')}',now()+interval '1 day','availability-evaluation-test');insert into fmat.hosts(id,email,invitation_id,handle,display_name,rules,rules_version,conflict_calendar_ids,booking_calendar_id) values('${host}','${email}','${invite}','eval-${host.slice(0,8)}','Fixture','${JSON.stringify(rules)}',1,array['host-calendar'],'booking');insert into fmat.requests(id,host_id,details,token_hash,expires_at,availability_mode) values('${requestId}','${host}','${JSON.stringify(details)}','${hash}',now()+interval '3 days','calendar');insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential,guest_authority_key,selected_calendar_ids) values('host','${host}','fixture-host',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],'${hostEncrypted}',null,'{}'),('guest','${requestId}','fixture-guest',array['https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.calendarlist.readonly'],'${guestEncrypted}','${hash}',array['guest-calendar']);`);
  assert.equal(await sql.query(`select has_function_privilege('anon','public.fmat_availability_evaluation(text,jsonb,jsonb)','EXECUTE')||','||has_function_privilege('authenticated','public.fmat_availability_evaluation(text,jsonb,jsonb)','EXECUTE')||','||has_function_privilege('service_role','public.fmat_availability_evaluation(text,jsonb,jsonb)','EXECUTE');`),'false,false,true');
  const evaluated=await check();assert.equal(refreshes,2);assert.equal(evaluated.evaluation.status,'ready');assert.deepEqual(evaluated.evaluation.windows,[{start:day+'T11:30:00Z',end:day+'T12:00:00Z'}]);
  assert.deepEqual(calls[0],{party:'host',ids:['host-calendar'],windows:[{start:at('09:50'),end:at('12:10')}]});assert.deepEqual(calls[1],{party:'guest',ids:['guest-calendar'],windows});
  const receipt=await service.check(hostCredential,{requestId,revision:1});assert.deepEqual(Object.keys(receipt).sort(),['checked','checkedAt','complete','revision']);assert.equal(receipt.complete,false);assert.ok(!JSON.stringify(receipt).includes('calendar'));
  const before=calls.length;await assert.rejects(service.check(guestCredential(randomUUID(),token),{requestId,revision:1}),code('NOT_FOUND'));await assert.rejects(service.check(guestCredential(requestId,randomBytes(32).toString('base64url')),{requestId,revision:1}),code('NOT_FOUND'));await assert.rejects(service.check({...credential} as Credential,{requestId,revision:1}),code('UNAUTHORIZED'));assert.equal(calls.length,before);
  failure='guest';await assert.rejects(check(),code('PROVIDER_UNAVAILABLE'));assert.equal(await flags(),'false,true');assert.equal(await revision(),2);assert.equal(await sql.query(`select candidates='[]' and current_proposal_version is null and evaluated_at is null from fmat.requests where id='${requestId}';`),'t');
  await manual.manual(credential,{revision:await revision(),confirmed:true,timezone:'UTC',windows});const readCount=calls.length;
  failure=null;await check();assert.equal(await flags(),'false,false');assert.equal(calls.length,readCount+1,'Explicit manual replacement reads only the host Calendar');await reconnect();
  failure='host';await assert.rejects(check(),code('PROVIDER_UNAVAILABLE'));assert.equal(await flags(),'true,false');
  await manual.manual(credential,{revision:await revision(),confirmed:true,timezone:'UTC',windows});assert.equal(await flags(),'true,false','Manual requester replacement cannot clear a host failure');
  await assert.rejects(database.rpc('fmat_command',{p_operation:'candidates_save',p_actor:{kind:'worker',id:'test'},p_input:{requestId,expectedRevision:await revision(),rulesVersion:1,candidates:[]}}),code('FORBIDDEN'));
  failure=null;const manualResult=await check();assert.equal(await flags(),'false,false');assert.deepEqual(manualResult.evaluation.windows,[{start:day+'T10:40:00Z',end:day+'T12:00:00Z'}]);
  // This is the actual authorized request evaluator with private neighboring
  // events, not a separately constructed pure travel fixture.
  await sql.query(`update fmat.requests set details=jsonb_set(jsonb_set(details,'{mode}','"in_person"'),'{location}','"Meeting venue"'),revision=revision+1 where id='${requestId}';update fmat.hosts set rules=rules||'{"travelMode":"DRIVE","travelBufferMinutes":5}',rules_version=rules_version+1 where id='${host}';`);
  const physical=async()=>service.read(credential,{requestId,revision:await revision(),candidate});
  const fits=await physical();assert.equal(fits.candidateEvaluation?.interval,'fits');assert.equal(fits.candidateEvaluation?.travel?.status,'fits');assert.equal(routeCalls.length,2);assert.deepEqual(routeCalls.map(r=>r.departureTime).sort(),[day+'T10:40:00Z',day+'T11:40:00Z']);
  assert.equal(fits.persisted?.status,'clarification');assert.equal(fits.persisted?.complete,false);
  const savedInput={...fits.context,rulesVersion:fits.rulesVersion,evidence:{candidate,...fits.candidateEvaluation,complete:false}};
  const retries=await Promise.all(Array.from({length:8},()=>database.rpc('fmat_availability_evaluation',{p_operation:'evidence_save',p_credential:credential,p_input:savedInput}))) as {evaluationId:string}[];
  assert.ok(retries.every(r=>r.evaluationId===fits.persisted!.evaluationId));
  assert.equal(await sql.query(`select count(*) from fmat.candidate_evaluations where check_id='${fits.context.checkId}';`),'1','Concurrent retries retain one immutable evidence row');
  assert.equal(await sql.query(`select has_table_privilege('anon','fmat.candidate_evaluations','SELECT')||','||has_table_privilege('authenticated','fmat.candidate_evaluations','SELECT')||','||(select relrowsecurity from pg_class where oid='fmat.candidate_evaluations'::regclass);`),'false,false,true');
  await sql.query(`do $$ begin update fmat.candidate_evaluations set status='clarification' where id='${fits.persisted!.evaluationId}';raise exception 'fixture mutable evidence';exception when raise_exception then if sqlerrm<>'IMMUTABLE_EVALUATION' then raise;end if;end $$;`);
  assert.equal(await sql.query(`select evidence->'preferences'->>'status'='requires_confirmation' and evidence->>'complete'='false' and private_context->'rules'->>'preferences'='Private host preference' and not(private_context::text like '%host-access%' or private_context::text like '%encryptedCredential%') from fmat.candidate_evaluations where id='${fits.persisted!.evaluationId}';`),'t');
  const evidenceTarget={requestId,revision:await revision(),evaluationId:fits.persisted!.evaluationId};
  assert.deepEqual(await service.evidence(credential,evidenceTarget),fits.persisted);assert.deepEqual(await service.evidence(hostCredential,evidenceTarget),fits.persisted);
  assert.ok(!JSON.stringify(await service.evidence(credential,evidenceTarget)).includes('previous'));
  await assert.rejects(database.rpc('fmat_availability_evaluation',{p_operation:'evidence_save',p_credential:credential,p_input:{...savedInput,evidence:{...savedInput.evidence,complete:true}}}),code('INVALID_INPUT'));
  await assert.rejects(database.rpc('fmat_availability_evaluation',{p_operation:'evidence_save',p_credential:credential,p_input:{...savedInput,evidence:{...savedInput.evidence,contextFingerprint:'b'.repeat(64)}}}),code('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(service.evidence(guestCredential(randomUUID(),token),evidenceTarget),code('NOT_FOUND'));
  await assert.rejects(service.evidence(guestCredential(requestId,randomBytes(32).toString('base64url')),evidenceTarget),code('NOT_FOUND'));
  // Expiry and authority are checked for reads and retries, not just the initial save.
  const started=await sql.query(`select availability_check_started_at from fmat.requests where id='${requestId}';`);
  await sql.query(`update fmat.requests set availability_check_started_at=now()-interval '6 minutes' where id='${requestId}';`);
  await assert.rejects(service.evidence(credential,evidenceTarget),code('STALE_REVISION'));
  await assert.rejects(database.rpc('fmat_availability_evaluation',{p_operation:'evidence_save',p_credential:credential,p_input:savedInput}),code('STALE_REVISION'));
  await sql.query(`update fmat.requests set availability_check_started_at='${started}',token_revoked_at=now() where id='${requestId}';`);
  await assert.rejects(service.evidence(credential,evidenceTarget),code('NOT_FOUND'));
  await assert.rejects(database.rpc('fmat_availability_evaluation',{p_operation:'evidence_save',p_credential:credential,p_input:savedInput}),code('NOT_FOUND'));
  await sql.query(`update fmat.requests set token_revoked_at=null where id='${requestId}';update fmat.hosts set rules_version=rules_version+1 where id='${host}';`);
  await assert.rejects(service.evidence(credential,evidenceTarget),code('STALE_REVISION'));
  await sql.query(`update fmat.hosts set rules_version=rules_version-1 where id='${host}';`);
  const privateReceipt=await service.check(credential,{requestId,revision:await revision(),candidate});assert.deepEqual(Object.keys(privateReceipt).sort(),['checked','checkedAt','complete','revision']);assert.equal(privateReceipt.complete,false);
  await assert.rejects(service.evidence(credential,evidenceTarget),code('STALE_REVISION'),'A newer read supersedes old evidence even without a request edit');
  await assert.rejects(database.rpc('fmat_availability_evaluation',{p_operation:'evidence_save',p_credential:credential,p_input:savedInput}),code('STALE_REVISION'));
  inboundSeconds=1501;assert.equal((await physical()).candidateEvaluation?.travel?.legs[0].status,'conflict');inboundSeconds=600;outboundSeconds=1501;assert.equal((await physical()).candidateEvaluation?.travel?.legs[1].status,'conflict');outboundSeconds=600;
  const firstContext=fits.candidateEvaluation?.contextFingerprint;neighbors[0].version='v2';assert.notEqual((await physical()).candidateEvaluation?.contextFingerprint,firstContext);assert.equal(routeCalls.length,10,'Changed provider context causes fresh route calls');
  const retained=neighbors;neighbors=[];assert.equal((await physical()).candidateEvaluation?.travel?.status,'clarification');neighbors=retained;
  async function pausedTravel(stage:'events'|'routes'|'save',mutate:()=>Promise<unknown>,expected='STALE_REVISION'){
   let entered!:()=>void,release!:()=>void;const arrived=new Promise<void>(r=>entered=r),waiting=new Promise<void>(r=>release=r);const wait=async()=>{entered();await waiting;};if(stage==='events')eventGate=wait;else if(stage==='routes')routeGate=wait;else saveGate=wait;
   const rejected=assert.rejects(physical(),code(expected));await arrived;try{await mutate();}finally{release();}await rejected;eventGate=async()=>{};routeGate=async()=>{};saveGate=async()=>{};
  }
  await pausedTravel('events',()=>sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${host}';`));
  await pausedTravel('routes',()=>sql.query(`update fmat.requests set revision=revision+1 where id='${requestId}';`));
  await pausedTravel('routes',()=>sql.query(`update fmat.calendar_connections set generation=gen_random_uuid() where principal_id='${host}';`));
  await pausedTravel('events',()=>sql.query(`update fmat.requests set token_revoked_at=now() where id='${requestId}';`),'NOT_FOUND');await sql.query(`update fmat.requests set token_revoked_at=null where id='${requestId}';`);
  eventFailure=true;await assert.rejects(physical(),code('PROVIDER_UNAVAILABLE'));assert.equal(await flags(),'true,false');eventFailure=false;await physical();assert.equal(await flags(),'false,false');
  await pausedTravel('save',()=>sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${host}';`));
  await pausedTravel('save',()=>sql.query(`update fmat.requests set revision=revision+1 where id='${requestId}';`));
  await pausedTravel('save',()=>sql.query(`update fmat.requests set availability_check_started_at=now()-interval '6 minutes' where id='${requestId}';`));
  await pausedTravel('save',()=>sql.query(`update fmat.requests set token_revoked_at=now() where id='${requestId}';`),'NOT_FOUND');await sql.query(`update fmat.requests set token_revoked_at=null where id='${requestId}';`);
  await pausedTravel('save',()=>sql.query(`update fmat.requests set private_scheduling_context='{"physicalContext":[]}' where id='${requestId}';`));
  assert.equal(await sql.query(`select count(*) from fmat.candidate_evaluations where request_id='${requestId}' and check_id=(select availability_check_id from fmat.requests where id='${requestId}');`),'0','Changed context after successful reads rejects asynchronous persistence');
  const allowances=new TravelAllowances(database);routeUnavailable=true;
  const unresolved=await physical();assert.equal(unresolved.candidateEvaluation?.travel?.status,'clarification');
  const confirmation={requestId,revision:await revision(),evaluationId:unresolved.persisted!.evaluationId,confirmed:true as const,idempotencyKey:randomUUID(),allowance:{direction:'inbound' as const,durationMinutes:10,mode:'DRIVE' as const,boundary:{at:at('10:30'),location:{address:'previous'}},reason:'Private host estimate'}};
  await assert.rejects(allowances.confirm(credential,confirmation),code('FORBIDDEN'));
  await assert.rejects(allowances.confirm({...hostCredential},confirmation),code('UNAUTHORIZED'));
  await assert.rejects(allowances.confirm(hostCredential,{...confirmation,allowance:{...confirmation.allowance,boundary:{...confirmation.allowance.boundary,at:at('09:00')}}}),code('INVALID_INPUT'));
  const confirmed=await Promise.all(Array.from({length:8},()=>allowances.confirm(hostCredential,confirmation)));assert.ok(confirmed.every(v=>v.allowanceId===confirmed[0].allowanceId));assert.equal(await revision(),confirmation.revision+1);
  assert.equal(await sql.query(`select count(*) from fmat.travel_allowances where request_id='${requestId}';`),'1');
  assert.equal(await sql.query(`select has_table_privilege('anon','fmat.travel_allowances','SELECT')||','||has_table_privilege('authenticated','fmat.travel_allowances','SELECT')||','||has_function_privilege('authenticated','public.fmat_travel_allowance(text,jsonb,jsonb)','EXECUTE');`),'false,false,false');
  await sql.query(`do $$ begin update fmat.travel_allowances set value='{}' where request_id='${requestId}';raise exception 'fixture mutable allowance';exception when raise_exception then if sqlerrm<>'IMMUTABLE_ALLOWANCE' then raise;end if;end $$;`);
  const inboundManual=await physical();assert.equal(inboundManual.candidateEvaluation?.travel?.legs[0].manualAllowanceId,confirmed[0].allowanceId);assert.equal(inboundManual.candidateEvaluation?.travel?.legs[1].status,'clarification');
  const outgoing={...confirmation,revision:await revision(),evaluationId:inboundManual.persisted!.evaluationId,idempotencyKey:randomUUID(),allowance:{...confirmation.allowance,direction:'outbound' as const,boundary:{at:at('12:10'),location:{address:'next'}}}};
  const outboundConfirmed=await allowances.confirm(hostCredential,outgoing);const bothManual=await physical();assert.equal(bothManual.candidateEvaluation?.travel?.status,'fits');assert.ok(bothManual.candidateEvaluation?.travel?.legs.every(l=>l.manualAllowanceId));
  const guestView=await database.rpc('fmat_browser_command',{p_operation:'guest_state',p_credential:credential,p_input:{}});assert.ok(!JSON.stringify(guestView).includes('Private host estimate'));assert.ok(!JSON.stringify(guestView).includes(outboundConfirmed.allowanceId));
  // A provider event version edit invalidates both host decisions even when
  // all meeting details and the request revision remain unchanged.
  neighbors[0].version='v3';const changedNeighbor=await physical();assert.equal(changedNeighbor.candidateEvaluation?.travel?.status,'clarification');assert.ok(changedNeighbor.candidateEvaluation?.travel?.legs.every(l=>!l.manualAllowanceId));
  const revoke={requestId,revision:await revision(),allowanceId:confirmed[0].allowanceId,idempotencyKey:randomUUID()};const revoked=await allowances.revoke(hostCredential,revoke);assert.equal(revoked.revoked,true);assert.deepEqual(await allowances.revoke(hostCredential,revoke),revoked);
  await assert.rejects(allowances.confirm(hostCredential,confirmation),code('STALE_REVISION'));
  const racingEvidence=await physical(),racingInput={...confirmation,revision:await revision(),evaluationId:racingEvidence.persisted!.evaluationId,idempotencyKey:randomUUID()};
  let enteredAllowance!:()=>void,releaseAllowance!:()=>void;const arrivedAllowance=new Promise<void>(r=>enteredAllowance=r),waitingAllowance=new Promise<void>(r=>releaseAllowance=r);allowanceGate=async()=>{enteredAllowance();await waitingAllowance;};
  const staleAllowance=assert.rejects(allowances.confirm(hostCredential,racingInput),code('STALE_REVISION'));await arrivedAllowance;await sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${host}';`);releaseAllowance();await staleAllowance;allowanceGate=async()=>{};
  assert.equal(await sql.query(`select count(*) from fmat.travel_allowances where request_id='${requestId}';`),'2','Stale confirmation creates no allowance');
  await assert.rejects(database.rpc('fmat_travel_allowance',{p_operation:'confirm',p_credential:{kind:'worker',id:'model'},p_input:racingInput}),code('FORBIDDEN'));
  const savedNeighbors=neighbors;hostBusyOverride=[];
  neighbors=[{...commitment('past','08:00','09:00'),interval:{start:new Date(Date.now()-7200000).toISOString(),end:new Date(Date.now()-3600000).toISOString()}},commitment('next','12:10','12:30')];
  const pastOriginEvidence=await physical();assert.equal(pastOriginEvidence.candidateEvaluation?.travel?.legs[0].reason,'departure_context');
  const currentOriginInput={...confirmation,revision:await revision(),evaluationId:pastOriginEvidence.persisted!.evaluationId,idempotencyKey:randomUUID(),allowance:{...confirmation.allowance,boundary:{at:new Date(Date.now()+300000).toISOString(),location:{address:'Explicit current origin'}}}};
  const currentOriginDecision=await allowances.confirm(hostCredential,currentOriginInput);const currentOriginFit=await physical();assert.equal(currentOriginFit.candidateEvaluation?.travel?.legs[0].manualAllowanceId,currentOriginDecision.allowanceId);assert.deepEqual(currentOriginFit.candidateEvaluation?.travel?.legs[0].request?.origin,{address:'Explicit current origin'});
  hostBusyOverride=null;neighbors=savedNeighbors;
  routeUnavailable=false;
  const previousReads=eventReads;const invalid=await service.read(credential,{requestId,revision:await revision(),candidate:{start:at('10:00'),end:at('10:30')}});assert.equal(invalid.candidateEvaluation?.interval,'conflict');assert.equal(eventReads,previousReads);
  await assert.rejects(allowances.confirm(hostCredential,{...confirmation,revision:await revision(),evaluationId:invalid.persisted!.evaluationId,idempotencyKey:randomUUID()}),code('INVALID_INPUT'));
  await sql.query(`update fmat.requests set details=jsonb_set(jsonb_set(details,'{mode}','"online"'),'{location}','""'),revision=revision+1 where id='${requestId}';update fmat.hosts set rules=rules||'{"travelMode":"NONE","travelBufferMinutes":0}',rules_version=rules_version+1 where id='${host}';`);
  assert.equal((await physical()).candidateEvaluation?.travel?.status,'fits');assert.equal(eventReads,previousReads,'Online candidates do not read private event locations');
  assert.equal(await sql.query(`select candidates='[]' and current_proposal_version is null from fmat.requests where id='${requestId}';`),'t');
  const preferences=new PreferenceDecisions(database),preferenceEvidence=await physical();
  assert.equal(preferenceEvidence.candidateEvaluation?.preferences?.status,'requires_confirmation');assert.equal(preferenceEvidence.persisted?.status,'clarification');
  const preferenceInput={requestId,revision:await revision(),evaluationId:preferenceEvidence.persisted!.evaluationId,confirmed:true as const,idempotencyKey:randomUUID(),choice:{key:'additional' as const,classification:'preference' as const,decision:'exception' as const,reason:'Private exception reason'}};
  await assert.rejects(preferences.confirm(credential,preferenceInput),code('FORBIDDEN'));
  await assert.rejects(preferences.confirm({...hostCredential},preferenceInput),code('UNAUTHORIZED'));
  await assert.rejects(database.rpc('fmat_preference_decision',{p_operation:'confirm',p_credential:{kind:'worker',id:'model'},p_input:preferenceInput}),code('FORBIDDEN'));
  await assert.rejects(database.rpc('fmat_preference_decision',{p_operation:'confirm',p_credential:hostCredential,p_input:{...preferenceInput,choice:{...preferenceInput.choice,key:'busy'}}}),code('INVALID_INPUT'));
  const preferenceReplies=await Promise.all(Array.from({length:8},()=>preferences.confirm(hostCredential,preferenceInput)));assert.ok(preferenceReplies.every(r=>r.decisionId===preferenceReplies[0].decisionId));assert.equal(await revision(),preferenceInput.revision+1);
  assert.equal(await sql.query(`select count(*) from fmat.preference_decisions where request_id='${requestId}';`),'1');
  assert.equal(await sql.query(`select has_table_privilege('anon','fmat.preference_decisions','SELECT')||','||has_table_privilege('authenticated','fmat.preference_decisions','SELECT')||','||has_function_privilege('authenticated','public.fmat_preference_decision(text,jsonb,jsonb)','EXECUTE');`),'false,false,false');
  await sql.query(`do $$ begin update fmat.preference_decisions set value='{}' where request_id='${requestId}';raise exception 'fixture mutable preference';exception when raise_exception then if sqlerrm<>'IMMUTABLE_PREFERENCE' then raise;end if;end $$;`);
  const preferenceFit=await physical();assert.equal(preferenceFit.candidateEvaluation?.preferences?.status,'satisfied');assert.equal(preferenceFit.persisted?.status,'checks_passed');assert.equal(preferenceFit.persisted?.complete,false);
  const preferenceGuestView=await database.rpc('fmat_browser_command',{p_operation:'guest_state',p_credential:credential,p_input:{}});assert.ok(!JSON.stringify(preferenceGuestView).includes('Private exception reason'));assert.ok(!JSON.stringify(preferenceGuestView).includes(preferenceReplies[0].decisionId));
  const conflicting=await service.read(credential,{requestId,revision:await revision(),candidate:{start:at('10:00'),end:at('10:30')}});
  await assert.rejects(preferences.confirm(hostCredential,{...preferenceInput,revision:await revision(),evaluationId:conflicting.persisted!.evaluationId,idempotencyKey:randomUUID()}),code('INVALID_INPUT'));
  const revokeChoice={requestId,revision:await revision(),decisionId:preferenceReplies[0].decisionId,idempotencyKey:randomUUID()};const revokedChoice=await preferences.revoke(hostCredential,revokeChoice);assert.deepEqual(await preferences.revoke(hostCredential,revokeChoice),revokedChoice);assert.equal((await physical()).candidateEvaluation?.preferences?.status,'requires_confirmation');
  await assert.rejects(preferences.confirm(hostCredential,preferenceInput),code('STALE_REVISION'));
  const stalePreferenceEvidence=await physical();await sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${host}';`);
  await assert.rejects(preferences.confirm(hostCredential,{...preferenceInput,revision:await revision(),evaluationId:stalePreferenceEvidence.persisted!.evaluationId,idempotencyKey:randomUUID()}),code('STALE_REVISION'));
  await sql.query(`update fmat.requests set details=jsonb_set(jsonb_set(details,'{mode}','"in_person"'),'{location}','"Meeting venue"'),revision=revision+1 where id='${requestId}';update fmat.hosts set rules=rules||'{"travelMode":"DRIVE","locationPolicy":"preferred","locations":["Other venue"]}',rules_version=rules_version+1 where id='${host}';`);
  inboundSeconds=1501;const travelConflict=await physical();assert.equal(travelConflict.candidateEvaluation?.travel?.status,'conflict');
  await assert.rejects(preferences.confirm(hostCredential,{...preferenceInput,revision:await revision(),evaluationId:travelConflict.persisted!.evaluationId,idempotencyKey:randomUUID(),choice:{...preferenceInput.choice,key:'meeting_mode'}}),code('INVALID_INPUT'));inboundSeconds=600;
  for(const key of ['meeting_mode','location','additional'] as const){
   const source=await physical();assert.equal(source.candidateEvaluation?.preferences?.checks.find(c=>c.key===key)?.status,'unresolved');
   await preferences.confirm(hostCredential,{...preferenceInput,revision:await revision(),evaluationId:source.persisted!.evaluationId,idempotencyKey:randomUUID(),choice:{...preferenceInput.choice,key,decision:key==='additional'?'satisfied':'exception'}});
  }
  const allPreferences=await physical();assert.equal(allPreferences.candidateEvaluation?.preferences?.status,'satisfied');assert.equal(allPreferences.persisted?.status,'checks_passed');
  assert.equal(allPreferences.candidateEvaluation?.preferences?.checks.filter(c=>c.status==='exception').length,2);
  await sql.query(`update fmat.requests set details=jsonb_set(jsonb_set(details,'{mode}','"online"'),'{location}','""'),revision=revision+1 where id='${requestId}';update fmat.hosts set rules=rules||'{"travelMode":"NONE","locationPolicy":"per_meeting","locations":[]}',rules_version=rules_version+1 where id='${host}';`);
  assert.equal((await physical()).candidateEvaluation?.preferences?.status,'requires_confirmation','Changed details/rules invalidate earlier preference decisions');
  // One real Calendar acquisition feeds multiple exact assessments under one
  // superseding attempt. Only fully checked rows enter structured ranking.
  const batch=async()=>service.batch(credential,{requestId,revision:await revision(),sampling:{stepMinutes:15,limit:3}});
  const rankTarget=(b:Awaited<ReturnType<typeof batch>>)=>({requestId,revision:b.context.revision,checkId:b.context.checkId,basis:b.context.basis});
  let rankCalls=0,rankGate=async()=>{},rankResponse:(input:RankingInput)=>unknown=input=>({orderedIds:input.candidates.map(c=>c.id).reverse()});
  const ranker=new CandidateRanking(database,{async rank(input,reserve){await reserve();rankCalls++;assert.deepEqual(Object.keys(input).sort(),['candidates','timezone']);assert.ok(!JSON.stringify(input).includes('Private'));await rankGate();return rankResponse(input);}});
  const unresolvedBatch=await batch();assert.equal(unresolvedBatch.results.length,3);assert.equal(unresolvedBatch.truncated,true);
  assert.ok(unresolvedBatch.results.every(r=>r.persisted.status==='clarification'));
  const emptyRanking=await ranker.rank(credential,rankTarget(unresolvedBatch));assert.deepEqual(emptyRanking.orderedIds,[]);assert.equal(rankCalls,0,'Unresolved preferences never reach the model');
  await sql.query(`update fmat.hosts set rules=jsonb_set(rules,'{preferences}','""'),rules_version=rules_version+1 where id='${host}';`);
  await verifyRankingBudget(database,sql,credential,hostCredential,rankTarget(await batch()));
  const beforeBatchReads=calls.length,validBatch=await batch();assert.equal(calls.length,beforeBatchReads+1,'Batch shares the host free/busy read');assert.ok(validBatch.results.every(r=>r.persisted.status==='checks_passed'));
  const target=rankTarget(validBatch),ranked=await ranker.rank(credential,target);assert.equal(ranked.orderedIds.length,3);assert.equal(ranked.complete,false);assert.equal(rankCalls,1);
  assert.equal(await sql.query(`select attempts from fmat.model_work_attempts where name='ranking:${target.checkId}';`),'1');
  assert.deepEqual(await ranker.rank(credential,target),ranked);assert.equal(rankCalls,1,'Saved ranking retry performs no model call');
  assert.equal(await sql.query(`select attempts from fmat.model_work_attempts where name='ranking:${target.checkId}';`),'1','Saved ranking retry consumes no further allowance');
  const rankingSnapshot=await database.rpc('fmat_candidate_ranking',{p_operation:'read',p_credential:credential,p_input:target}) as {fingerprint:string};
  const rankSave={...target,fingerprint:rankingSnapshot.fingerprint,orderedIds:ranked.orderedIds};
  const rankRetries=await Promise.all(Array.from({length:8},()=>database.rpc('fmat_candidate_ranking',{p_operation:'save',p_credential:credential,p_input:rankSave})));assert.ok(rankRetries.every(r=>JSON.stringify(r)===JSON.stringify(rankRetries[0])));
  await assert.rejects(database.rpc('fmat_candidate_ranking',{p_operation:'save',p_credential:credential,p_input:{...rankSave,orderedIds:[...ranked.orderedIds].reverse()}}),code('IDEMPOTENCY_CONFLICT'));
  for(const orderedIds of [[ranked.orderedIds[0],ranked.orderedIds[0],ranked.orderedIds[0]],[randomUUID(),...ranked.orderedIds.slice(1)],[],[...ranked.orderedIds,randomUUID()]])await assert.rejects(database.rpc('fmat_candidate_ranking',{p_operation:'save',p_credential:credential,p_input:{...rankSave,orderedIds}}),code('INVALID_INPUT'));
  assert.equal(await sql.query(`select has_table_privilege('authenticated','fmat.candidate_rankings','SELECT')||','||has_function_privilege('anon','public.fmat_candidate_ranking(text,jsonb,jsonb)','EXECUTE')||','||has_function_privilege('authenticated','public.fmat_candidate_ranking(text,jsonb,jsonb)','EXECUTE');`),'false,false,false');
  await assert.rejects(ranker.rank({...credential},target),code('UNAUTHORIZED'));await assert.rejects(ranker.rank(guestCredential(requestId,randomBytes(32).toString('base64url')),target),code('NOT_FOUND'));
  await sql.query(`do $$ begin update fmat.candidate_rankings set ordered_ids='[]' where id='${ranked.rankingId}';raise exception 'fixture mutable ranking';exception when raise_exception then if sqlerrm<>'IMMUTABLE_EVALUATION' then raise;end if;end $$;`);
  assert.equal(await sql.query(`select candidates='[]' and current_proposal_version is null from fmat.requests where id='${requestId}';`),'t','Private ranking cannot publish a proposal');
  const malformedBatch=await batch();rankResponse=()=>({orderedIds:[randomUUID()]});await assert.rejects(ranker.rank(credential,rankTarget(malformedBatch)),code('PROVIDER_UNAVAILABLE'));assert.equal(await sql.query(`select count(*) from fmat.candidate_rankings where check_id='${malformedBatch.context.checkId}';`),'0');
  rankResponse=input=>({orderedIds:input.candidates.map(c=>c.id).reverse()});
  async function staleRank(mutate:()=>Promise<unknown>,expected='STALE_REVISION'){
   const source=await batch();let enter!:()=>void,release!:()=>void;const arrived=new Promise<void>(r=>enter=r),wait=new Promise<void>(r=>release=r);rankGate=async()=>{enter();await wait;};
   const rejected=assert.rejects(ranker.rank(credential,rankTarget(source)),code(expected));await arrived;try{await mutate();}finally{release();}await rejected;rankGate=async()=>{};
   assert.equal(await sql.query(`select count(*) from fmat.candidate_rankings where check_id='${source.context.checkId}';`),'0','Stale model result creates no ranking');
  }
  // Adding even excluded evidence changes the frozen set. A model reply
  // from the prior manifest must not replace it.
  const growingBatch=await batch(),growingTarget=rankTarget(growingBatch);
  const growingSnapshot=await database.rpc('fmat_candidate_ranking',{p_operation:'read',p_credential:credential,p_input:growingTarget}) as {fingerprint:string};
  const blockedCandidate={start:at('10:00'),end:at('10:30')};
  const excluded=await database.rpc('fmat_availability_evaluation',{p_operation:'evidence_save',p_credential:credential,p_input:{...growingTarget,candidate:blockedCandidate,rulesVersion:growingBatch.rulesVersion,evidence:{candidate:blockedCandidate,interval:'conflict',contextFingerprint:null,travel:null,preferences:'pending',complete:false}}}) as {evaluationId:string};
  await assert.rejects(database.rpc('fmat_candidate_ranking',{p_operation:'save',p_credential:credential,p_input:{...growingTarget,fingerprint:growingSnapshot.fingerprint,orderedIds:growingBatch.results.map(r=>r.persisted.evaluationId)}}),code('STALE_REVISION'));
  const afterGrowth=await database.rpc('fmat_candidate_ranking',{p_operation:'read',p_credential:credential,p_input:growingTarget}) as {fingerprint:string;input:RankingInput};assert.equal(afterGrowth.input.candidates.length,3);assert.ok(afterGrowth.input.candidates.every(c=>c.id!==excluded.evaluationId));
  await assert.rejects(database.rpc('fmat_candidate_ranking',{p_operation:'save',p_credential:credential,p_input:{...growingTarget,fingerprint:afterGrowth.fingerprint,orderedIds:[excluded.evaluationId,...afterGrowth.input.candidates.slice(1).map(c=>c.id)]}}),code('INVALID_INPUT'));
  await staleRank(()=>sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${host}';`));
  await staleRank(()=>sql.query(`update fmat.requests set revision=revision+1 where id='${requestId}';`));
  await staleRank(()=>sql.query(`update fmat.requests set availability_check_started_at=now()-interval '6 minutes' where id='${requestId}';`));
  await staleRank(()=>check());
  await staleRank(()=>sql.query(`update fmat.requests set token_revoked_at=now() where id='${requestId}';`),'NOT_FOUND');await sql.query(`update fmat.requests set token_revoked_at=null where id='${requestId}';`);
  await sql.query(`update fmat.requests set details=jsonb_set(details,'{location}','"https://meet.example.test/fixture"'),revision=revision+1 where id='${requestId}';`);
  agentClient=JSON.parse(await sql.query(`select public.fmat_oauth_register('Candidate read fixture',array['http://127.0.0.1:55778/callback'],'http://localhost:3000/mcp');`)).clientId;
  const agentAuthorization=JSON.parse(await sql.query(`select public.fmat_oauth_authorization_start('${JSON.stringify({clientId:agentClient,resource:'http://localhost:3000/mcp',redirectUri:'http://127.0.0.1:55778/callback',scope:'request:decide request:read request:write',codeChallenge:'A'.repeat(43),codeChallengeMethod:'S256',state:'candidate-review',browserHash:'a'.repeat(64)})}');`)).authorizationId;
  assert.match(agentAuthorization,/^[a-f0-9-]{36}$/u);
  await sql.query(`select public.fmat_oauth_consent('${agentAuthorization}','${'a'.repeat(64)}','${JSON.stringify(credential)}','grant','${createHash('sha256').update(randomUUID()).digest('hex')}');`);
  agentGrant=await sql.query(`select id from fmat.oauth_grants where authorization_id='${agentAuthorization}';`);
  const pair=await generateKeyPair('ES256',{extractable:true}),agentEnv={...env,AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'request-workflow'})};
  const grant=JSON.parse(await sql.query(`select fmat.oauth_grant_projection(g) from fmat.oauth_grants g where id='${agentGrant}';`)) as AgentTokenGrant;
  const access=await new AgentOAuthTokens(agentEnv).issue(grant,async()=>{}),mcp=agentMcpHttp(agentEnv,new AgentCredentials(agentEnv,database),new AgentOperations(database));
  const invoke=(name:string,args:unknown={requestId,input:{}})=>mcp(new Request(env.APP_ORIGIN+'/mcp',{method:'POST',headers:{authorization:'Bearer '+access,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}));
  async function agentTool(name:string,args:unknown={requestId,input:{}}){const response=await invoke(name,args);assert.equal(response.status,200);const body=await response.json();assert.equal(body.result?.isError,undefined,JSON.stringify(body));assert.ok(body.result?.structuredContent);assert.doesNotMatch(JSON.stringify(body),/Private host preference|encryptedCredential|host-calendar|guest-calendar/);return body.result.structuredContent.result;}
  const agentRead=()=>agentTool('fmat_get_scheduling');
  const reviewService=new RequestReview(database),beforeDraft=await revision(),availabilityArgs={requestId,input:{expectedRevision:beforeDraft,timezone:'UTC',windows},idempotencyKey:randomUUID()};
  const pendingAvailability=await agentTool('fmat_propose_availability',availabilityArgs);
  assert.deepEqual(await agentTool('fmat_propose_availability',availabilityArgs),pendingAvailability);assert.equal(await revision(),beforeDraft);
  const review=await reviewService.read(credential);assert.equal(review.review?.status,'pending');
  await reviewService.decide('apply',credential,{reviewId:review.review!.id,expectedRevision:beforeDraft,confirmed:true,idempotencyKey:randomUUID()});
  assert.equal((await agentTool('fmat_get_availability')).revision,await revision());
  assert.equal((await agentTool('fmat_review_connections')).path,'/booking/'+requestId);
  assert.equal(await sql.query(`select current_proposal_version is null and host_approved_version is null from fmat.requests where id='${requestId}';`),'t');
  const publication=new SchedulingPublication(database,service,ranker);
  const published=await publication.evaluate(credential,{requestId,revision:await revision()});assert.equal(published.availability,'available');assert.ok(published.publication!.candidates.length>1);assert.equal(published.proposal,null);assert.equal(published.requesterAgreed,false);
  assert.deepEqual(await agentRead(),await publication.read(credential,{requestId}),'agent candidate read uses the exact browser freshness projection');
  assert.doesNotMatch(JSON.stringify(await agentRead()),/Private host preference|encryptedCredential|host-calendar|guest-calendar/);
  assert.ok(!JSON.stringify(published).includes('Private'));assert.deepEqual(Object.keys(published.publication!.candidates[0]).sort(),['id','interval']);
  assert.deepEqual(await publication.read(hostCredential,{requestId}),published,'Host and guest see the same safe proposal state');
  await assert.rejects(publication.read(guestCredential(requestId,randomBytes(32).toString('base64url')),{requestId}),code('NOT_FOUND'));
  await assert.rejects(publication.select(credential,{requestId,revision:published.revision,publicationId:published.publication!.id,candidateId:randomUUID(),confirmed:true,idempotencyKey:randomUUID()}),code('INVALID_INPUT'));
  const selectInput={requestId,revision:published.revision,publicationId:published.publication!.id,candidateId:published.publication!.candidates[0].id,confirmed:true as const,idempotencyKey:randomUUID()};
  const selections=await Promise.all(Array.from({length:8},()=>publication.select(credential,selectInput)));assert.ok(selections.every(r=>r.proposal?.version===1&&r.revision===published.revision+1));
  const selected=selections[0];assert.equal(selected.requesterAgreed,false);assert.equal(selected.canAgree,true);assert.equal(selected.proposal!.start,published.publication!.candidates[0].interval.start);
  assert.equal(await sql.query(`select count(*) from fmat.proposals where request_id='${requestId}';`),'1');
  await assert.rejects(publication.select(credential,{...selectInput,candidateId:published.publication!.candidates[1].id}),code('IDEMPOTENCY_CONFLICT'));
  assert.deepEqual(await agentRead(),selected);
  const decision=await agentTool('fmat_review_decision');assert.equal(decision.proposalVersion,selected.proposal!.version);assert.equal(decision.revision,selected.revision);assert.equal(decision.requiresHumanConfirmation,true);assert.equal(decision.path,'/booking/'+requestId);
  const forged=await invoke('fmat_review_decision',{requestId,input:{confirmed:true}});assert.equal((await forged.json()).result.isError,true);assert.equal(await revision(),selected.revision);
  const agreeInput={requestId,revision:selected.revision,proposalVersion:selected.proposal!.version,confirmed:true as const,idempotencyKey:randomUUID()};
  await assert.rejects(publication.agree(hostCredential,agreeInput),code('FORBIDDEN'));
  await assert.rejects(publication.agree(credential,{...agreeInput,proposalVersion:99}),code('STALE_REVISION'));
  const agreements=await Promise.all(Array.from({length:8},()=>publication.agree(credential,agreeInput)));assert.ok(agreements.every(r=>r.requesterAgreed&&r.status==='awaiting_approval'&&r.revision===selected.revision+1));
  assert.equal(await sql.query(`select host_approved_version is null and status='awaiting_approval' from fmat.requests where id='${requestId}';`),'t');
  assert.equal(await sql.query(`select count(*) from fmat.jobs where payload->>'requestId'='${requestId}' and kind like 'booking%';`),'0');
  assert.deepEqual(await agentRead(),await publication.read(credential,{requestId}));
  assert.deepEqual(await agentTool('fmat_get_booking_status'),await new BookingReceipt(database).read(credential,{requestId}));
  assert.equal((await agentTool('fmat_get_booking_status')).receipt,null,'Requester agreement is not a confirmed booking');
  const revised=await publication.select(hostCredential,{...selectInput,revision:await revision(),candidateId:published.publication!.candidates[1].id,idempotencyKey:randomUUID()});assert.equal(revised.proposal!.version,2);assert.equal(revised.requesterAgreed,false);assert.equal((await agentTool('fmat_review_decision')).proposalVersion,2);assert.deepEqual(await agentRead(),revised);
  await assert.rejects(publication.agree(credential,{...agreeInput,revision:revised.revision,idempotencyKey:randomUUID()}),code('STALE_REVISION'));
  await publication.agree(credential,{...agreeInput,revision:revised.revision,proposalVersion:2,idempotencyKey:randomUUID()});
  await sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${host}';`);
  const staleState=await publication.read(credential,{requestId});assert.equal(staleState.availability,'stale');assert.equal(staleState.publication,null);assert.equal(staleState.canAgree,false);assert.equal(staleState.requesterAgreed,false,'Old context is not current agreement');
  assert.deepEqual(await agentRead(),staleState,'agent hides stale candidates and invalidates outdated agreement exactly like the browser');
  await assert.rejects(publication.agree(credential,{...agreeInput,revision:await revision(),proposalVersion:2,idempotencyKey:randomUUID()}),code('STALE_REVISION'));
  const refreshed=await publication.evaluate(credential,{requestId,revision:await revision()});assert.equal(refreshed.proposal,null);assert.equal(refreshed.requesterAgreed,false);
  const refreshedSelection={...selectInput,revision:refreshed.revision,publicationId:refreshed.publication!.id,candidateId:refreshed.publication!.candidates[0].id,idempotencyKey:randomUUID()};
  // Superseding reads and source expiry cannot be hidden by publication.
  await check();assert.equal((await publication.read(credential,{requestId})).availability,'stale');await assert.rejects(publication.select(credential,refreshedSelection),code('STALE_REVISION'));
  const freshAgain=await publication.evaluate(credential,{requestId,revision:await revision()});
  await sql.query(`update fmat.requests set availability_check_started_at=now()-interval '6 minutes' where id='${requestId}';`);
  assert.equal((await publication.read(credential,{requestId})).availability,'stale');
  await assert.rejects(publication.select(credential,{...refreshedSelection,revision:freshAgain.revision,publicationId:freshAgain.publication!.id,candidateId:freshAgain.publication!.candidates[0].id}),code('STALE_REVISION'));
  assert.equal(await sql.query(`select has_table_privilege('authenticated','fmat.candidate_publications','SELECT')||','||has_function_privilege('authenticated','public.fmat_scheduling(text,jsonb,jsonb)','EXECUTE');`),'false,false');
  for(const operation of ['candidates_save','proposal_create','proposal_revise','requester_agree','manual_allowance_save','preference_exception_save'])await assert.rejects(database.rpc('fmat_command',{p_operation:operation,p_actor:{kind:'worker',id:'fabricated'},p_input:{requestId}}),code('FORBIDDEN'));
  await assert.rejects(publication.select({...credential},refreshedSelection),code('UNAUTHORIZED'));
  await sql.query(`do $$ begin update fmat.proposals set details='{}' where request_id='${requestId}';raise exception 'fixture mutable proposal';exception when raise_exception then if sqlerrm<>'IMMUTABLE_PROPOSAL' then raise;end if;end $$;`);
  await verifySchedulingStartCutoff(sql,publication,credential,host,requestId,agentRead);
  const publicationCount=await sql.query(`select count(*) from fmat.candidate_publications where request_id='${requestId}';`);
  let publishEntered!:()=>void,publishRelease!:()=>void;const publishArrived=new Promise<void>(r=>publishEntered=r),publishWait=new Promise<void>(r=>publishRelease=r);publicationGate=async()=>{publishEntered();await publishWait;};
  const stalePublish=assert.rejects(publication.evaluate(credential,{requestId,revision:await revision()}),code('STALE_REVISION'));await publishArrived;
  await sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${host}';`);publishRelease();await stalePublish;publicationGate=async()=>{};
  assert.equal(await sql.query(`select count(*) from fmat.candidate_publications where request_id='${requestId}';`),publicationCount,'Stale publication creates no public offer');
  await sql.query(`update fmat.hosts set rules=jsonb_set(rules,'{preferences}','"Private unresolved preference"'),rules_version=rules_version+1 where id='${host}';`);
  const unresolvedPublication=await publication.evaluate(credential,{requestId,revision:await revision()});assert.equal(unresolvedPublication.availability,'clarification');assert.deepEqual(unresolvedPublication.publication!.candidates,[]);assert.ok(!JSON.stringify(unresolvedPublication).includes('Private unresolved'));assert.equal(unresolvedPublication.proposal,null);

  const privateReview=new PrivateReview(database,service);
  await assert.rejects(privateReview.read(credential,{requestId}),code('FORBIDDEN'));
  await assert.rejects(privateReview.read({...hostCredential},{requestId}),code('UNAUTHORIZED'));
  await assert.rejects(privateReview.read(hostCredential,{requestId:randomUUID()}),code('NOT_FOUND'));
  const privateInitial=await privateReview.read(hostCredential,{requestId});assert.equal(privateInitial.availability,'idle');
  const privateBatch=await privateReview.evaluate(hostCredential,{requestId,revision:await revision()});assert.equal(privateBatch.availability,'current');assert.ok(privateBatch.candidates.length>0);assert.equal(privateBatch.candidates[0].canConfirmPreferences,true);
  assert.deepEqual(await privateReview.read(hostCredential,{requestId}),privateBatch);
  const completedInput=JSON.parse(await sql.query(`select jsonb_build_object('requestId',request_id,'revision',request_revision,'checkId',check_id,'basis',basis,'truncated',${privateBatch.truncated}) from fmat.candidate_evaluations where id='${privateBatch.candidates[0].id}';`));
  const completed=()=>database.rpc('fmat_private_review',{p_operation:'complete',p_credential:hostCredential,p_input:completedInput});
  const completedRetries=await Promise.all(Array.from({length:8},completed));assert.ok(completedRetries.every(result=>JSON.stringify(result)===JSON.stringify(completedRetries[0])));
  assert.equal(await sql.query(`select count(*) from fmat.private_review_checks where request_id='${requestId}';`),'1');
  await assert.rejects(database.rpc('fmat_private_review',{p_operation:'complete',p_credential:hostCredential,p_input:{...completedInput,truncated:!privateBatch.truncated}}),code('IDEMPOTENCY_CONFLICT'));
  await sql.query(`do $$ begin update fmat.private_review_checks set truncated=not truncated where request_id='${requestId}';raise exception 'mutable private check';exception when raise_exception then if sqlerrm<>'IMMUTABLE_EVALUATION' then raise;end if;end $$;`);
  assert.ok(!JSON.stringify(privateBatch).includes('encryptedCredential'));assert.ok(!JSON.stringify(privateBatch).includes('host-calendar'));assert.ok(!JSON.stringify(privateBatch).includes('contextFingerprint'));
  assert.equal(await sql.query(`select has_function_privilege('anon','public.fmat_private_review(text,jsonb,jsonb)','EXECUTE')||','||has_function_privilege('authenticated','public.fmat_private_review(text,jsonb,jsonb)','EXECUTE')||','||has_table_privilege('authenticated','fmat.private_review_checks','SELECT');`),'false,false,false');
  const privateCandidate=privateBatch.candidates[0];
  const privateDecision=await preferences.confirm(hostCredential,{requestId,revision:privateBatch.revision,evaluationId:privateCandidate.id,confirmed:true,idempotencyKey:randomUUID(),choice:{key:'additional',classification:'preference',decision:'satisfied',reason:'Private review reason'}});
  const afterDecision=await privateReview.read(hostCredential,{requestId});assert.equal(afterDecision.availability,'stale');assert.deepEqual(afterDecision.candidates,[]);assert.ok(afterDecision.preferences.some(p=>p.id===privateDecision.decisionId));
  const privateRecheck=await privateReview.evaluate(hostCredential,{requestId,revision:afterDecision.revision,candidate:privateCandidate.interval});assert.equal(privateRecheck.candidates[0].status,'checks_passed');
  await preferences.revoke(hostCredential,{requestId,revision:privateRecheck.revision,decisionId:privateDecision.decisionId,idempotencyKey:randomUUID()});assert.ok(!(await privateReview.read(hostCredential,{requestId})).preferences.some(p=>p.id===privateDecision.decisionId));
  const expiredReview=await privateReview.evaluate(hostCredential,{requestId,revision:await revision(),candidate:privateCandidate.interval});
  // A private batch is complete only for its captured evidence manifest.
  const markerId=await sql.query(`select id from fmat.private_review_checks where request_id='${requestId}' order by created_at desc limit 1;`);
  await sql.query(`set session_replication_role=replica;update fmat.private_review_checks set evaluation_ids='{}' where id='${markerId}';set session_replication_role=origin;`);
  assert.equal((await privateReview.read(hostCredential,{requestId})).availability,'stale');
  await sql.query(`set session_replication_role=replica;update fmat.private_review_checks set evaluation_ids=array['${expiredReview.candidates[0].id}'::uuid] where id='${markerId}';set session_replication_role=origin;`);
  await sql.query(`update fmat.requests set availability_check_started_at=now()-interval '6 minutes' where id='${requestId}';`);assert.equal((await privateReview.read(hostCredential,{requestId})).availability,'stale');
  await assert.rejects(preferences.confirm(hostCredential,{requestId,revision:expiredReview.revision,evaluationId:expiredReview.candidates[0].id,confirmed:true,idempotencyKey:randomUUID(),choice:{key:'additional',classification:'preference',decision:'exception',reason:'Stale'}}),code('STALE_REVISION'));
  await privateReview.evaluate(hostCredential,{requestId,revision:await revision(),candidate:privateCandidate.interval});await sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${host}';`);assert.equal((await privateReview.read(hostCredential,{requestId})).availability,'stale');
  await sql.query(`update fmat.requests set details=details||'{"mode":"in_person","location":"Meeting venue"}',revision=revision+1 where id='${requestId}';`);routeUnavailable=true;hostBusyOverride=[];
  const privateTravel=await privateReview.evaluate(hostCredential,{requestId,revision:await revision(),candidate});assert.equal(privateTravel.candidates[0].travel[0].canConfirm,true);assert.equal(privateTravel.candidates[0].travel[0].boundary.timeLocked,true);assert.equal(privateTravel.candidates[0].travel[0].boundary.locationLocked,true);assert.equal(privateTravel.candidates[0].canConfirmPreferences,false);
  assert.ok(!JSON.stringify(privateTravel).includes('eventId'));assert.ok(!JSON.stringify(privateTravel).includes('contextFingerprint'));
  routeUnavailable=false;hostBusyOverride=null;
  await sql.query(`update fmat.requests set details=details||'{"mode":"online","location":"https://meet.example.test/private-review"}',revision=revision+1 where id='${requestId}';`);

  await reconnect();
  await paused(()=>sql.query(`update fmat.requests set revision=revision+1,details=jsonb_set(details,'{purpose}','"Changed"') where id='${requestId}';`));
  await paused(()=>sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${host}';`));
  await paused(()=>sql.query(`update fmat.hosts set conflict_calendar_ids=array['changed-calendar'] where id='${host}';`));
  await sql.query(`update fmat.hosts set conflict_calendar_ids=array['host-calendar'] where id='${host}';`);
  await paused(()=>sql.query(`update fmat.calendar_connections set generation=gen_random_uuid() where principal_id='${host}';`));
  gatedParty='guest';await paused(()=>sql.query(`update fmat.calendar_connections set generation=gen_random_uuid() where principal_id='${requestId}';`));
  await paused(async()=>manual.manual(credential,{revision:await revision(),confirmed:true,timezone:'UTC',windows}));
  await reconnect();gatedParty='host';
  await paused(async()=>database.rpc('fmat_availability_evaluation',{p_operation:'start',p_credential:credential,p_input:{requestId,revision:await revision(),checkId:randomUUID()}}));
  await paused(()=>sql.query(`update fmat.requests set availability_check_started_at=now()-interval '6 minutes' where id='${requestId}';`));
  await paused(()=>sql.query(`update fmat.calendar_connections set revoked_at=now(),encrypted_credential=null where principal_id='${requestId}';`),'RECONNECT_REQUIRED');await reconnect();
  await paused(()=>sql.query(`update auth.users set banned_until=now()+interval '1 day' where id='${host}';`),'NOT_FOUND');await sql.query(`update auth.users set banned_until=null where id='${host}';`);
  // A local confirmed write is included before Google catches up, and its
  // appearance during the provider read invalidates the frozen snapshot.
  const farApproval=randomUUID();
  await paused(()=>sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${farRequest}','${host}','${JSON.stringify(details)}','${createHash('sha256').update(farRequest).digest('hex')}',now()+interval '3 days');insert into fmat.proposals(request_id,version,details,rules_version) values('${farRequest}',1,'{}',1);insert into fmat.host_approvals(id,request_id,proposal_version,host_id,source,approved_revision) values('${farApproval}','${farRequest}',1,'${host}','authenticated_web',1);insert into fmat.booking_identities(request_id,event_id) values('${farRequest}','fmat456');insert into fmat.booking_attempts(request_id,host_id,proposal_version,approval_id,expected_revision,rules_version,connection_id,connection_provider_subject,calendar_id,event_id,payload,payload_fingerprint,starts_at,ends_at,phase) select '${farRequest}','${host}',1,'${farApproval}',1,1,id,'fixture-host','booking','fmat456','{}','fixture','${at('08:00')}','${at('09:00')}','confirmed' from fmat.calendar_connections where principal_id='${host}';`));
  const neighborSnapshot=await database.rpc('fmat_availability_evaluation',{p_operation:'start',p_credential:credential,p_input:{requestId,revision:await revision(),checkId:randomUUID()}}) as {localBookings:unknown[];localCommitments:unknown[]};
  assert.equal(neighborSnapshot.localBookings.length,0);assert.equal(neighborSnapshot.localCommitments.length,1,'A confirmed neighboring write outside the busy range still fences provider work');
  const approval=randomUUID();
  await paused(()=>sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${otherRequest}','${host}','${JSON.stringify(details)}','${createHash('sha256').update(otherRequest).digest('hex')}',now()+interval '3 days');insert into fmat.proposals(request_id,version,details,rules_version) values('${otherRequest}',1,'{}',1);insert into fmat.host_approvals(id,request_id,proposal_version,host_id,source,approved_revision) values('${approval}','${otherRequest}',1,'${host}','authenticated_web',1);insert into fmat.booking_identities(request_id,event_id) values('${otherRequest}','fmat123');insert into fmat.booking_attempts(request_id,host_id,proposal_version,approval_id,expected_revision,rules_version,connection_id,connection_provider_subject,calendar_id,event_id,payload,payload_fingerprint,starts_at,ends_at,phase) select '${otherRequest}','${host}',1,'${approval}',1,1,id,'fixture-host','booking','fmat123','{}','fixture','${at('11:25')}','${at('12:00')}','confirmed' from fmat.calendar_connections where principal_id='${host}';`));
  const blocked=await check();assert.deepEqual(blocked.evaluation.windows,[]);
  // Observe a real booking-preparation lock wait. Evaluation can finish in
  // the host-lock owner's transaction because booking no longer grabs the
  // Calendar row first and creates a host/connection deadlock cycle.
  const locker=new LocalSql(),waiter=new LocalSql(),lockName='availability-lock-'+host.slice(0,8);
  let bookingWait:Promise<string>|undefined;
  try{
   await locker.query(`begin;select id from fmat.hosts where id='${host}' for update;`);
   bookingWait=waiter.query(`set application_name='${lockName}';do $$ begin perform fmat.prepare_booking((select r from fmat.requests r where id='${otherRequest}'),'${approval}');exception when no_data_found then null;end $$;select 'released';`);
   // Attach immediately: a lock/deadlock failure must never be unhandled.
   const observedWait=bookingWait.then(value=>({value}),error=>({error}));
   let observed=false;
   for(let i=0;i<50;i++){if(await sql.query(`select exists(select 1 from pg_stat_activity where application_name='${lockName}' and wait_event_type='Lock');`)==='t'){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
   assert.ok(observed,'Booking actually waits on the host row');
   const input={requestId,revision:await revision(),checkId:randomUUID()};
   assert.equal(await locker.query(`select public.fmat_availability_evaluation('start','${JSON.stringify(credential)}','${JSON.stringify(input)}')->>'revision';`),String(input.revision));
   await locker.query('commit;');const result=await observedWait;assert.ok('value' in result);assert.equal(result.value,'released');
  }finally{await locker.query('rollback;').catch(()=>{});await bookingWait?.catch(()=>{});locker.close();waiter.close();}
  await verifySchedulingDst(sql,database,env,host,requestId,hostCredential,credential);
  await paused(async()=>{const logout=await fetch(local.API_URL+'/auth/v1/logout?scope=global',{method:'POST',headers:{apikey:local.ANON_KEY,authorization:'Bearer '+authToken}});assert.equal(logout.status,204);},'UNAUTHORIZED',hostCredential);
  await assert.rejects(privateReview.read(hostCredential,{requestId}),code('UNAUTHORIZED'));
  await check(); // A request-bound guest does not depend on the host browser session.
  await sql.query(`update fmat.requests set token_revoked_at=now() where id='${requestId}';`);await assert.rejects(check(),code('NOT_FOUND'));assert.equal((await invoke('fmat_get_scheduling')).status,401);
 }catch(error){testError=error;throw error;}finally{try{
  if(agentClient)await sql.query(`delete from fmat.oauth_codes where grant_id in(select id from fmat.oauth_grants where client_id='${agentClient}');delete from fmat.oauth_grants where client_id='${agentClient}';delete from fmat.oauth_authorizations where client_id='${agentClient}';delete from fmat.oauth_clients where id='${agentClient}';`);
  if(host){await sql.query(`set session_replication_role=replica;delete from fmat.private_review_checks where request_id='${requestId}';delete from fmat.scheduling_decisions where request_id='${requestId}';delete from fmat.proposal_evidence where request_id='${requestId}';delete from fmat.candidate_publications where request_id='${requestId}';delete from fmat.proposals where request_id='${requestId}';delete from fmat.candidate_rankings where request_id='${requestId}';delete from fmat.preference_decisions where request_id='${requestId}';delete from fmat.travel_allowances where request_id='${requestId}';delete from fmat.candidate_evaluations where request_id='${requestId}';delete from fmat.booking_attempts where host_id='${host}';delete from fmat.host_approvals where host_id='${host}';delete from fmat.booking_identities where request_id in('${otherRequest}','${farRequest}');delete from fmat.proposals where request_id in('${otherRequest}','${farRequest}');delete from fmat.audit_events where subject_id in('${requestId}','${otherRequest}','${farRequest}');delete from fmat.calendar_connections where principal_id in('${host}','${requestId}');delete from fmat.request_history where request_id in('${requestId}','${otherRequest}','${farRequest}');delete from fmat.requests where host_id='${host}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invite}';set session_replication_role=origin;`);const removed=await fetch(local.API_URL+'/auth/v1/admin/users/'+host,{method:'DELETE',headers});assert.equal(removed.status,200);}
 }catch(error){throw testError??error;}finally{sql.close();}
 }
});

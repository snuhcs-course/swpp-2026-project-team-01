import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {TravelAllowances} from '../../lib/server/scheduling/allowances.ts';
import {AvailabilityEvaluation} from '../../lib/server/scheduling/availability.ts';
import {RequesterAvailability} from '../../lib/server/calendar/requester-availability.ts';
import {calendarScopes} from '../../lib/server/calendar/google.ts';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {Database} from '../../lib/server/database/client.ts';
import {guestCredential,verifyHostToken,type Credential} from '../../lib/server/identity/credentials.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';
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
 let eventGate=async()=>{},routeGate=async()=>{},saveGate=async()=>{},allowanceGate=async()=>{},eventFailure=false,routeUnavailable=false,inboundSeconds=600,outboundSeconds=600,eventReads=0;
 const originalRpc=database.rpc.bind(database);database.rpc=async(name,parameters)=>{if(name==='fmat_availability_evaluation'&&parameters.p_operation==='evidence_save')await saveGate();if(name==='fmat_travel_allowance'&&parameters.p_operation==='confirm')await allowanceGate();return originalRpc(name,parameters);};
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
 let guestEncrypted='';
 const reconnect=async()=>{await sql.query(`update fmat.requests set availability_mode='calendar',revision=revision+1 where id='${requestId}';update fmat.calendar_connections set revoked_at=null,encrypted_credential='${guestEncrypted}',generation=gen_random_uuid(),selected_calendar_ids=array['guest-calendar'] where principal_id='${requestId}';`);};
 async function paused(mutate:()=>Promise<unknown>,expected='STALE_REVISION',actor=credential){
  let release!:()=>void,entered!:()=>void;const arrived=new Promise<void>(r=>entered=r),waiting=new Promise<void>(r=>release=r);gate=async()=>{entered();await waiting;};
  const pending=check(actor),rejected=assert.rejects(pending,code(expected));await arrived;
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
  await assert.rejects(database.rpc('fmat_command',{p_operation:'candidates_save',p_actor:{kind:'worker',id:'test'},p_input:{requestId,expectedRevision:await revision(),rulesVersion:1,candidates:[]}}),code('RECONNECT_REQUIRED'));
  failure=null;const manualResult=await check();assert.equal(await flags(),'false,false');assert.deepEqual(manualResult.evaluation.windows,[{start:day+'T10:40:00Z',end:day+'T12:00:00Z'}]);
  // This is the actual authorized request evaluator with private neighboring
  // events, not a separately constructed pure travel fixture.
  await sql.query(`update fmat.requests set details=jsonb_set(jsonb_set(details,'{mode}','"in_person"'),'{location}','"Meeting venue"'),revision=revision+1 where id='${requestId}';update fmat.hosts set rules=rules||'{"travelMode":"DRIVE","travelBufferMinutes":5}',rules_version=rules_version+1 where id='${host}';`);
  const physical=async()=>service.read(credential,{requestId,revision:await revision(),candidate});
  const fits=await physical();assert.equal(fits.candidateEvaluation?.interval,'fits');assert.equal(fits.candidateEvaluation?.travel?.status,'fits');assert.equal(routeCalls.length,2);assert.deepEqual(routeCalls.map(r=>r.departureTime).sort(),[day+'T10:40:00Z',day+'T11:40:00Z']);
  assert.equal(fits.persisted?.status,'checks_passed');assert.equal(fits.persisted?.complete,false);
  const savedInput={...fits.context,rulesVersion:fits.rulesVersion,evidence:{candidate,...fits.candidateEvaluation,preferences:'pending',complete:false}};
  const retries=await Promise.all(Array.from({length:8},()=>database.rpc('fmat_availability_evaluation',{p_operation:'evidence_save',p_credential:credential,p_input:savedInput}))) as {evaluationId:string}[];
  assert.ok(retries.every(r=>r.evaluationId===fits.persisted!.evaluationId));
  assert.equal(await sql.query(`select count(*) from fmat.candidate_evaluations where check_id='${fits.context.checkId}';`),'1','Concurrent retries retain one immutable evidence row');
  assert.equal(await sql.query(`select has_table_privilege('anon','fmat.candidate_evaluations','SELECT')||','||has_table_privilege('authenticated','fmat.candidate_evaluations','SELECT')||','||(select relrowsecurity from pg_class where oid='fmat.candidate_evaluations'::regclass);`),'false,false,true');
  await sql.query(`do $$ begin update fmat.candidate_evaluations set status='clarification' where id='${fits.persisted!.evaluationId}';raise exception 'fixture mutable evidence';exception when raise_exception then if sqlerrm<>'IMMUTABLE_EVALUATION' then raise;end if;end $$;`);
  assert.equal(await sql.query(`select evidence->>'preferences'='pending' and evidence->>'complete'='false' and private_context->'rules'->>'preferences'='Private host preference' and not(private_context::text like '%host-access%' or private_context::text like '%encryptedCredential%') from fmat.candidate_evaluations where id='${fits.persisted!.evaluationId}';`),'t');
  const evidenceTarget={requestId,revision:await revision(),evaluationId:fits.persisted!.evaluationId};
  assert.deepEqual(await service.evidence(credential,evidenceTarget),fits.persisted);assert.deepEqual(await service.evidence(hostCredential,evidenceTarget),fits.persisted);
  assert.ok(!JSON.stringify(await service.evidence(credential,evidenceTarget)).includes('previous'));
  await assert.rejects(database.rpc('fmat_availability_evaluation',{p_operation:'evidence_save',p_credential:credential,p_input:{...savedInput,evidence:{...savedInput.evidence,preferences:'pending',complete:true}}}),code('INVALID_INPUT'));
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
  await paused(async()=>{const logout=await fetch(local.API_URL+'/auth/v1/logout?scope=global',{method:'POST',headers:{apikey:local.ANON_KEY,authorization:'Bearer '+authToken}});assert.equal(logout.status,204);},'UNAUTHORIZED',hostCredential);
  await check(); // A request-bound guest does not depend on the host browser session.
  await sql.query(`update fmat.requests set token_revoked_at=now() where id='${requestId}';`);await assert.rejects(check(),code('NOT_FOUND'));
 }finally{
  if(host){await sql.query(`set session_replication_role=replica;delete from fmat.travel_allowances where request_id='${requestId}';delete from fmat.candidate_evaluations where request_id='${requestId}';delete from fmat.booking_attempts where host_id='${host}';delete from fmat.host_approvals where host_id='${host}';delete from fmat.booking_identities where request_id in('${otherRequest}','${farRequest}');delete from fmat.proposals where request_id in('${otherRequest}','${farRequest}');delete from fmat.audit_events where subject_id in('${requestId}','${otherRequest}','${farRequest}');delete from fmat.calendar_connections where principal_id in('${host}','${requestId}');delete from fmat.request_history where request_id in('${requestId}','${otherRequest}','${farRequest}');delete from fmat.requests where host_id='${host}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invite}';set session_replication_role=origin;`);const removed=await fetch(local.API_URL+'/auth/v1/admin/users/'+host,{method:'DELETE',headers});assert.equal(removed.status,200);}sql.close();
 }
});

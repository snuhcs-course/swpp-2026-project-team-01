import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {RequestReview} from '../../lib/server/identity/request-review.ts';
import {guestCredential,type Credential} from '../../lib/server/identity/credentials.ts';
import {publicError} from '../../lib/server/errors.ts';
import {Database} from '../../lib/server/database/client.ts';
import {LocalSql} from './local-sql.ts';
import {verifyReviewWindowLocks} from './request-review-windows.ts';

test('concurrent explicit review retries apply once and current authority fences cached results',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const database=new Database({...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY});
 const sql=new LocalSql(),host=randomUUID(),invite=randomUUID(),request=randomUUID(),token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
 const credential=guestCredential(request,token),service=new RequestReview(database);
 try{
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invite}','${host}@example.test','${createHash('sha256').update(invite).digest('hex')}',now()+interval '1 day','review-test');insert into fmat.hosts(id,email,invitation_id) values('${host}','${host}@example.test','${invite}');insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${request}','${host}','{"requesterName":"Preserved name","purpose":"original"}','${hash}',now()+interval '1 day');`);
  const grant=await database.rpc('fmat_conversation_access',{p_operation:'open',p_credential:credential,p_input:{audience:'request_shared',requestId:request}}) as {grantId:string;conversationId:string};
  const now=Date.now();
  for(const [start,end] of [[now-60000,now+3600000],[now+3600000,now+4500000]]){
   await assert.rejects(database.rpc('fmat_conversation_tool',{p_grant_id:grant.grantId,p_conversation_id:grant.conversationId,p_operation:'details_propose',p_input:{expectedRevision:1,patch:{durationMinutes:30,windows:[{start:new Date(start).toISOString(),end:new Date(end).toISOString()}]},clarifications:[],idempotencyKey:randomUUID()}}),{code:'INVALID_INPUT'});
  }
  assert.equal(await sql.query(`select count(*) from fmat.request_detail_reviews where request_id='${request}';`),'0','Invalid extracted windows cannot create a review');
  const input={expectedRevision:1,patch:{purpose:'Reviewed purpose'},clarifications:[],idempotencyKey:'one-message'};
  const propose=()=>database.rpc('fmat_conversation_tool',{p_grant_id:grant.grantId,p_conversation_id:grant.conversationId,p_operation:'details_propose',p_input:input});
  await Promise.all(Array.from({length:6},propose));
  const draft=await service.read(credential);assert.equal(draft.revision,1);assert.equal(draft.details.purpose,'original');assert.equal(draft.review?.details.requesterName,'Preserved name');
  assert.equal(await sql.query(`select count(*) from fmat.request_detail_reviews where request_id='${request}';`),'1');
  await assert.rejects(service.read(JSON.parse(JSON.stringify(credential)) as Credential),{code:'UNAUTHORIZED'});
  await assert.rejects(service.read(guestCredential(randomUUID(),token)),{code:'NOT_FOUND'});
  await assert.rejects(database.rpc('fmat_conversation_tool',{p_grant_id:grant.grantId,p_conversation_id:grant.conversationId,p_operation:'details_propose',p_input:{...input,patch:{purpose:'Changed retry sentinel'}}}),{code:'IDEMPOTENCY_CONFLICT'});
  await assert.rejects(service.decide('apply',credential,{reviewId:draft.review!.id,expectedRevision:0,confirmed:true,idempotencyKey:randomUUID()}),{code:'STALE_REVISION'});
  assert.equal((await service.read(credential)).revision,1,'denied mutations retain the original revision');
  const decision={reviewId:draft.review!.id,expectedRevision:1,confirmed:true,idempotencyKey:randomUUID()};
  const applied=await Promise.all(Array.from({length:8},()=>service.decide('apply',credential,decision)));
  assert.ok(applied.every(result=>result.revision===2&&result.review?.status==='applied'));
  assert.equal(await sql.query(`select count(*) from fmat.request_history where request_id='${request}' and operation='details_update';`),'1');
  await assert.rejects(service.decide('dismiss',credential,decision),error=>{
   const safe=publicError(error);assert.equal(safe.status,409);assert.equal(safe.body.error.code,'IDEMPOTENCY_CONFLICT');
   assert.doesNotMatch(JSON.stringify(safe),new RegExp(`${token}|${hash}|Reviewed purpose|Preserved name`));return true;
  });
  assert.equal((await service.read(credential)).revision,2,'conflicting retry cannot undo the committed review');
  assert.equal((await service.read(credential)).details.requesterName,'Preserved name');
  assert.equal(await sql.query(`select requester_agreed_version is null and host_approved_version is null and event is null from fmat.requests where id='${request}';`),'t','Applying reviewed details never records meeting decisions');
  await database.rpc('fmat_conversation_tool',{p_grant_id:grant.grantId,p_conversation_id:grant.conversationId,p_operation:'details_propose',p_input:{expectedRevision:2,patch:{purpose:'Later reviewed purpose'},clarifications:[],idempotencyKey:randomUUID()}});
  const later=await service.read(credential);await service.decide('apply',credential,{reviewId:later.review!.id,expectedRevision:2,confirmed:true,idempotencyKey:randomUUID()});
  const beforeReplay=await service.read(credential);
  assert.deepEqual(await service.decide('apply',credential,decision),{revision:beforeReplay.revision,details:beforeReplay.details,review:applied[0].review},'Replay reports the original decision alongside current request details');
  assert.deepEqual(await service.read(credential),beforeReplay,'Old replay cannot overwrite current details or review');
  assert.equal(await sql.query(`select count(*) from fmat.request_history where request_id='${request}' and operation='details_update';`),'2','Replaying the older review creates no third details mutation');
  await database.rpc('fmat_conversation_tool',{p_grant_id:grant.grantId,p_conversation_id:grant.conversationId,p_operation:'details_propose',p_input:{expectedRevision:beforeReplay.revision,patch:{purpose:'Stale pending purpose'},clarifications:[],idempotencyKey:randomUUID()}});
  const stale=await service.read(credential);
  await sql.query(`update fmat.requests set revision=revision+1,details=jsonb_set(details,'{purpose}','"Intervening purpose"') where id='${request}';`);
  const intervening=await service.read(credential);
  await assert.rejects(service.decide('apply',credential,{reviewId:stale.review!.id,expectedRevision:stale.revision,confirmed:true,idempotencyKey:randomUUID()}),{code:'STALE_REVISION'});
  assert.deepEqual(await service.read(credential),intervening,'A formerly current unapplied review cannot overwrite an intervening revision');
  await verifyReviewWindowLocks(database,sql,service,credential,request,grant);
  await sql.query(`update fmat.requests set token_revoked_at=now() where id='${request}';`);
  await assert.rejects(service.decide('apply',credential,decision),{code:'NOT_FOUND'});
  await assert.rejects(service.read(credential),{code:'NOT_FOUND'});
 }finally{
  await sql.query(`delete from fmat.idempotency where actor_scope='guest:${hash}';delete from fmat.audit_events where subject_id='${request}';delete from fmat.request_history where request_id='${request}';delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where request_id='${request}');delete from fmat.conversation_scopes where request_id='${request}';delete from fmat.requests where id='${request}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invite}';`);sql.close();
 }
});

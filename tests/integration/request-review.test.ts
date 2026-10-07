import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {RequestReview} from '../../lib/server/identity/request-review.ts';
import {guestCredential} from '../../lib/server/identity/credentials.ts';
import {Database} from '../../lib/server/database/client.ts';
import {LocalSql} from './local-sql.ts';

test('concurrent explicit review retries apply once and current authority fences cached results',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const database=new Database({...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY});
 const sql=new LocalSql(),host=randomUUID(),invite=randomUUID(),request=randomUUID(),token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
 const credential=guestCredential(request,token),service=new RequestReview(database);
 try{
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invite}','${host}@example.test','${createHash('sha256').update(invite).digest('hex')}',now()+interval '1 day','review-test');insert into fmat.hosts(id,email,invitation_id) values('${host}','${host}@example.test','${invite}');insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${request}','${host}','{"requesterName":"Preserved name","purpose":"original"}','${hash}',now()+interval '1 day');`);
  const grant=await database.rpc('fmat_conversation_access',{p_operation:'open',p_credential:credential,p_input:{audience:'request_shared',requestId:request}}) as {grantId:string;conversationId:string};
  const input={expectedRevision:1,patch:{purpose:'Reviewed purpose'},clarifications:[],idempotencyKey:'one-message'};
  const propose=()=>database.rpc('fmat_conversation_tool',{p_grant_id:grant.grantId,p_conversation_id:grant.conversationId,p_operation:'details_propose',p_input:input});
  await Promise.all(Array.from({length:6},propose));
  const draft=await service.read(credential);assert.equal(draft.revision,1);assert.equal(draft.details.purpose,'original');assert.equal(draft.review?.details.requesterName,'Preserved name');
  assert.equal(await sql.query(`select count(*) from fmat.request_detail_reviews where request_id='${request}';`),'1');
  const decision={reviewId:draft.review!.id,expectedRevision:1,confirmed:true,idempotencyKey:randomUUID()};
  const applied=await Promise.all(Array.from({length:8},()=>service.decide('apply',credential,decision)));
  assert.ok(applied.every(result=>result.revision===2&&result.review?.status==='applied'));
  assert.equal(await sql.query(`select count(*) from fmat.request_history where request_id='${request}' and operation='details_update';`),'1');
  await sql.query(`update fmat.requests set token_revoked_at=now() where id='${request}';`);
  await assert.rejects(service.decide('apply',credential,decision),{code:'NOT_FOUND'});
  await assert.rejects(service.read(credential),{code:'NOT_FOUND'});
 }finally{
  await sql.query(`delete from fmat.idempotency where actor_scope='guest:${hash}';delete from fmat.audit_events where subject_id='${request}';delete from fmat.request_history where request_id='${request}';delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where request_id='${request}');delete from fmat.conversation_scopes where request_id='${request}';delete from fmat.requests where id='${request}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invite}';`);sql.close();
 }
});

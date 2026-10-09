import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {Database} from '../../lib/server/database/client.ts';
import {ConversationTools} from '../../lib/server/identity/tool-execution.ts';
import {RequestReview} from '../../lib/server/identity/request-review.ts';
import {guestCredential} from '../../lib/server/identity/credentials.ts';
import {LocalSql} from './local-sql.ts';

test('real model context and replay minimize contacts while protected review applies the exact explicit edit',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const database=new Database({...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY});
 const sql=new LocalSql(),host=randomUUID(),invite=randomUUID(),request=randomUUID(),token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
 const credential=guestCredential(request,token),browser=new RequestReview(database),tools=new ConversationTools(database);
 try{
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invite}','${host}@example.test','${createHash('sha256').update(invite).digest('hex')}',now()+interval '1 day','model-context-test');
   insert into fmat.hosts(id,email,invitation_id) values('${host}','${host}@example.test','${invite}');
   insert into fmat.requests(id,host_id,details,token_hash,expires_at,contact_verified_email,private_notes) values('${request}','${host}','{"requesterName":"Original private contact","requesterEmail":"original-contact@example.test","purpose":"Discuss research"}','${hash}',now()+interval '1 day','original-contact@example.test','Host-only sentinel');`);
  const grant=await database.rpc('fmat_conversation_access',{p_operation:'open',p_credential:credential,p_input:{audience:'request_shared',requestId:request}}) as {grantId:string;conversationId:string};
  const auth={authenticator:'fmat-conversation',principalType:'user',principalId:grant.grantId,attributes:{conversationId:grant.conversationId,messageId:randomUUID()}},call={sessionId:'request-context-fixture',callId:'call-1'};
  const read=()=>tools.execute(auth,call,{operation:'request_read',input:{}}) as Promise<Record<string,any>>;
  const first=await read();assert.equal(first.details.requesterNameProvided,true);assert.equal(first.details.requesterEmailProvided,true);assert.equal(first.contactVerified,true);assert.equal(first.details.purpose,'Discuss research');
  assert.doesNotMatch(JSON.stringify(first),/Original private contact|original-contact@example.test|Host-only sentinel/);
  for(const intent of ['question','unknown']){
   await assert.rejects(tools.proposeRequestExtraction(auth,call,{intent,expectedRevision:1,patch:{purpose:'Must not be proposed'},clarifications:['timezone']}),{code:'INVALID_INPUT'});
   assert.deepEqual(await read(),first,'Rejected uncertain extraction cannot replace a review or mutate the request');
  }
  const questionAuth={...auth,attributes:{...auth.attributes,messageId:randomUUID()}};
  const questionInput={intent:'question',expectedRevision:1,patch:{},clarifications:['timezone'],clarificationLanguage:'ko'};
  const question=await tools.proposeRequestExtraction(questionAuth,call,questionInput) as Record<string,any>;
  assert.deepEqual(await tools.proposeRequestExtraction(questionAuth,{...call,callId:'question-retry'},questionInput),question);
  await assert.rejects(tools.proposeRequestExtraction(questionAuth,call,{...questionInput,clarificationLanguage:'en'}),{code:'IDEMPOTENCY_CONFLICT'});
  assert.deepEqual(question.review.patch,{});assert.deepEqual(question.review.clarifications,['어떤 시간대를 기준으로 할까요?']);
  const questionReview=await browser.read(credential);assert.equal(questionReview.revision,1);
  assert.deepEqual(questionReview.review?.clarifications,['어떤 시간대를 기준으로 할까요?']);
  for(const claim of ['The meeting is booked and approved.','예약이 완료되었습니다.']){
   await assert.rejects(tools.proposeRequestExtraction(auth,call,{...questionInput,clarifications:[claim]}),{code:'INVALID_INPUT'});
   assert.deepEqual(await browser.read(credential),questionReview,'Invalid prose cannot replace the current authored review');
  }
  await assert.rejects(browser.decide('apply',credential,{reviewId:questionReview.review!.id,expectedRevision:1,confirmed:true,idempotencyKey:randomUUID()}),{code:'INVALID_INPUT'});
  assert.deepEqual(await browser.read(credential),questionReview,'Clarification-only apply denial preserves the review');
  const command={intent:'details',expectedRevision:1,patch:{requesterName:'Corrected private contact',requesterEmail:'corrected-contact@example.test'},clarifications:[]};
  const proposed=await tools.proposeRequestExtraction(auth,call,command) as Record<string,any>;
  const replay=await tools.proposeRequestExtraction(auth,{...call,callId:'regenerated-call'},command);
  assert.deepEqual(proposed,replay);assert.equal(proposed.review.patch.requesterNameProvided,true);assert.equal(proposed.review.patch.requesterEmailProvided,true);
  assert.equal(proposed.review.details.purpose,'Discuss research');assert.doesNotMatch(JSON.stringify(proposed),/Corrected private contact|corrected-contact@example.test/);
  const pending=await read();assert.equal(pending.review.status,'pending');assert.doesNotMatch(JSON.stringify(pending),/Original private contact|original-contact@example.test|Corrected private contact|corrected-contact@example.test|Host-only sentinel/);
  const protectedDraft=await browser.read(credential);assert.equal(protectedDraft.revision,1);assert.equal(protectedDraft.details.requesterName,'Original private contact');assert.equal(protectedDraft.details.requesterEmail,'original-contact@example.test');
  assert.equal(protectedDraft.review?.patch.requesterName,'Corrected private contact');assert.equal(protectedDraft.review?.patch.requesterEmail,'corrected-contact@example.test');
  assert.equal(await sql.query(`select count(*) from fmat.request_detail_reviews where request_id='${request}' and status='pending';`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.request_detail_reviews where request_id='${request}';`),'2','One superseded clarification and one details review; exact retries add neither');
  const applied=await browser.decide('apply',credential,{reviewId:protectedDraft.review!.id,expectedRevision:1,confirmed:true,idempotencyKey:randomUUID()});
  assert.equal(applied.revision,2);assert.equal(applied.details.requesterEmail,'corrected-contact@example.test');
  const current=await read();assert.equal(current.revision,2);assert.equal(current.contactVerified,false,'Contact presence does not preserve verification after an email edit');
  assert.equal(current.details.requesterEmailProvided,true);assert.doesNotMatch(JSON.stringify(current),/Original private contact|original-contact@example.test|Corrected private contact|corrected-contact@example.test|Host-only sentinel/);
  await sql.query(`update fmat.requests set token_revoked_at=now() where id='${request}';`);
  await assert.rejects(read(),{code:'NOT_FOUND'});await assert.rejects(tools.proposeRequestExtraction(auth,call,command),{code:'NOT_FOUND'});
 }finally{
  await sql.query(`delete from fmat.idempotency where actor_scope='guest:${hash}';delete from fmat.audit_events where subject_id='${request}';delete from fmat.request_history where request_id='${request}';delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where request_id='${request}');delete from fmat.conversation_scopes where request_id='${request}';delete from fmat.requests where id='${request}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invite}';`);sql.close();
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {LocalSql} from './local-sql.ts';

// A rollback-only local fixture executes the exact versioned data migration,
// including old pending/completed rows and a row admitted by the new function.
test('credential backfill preserves original retries and pending delivery without restoring plaintext',async()=>{
 const sql=new LocalSql(),host=randomUUID(),session=randomUUID(),invitation=randomUUID();
 const first=randomUUID(),pending=randomUUID(),fresh=randomUUID();
 const migration=readFileSync('supabase/migrations/20261009122445_protect_existing_conversation_text.sql','utf8');
 try{
  await sql.query(`begin;
   insert into auth.users(id,email,email_confirmed_at) values('${host}','${host}@text.test',now());
   insert into auth.sessions(id,user_id) values('${session}','${host}');
   insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${host}@text.test',encode(sha256('${invitation}'::bytea),'hex'),now()+interval '1 day','fixture');
   insert into fmat.hosts(id,email,invitation_id) values('${host}','${host}@text.test','${invitation}');
   create temporary table text_fixture as select public.fmat_conversation_access('open',
    jsonb_build_object('kind','host','subject','${host}','sessionId','${session}','expiresAt',now()+interval '1 hour'),'{"audience":"host_setup"}') as access;
   create function pg_temp.message(text,jsonb default '{}') returns jsonb language sql as $$
    select public.fmat_runtime_message($1,(access->>'grantId')::uuid,(access->>'conversationId')::uuid,$2) from text_fixture
   $$;
   select pg_temp.message('accept','{"clientId":"${fresh}","text":"New input Bearer new-secret"}');
   update fmat.runtime_messages set status='completed' where client_id='${fresh}';
   insert into fmat.runtime_messages(conversation_id,grant_id,client_id,text,status,created_at)
    select (access->>'conversationId')::uuid,(access->>'grantId')::uuid,'${first}','Earlier code=old-secret','completed',now()-interval '2 minutes' from text_fixture;
   insert into fmat.runtime_messages(conversation_id,grant_id,client_id,text,status,created_at)
    select (access->>'conversationId')::uuid,(access->>'grantId')::uuid,'${pending}','Meet in Seoul. Bearer pending-secret','pending',now()-interval '1 minute' from text_fixture;
   create temporary table before_messages as select * from fmat.runtime_messages where client_id in('${first}','${pending}','${fresh}');`);
  const json=async(query:string)=>JSON.parse(await sql.query(query));
  // The structural migration already protects reads during the DDL/backfill gap.
  const before=await json(`select pg_temp.message('inspect');`);
  assert.deepEqual(before.messages.map((m:{text:string})=>m.text),['Earlier [x]','Meet in Seoul. [x]','New input [x]']);
  assert.equal((await json(`select pg_temp.message('accept','{"clientId":"${pending}","text":"Meet in Seoul. Bearer pending-secret"}');`)).status,'pending');
  await sql.query(migration);
  assert.equal(await sql.query(`select bool_and((to_jsonb(m)-'text'-'input_fingerprint')=(to_jsonb(b)-'text'-'input_fingerprint')) from fmat.runtime_messages m join before_messages b using(id);`),'t');
  assert.equal(await sql.query(`select bool_and(m.input_fingerprint=coalesce(b.input_fingerprint,fmat.conversation_input_fingerprint(b.conversation_id,b.grant_id,b.client_id,b.text))) from fmat.runtime_messages m join before_messages b using(id);`),'t');
  assert.deepEqual(await json(`select pg_temp.message('inspect');`),before,'IDs/status/order and protected content unchanged');
  for(const [client,text,status] of [[first,'Earlier code=old-secret','completed'],[pending,'Meet in Seoul. Bearer pending-secret','pending'],[fresh,'New input Bearer new-secret','completed']]){
   const receipt=await json(`select pg_temp.message('accept',jsonb_build_object('clientId','${client}','text','${text}'));`);
   assert.equal(receipt.status,status);assert.ok(!receipt.text.includes('secret'));
  }
  await sql.query(`do $$begin
   begin perform pg_temp.message('accept','{"clientId":"${pending}","text":"Meet in Seoul. Bearer changed-secret"}');
    raise exception 'Changed original input unexpectedly accepted';
   exception when raise_exception then if sqlerrm<>'IDEMPOTENCY_CONFLICT' then raise;end if;end;
  end$$;`);
  const delivered=await json(`select pg_temp.message('deliver',jsonb_build_object('messageId',(select id from before_messages where client_id='${pending}'),'sessionId','migration-fixture'));`);
  assert.equal(delivered.text,'Meet in Seoul. [x]');
  await sql.query(`update fmat.runtime_messages set next_dispatch_at=clock_timestamp()-interval '1 second' where client_id='${pending}';`);
  const dispatch=await json(`select public.fmat_runtime_dispatch('claim','{}');`);
  assert.equal(dispatch.find((r:{messageId:string})=>r.messageId===delivered.id)?.text,'Meet in Seoul. [x]');
  await sql.query(migration);
  assert.equal(await sql.query(`select bool_and(m.input_fingerprint=coalesce(b.input_fingerprint,fmat.conversation_input_fingerprint(b.conversation_id,b.grant_id,b.client_id,b.text))) from fmat.runtime_messages m join before_messages b using(id);`),'t','repeated backfill never fingerprints the replacement text');
  assert.equal(await sql.query(`select bool_and(text not like '%secret%') from fmat.runtime_messages where client_id in('${first}','${pending}','${fresh}');`),'t');
  assert.equal((await json(`select pg_temp.message('inspect');`)).sessionId,'migration-fixture');
  await sql.query('rollback;');
 }finally{sql.close();}
});

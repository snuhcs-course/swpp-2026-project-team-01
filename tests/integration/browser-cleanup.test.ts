import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {LocalSql} from './local-sql.ts';
import {cleanupBrowserHostSql} from '../e2e/browser-cleanup.ts';

test('interrupted browser fixture removes pending host revisions without touching another host',async()=>{
 const sql=new LocalSql();
 const fixtures=Array.from({length:2},()=>({host:randomUUID(),request:randomUUID(),invitation:randomUUID(),draft:randomUUID(),email:randomUUID()+'@example.test'}));
 try{
  await sql.query('begin;');
  for(const f of fixtures)await sql.query(`
   insert into auth.users(id,email,email_confirmed_at) values('${f.host}','${f.email}',now());
   insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${f.invitation}','${f.email}',replace('${f.invitation}','-','')||replace('${f.invitation}','-',''),now()+interval '1 day','cleanup-fixture');
   insert into fmat.hosts(id,email,invitation_id) values('${f.host}','${f.email}','${f.invitation}');
   insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${f.request}','${f.host}','{"purpose":"Original"}',replace('${f.request}','-','')||replace('${f.request}','-',''),now()+interval '1 day');
   insert into fmat.host_revision_drafts(id,request_id,host_id,base_revision,input,before_details,proposed_details,idempotency_key)
    values('${f.draft}','${f.request}','${f.host}',1,'{"patch":{"purpose":"Suggested"},"clarifications":[]}','{"purpose":"Original"}','{"purpose":"Suggested"}','cleanup-pending');
  `);
  const [target,sentinel]=fixtures;
  const snapshot=()=>sql.query(`select jsonb_build_object('host',to_jsonb(h),'request',to_jsonb(r),'draft',to_jsonb(d)) from fmat.hosts h join fmat.requests r on r.host_id=h.id join fmat.host_revision_drafts d on d.request_id=r.id where h.id='${sentinel.host}';`);
  const before=await snapshot();assert.ok(before);
  await sql.query(cleanupBrowserHostSql(target.host,target.request,target.invitation,target.email));
  for(const [table,column,id] of [['hosts','id',target.host],['requests','host_id',target.host],['host_revision_drafts','host_id',target.host],['invitations','id',target.invitation]]){
   assert.equal(await sql.query(`select count(*) from fmat.${table} where ${column}='${id}';`),'0',table);
  }
  assert.equal(await snapshot(),before,'Cleanup cannot mutate the other host or its pending review');
  assert.equal(await sql.query('show session_replication_role;'),'origin');
  await sql.query(cleanupBrowserHostSql(target.host,target.request,target.invitation,target.email));
  assert.equal(await snapshot(),before,'Repeated cleanup remains scoped and harmless');
  await sql.query('rollback;');
 }finally{await sql.close();}
});

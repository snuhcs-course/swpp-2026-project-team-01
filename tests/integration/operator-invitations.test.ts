import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {Database} from '../../lib/server/database/client.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';

test('operator invitations serialize issuance/revocation and evaluate expiry after lock waits',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const db=new Database({SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY}),sql=new LocalSql(),operator='invitation-'+randomUUID();
 const input={project:'local',email:'fixture@example.test',tokenHash:createHash('sha256').update(randomUUID()).digest('hex'),delivery:'manual',origin:'http://localhost:3000',idempotencyKey:randomUUID()};
 const call=(operation:string,value:unknown)=>db.rpc('fmat_invitation_operator',{p_operation:operation,p_operator:operator,p_input:value}) as Promise<{invitationId:string;expiresAt:string;status:string;deliveryStatus:string}>;
 try{
  const issued=await Promise.all(Array.from({length:8},()=>call('issue',input)));assert.ok(issued.every(value=>JSON.stringify(value)===JSON.stringify(issued[0])));
  const id=issued[0].invitationId,target={project:'local',invitationId:id};
  assert.equal(await sql.query(`select count(*) from fmat.invitations where issued_by='${operator}';`),'1');
  assert.equal(await sql.query(`select expires_at-created_at=interval '7 days' from fmat.invitations where id='${id}';`),'t');
  await assert.rejects(call('issue',{...input,email:'changed@example.test'}),(error:unknown)=>error instanceof ApplicationError&&error.code==='IDEMPOTENCY_CONFLICT');
  const denied=await fetch(local.API_URL+'/rest/v1/rpc/fmat_invitation_operator',{method:'POST',headers:{apikey:local.ANON_KEY,authorization:'Bearer '+local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({p_operation:'issue',p_operator:operator,p_input:input})});assert.equal(denied.status,401);
  const lock=new LocalSql();let pending:ReturnType<typeof call>|undefined;
  try{
   await lock.query(`begin;update fmat.invitations set expires_at=clock_timestamp()+interval '1 second' where id='${id}';`);
   const pid=await lock.query('select pg_backend_pid();');pending=call('status',target);let observed=false;
   for(let i=0;i<100;i++){if(await sql.query(`select exists(select 1 from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid)) and wait_event_type='Lock');`)==='t'){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
   assert.equal(observed,true,'Status must wait on the invitation row');await new Promise(resolve=>setTimeout(resolve,1100));await lock.query('commit;');assert.equal((await pending).status,'expired');
  }finally{await lock.query('rollback;').catch(()=>{});await pending?.catch(()=>{});lock.close();}
  assert.equal((await call('issue',input)).status,'expired','An exact retry cannot renew the seven-day invitation');
  const second=await call('issue',{...input,idempotencyKey:randomUUID(),tokenHash:createHash('sha256').update(randomUUID()).digest('hex')});
  const revoke={project:'local',invitationId:second.invitationId,idempotencyKey:randomUUID()};
  const revocations=await Promise.all(Array.from({length:8},()=>call('revoke',revoke)));assert.ok(revocations.every(value=>value.status==='revoked'));
  assert.equal(await sql.query(`select count(*) from fmat.audit_events where operation='invitation_revoke' and subject_id='${second.invitationId}';`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.jobs where payload->>'invitationId' in(select id::text from fmat.invitations where issued_by='${operator}');`),'0');
 }finally{
  await sql.query(`delete from fmat.invitation_deliveries where operator_id='${operator}';delete from fmat.invitations where issued_by='${operator}';delete from fmat.idempotency where actor_scope='invitation_operator:local:${operator}';delete from fmat.audit_events where actor->>'id'='${operator}';`);sql.close();
 }
});

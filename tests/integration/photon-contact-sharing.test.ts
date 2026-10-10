import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Database} from '../../lib/server/database/client.ts';
import {verifyHostToken,guestCredential,type Credential} from '../../lib/server/identity/credentials.ts';
import {HostContactSharing} from '../../lib/server/photon/contact-sharing.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';

const code=(value:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===value;
const literal=(value:unknown)=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
type Claim={action:string;shareId?:string;leaseToken?:string};
const lease=(claim:Claim)=>({shareId:claim.shareId,leaseToken:claim.leaseToken});

test('contact intents deduplicate concurrent host actions and recover uncertain dispatch under real Auth',{timeout:60_000},async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const project=randomUUID(),env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,PHOTON_PROJECT_ID:project};
 const headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 const sql=new LocalSql(),holder=new LocalSql(),database=new Database(env),service=new HostContactSharing(database,env);
 const users:{id:string;invitation:string;link:string;credential:Credential;token:string}[]=[];
 const delivery=(operation:string,input:unknown={})=>database.rpc('fmat_photon_contact_delivery',{p_operation:operation,p_project_id:project,p_input:input}) as Promise<Claim>;
 try{
  await sql.query(`insert into fmat.photon_receivers(project_id,receiver_id,enabled) values('${project}','${randomUUID()}',true);`);
  for(let n=0;n<2;n++){
   const email=randomUUID()+'@example.test',password=randomUUID()+randomUUID(),invitation=randomUUID(),link=randomUUID(),challenge=randomUUID(),phone='+1555030000'+n;
   const created=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);const id=(await created.json()).id;
   const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);const token=(await login.json()).access_token,credential=await verifyHostToken(token,{env});
   users.push({id,invitation,link,credential,token});
   await assert.rejects(service.request(credential,{linkId:link,idempotencyKey:randomUUID()}),code('HOST_NOT_ADMITTED'));
   // SQL fixtures establish already-verified links; the separate linking suite
   // exercises actual code delivery/proof. No provider or real recipient here.
   await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${email}','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','contact-test');
    insert into fmat.hosts(id,email,invitation_id) values('${id}','${email}','${invitation}');
    insert into fmat.photon_link_challenges(id,host_id,project_id,credential,browser_hash,phone,line,space_id,code_hash,request_key,consumed_at,delivery_status)
    values('${challenge}','${id}','${project}',${literal(credential)},repeat('b',64),'${phone}','shared','any;-;${phone}',repeat('c',64),'${randomUUID()}',now(),'accepted');
    insert into fmat.photon_links(id,host_id,project_id,phone,line,space_id,challenge_id) values('${link}','${id}','${project}','${phone}','shared','any;-;${phone}','${challenge}');`);
  }
  const [one,two]=users,input={linkId:one.link,idempotencyKey:randomUUID()};
  await assert.rejects(service.request({...one.credential},input),code('UNAUTHORIZED'));
  await assert.rejects(service.request(guestCredential(randomUUID(),'a'.repeat(43)),input),code('FORBIDDEN'));
  await assert.rejects(service.request(two.credential,input),code('NOT_FOUND'));
  const bypass=await fetch(local.API_URL+'/rest/v1/rpc/fmat_photon_contact',{method:'POST',headers:{apikey:local.ANON_KEY,authorization:'Bearer '+one.token,'content-type':'application/json'},body:JSON.stringify({p_operation:'request',p_credential:one.credential,p_project_id:project,p_input:input})});assert.equal(bypass.status,403);
  let deniedCalls=0;
  const preview=new HostContactSharing({async rpc(){deniedCalls++;throw Error('must not access database');}},{...env,VERCEL:'1',VERCEL_ENV:'preview'});
  await assert.rejects(preview.request(one.credential,input),code('CONFIGURATION_UNAVAILABLE'));assert.equal(deniedCalls,0);
  assert.equal(await service.read(one.credential,{linkId:one.link}),null);
  const states=await Promise.all(Array.from({length:12},(_,n)=>service.request(one.credential,n<6?input:{...input,idempotencyKey:randomUUID()})));
  assert.ok(states.every(s=>s.id===states[0].id&&s.status==='queued'));
  assert.equal(await sql.query(`select count(*) from fmat.photon_contact_shares where project_id='${project}';`),'1');
  assert.equal(await sql.query(`select count(*) from fmat.audit_events where operation='photon_contact_requested' and subject_id='${states[0].id}';`),'1');
  const lose=new Database(env,async(...args)=>{
   const response=await fetch(...args);if(String(args[0]).endsWith('/fmat_photon_contact')){assert.equal(response.status,200);await response.text();throw Error('synthetic lost committed response');}return response;
  });
  await assert.rejects(new HostContactSharing(lose,env).request(one.credential,input),code('PROVIDER_UNAVAILABLE'));
  assert.equal((await service.request(one.credential,input)).id,states[0].id);
  const claims=await Promise.all(Array.from({length:8},()=>delivery('claim'))),claimed=claims.filter(c=>c.action==='send');assert.equal(claimed.length,1);
  const first=claimed[0];await sql.query(`update fmat.photon_contact_shares set lease_until=clock_timestamp()-interval '1 second' where id='${first.shareId}';`);
  const recovered=await delivery('claim');assert.equal(recovered.action,'send');assert.notEqual(first.leaseToken,recovered.leaseToken);
  await assert.rejects(delivery('dispatch',lease(first)),code('STALE_REVISION'));
  const lostDispatch=new Database(env,async(...args)=>{const response=await fetch(...args);assert.equal(response.status,200);await response.text();throw Error('synthetic lost durable dispatch response');});
  await assert.rejects(lostDispatch.rpc('fmat_photon_contact_delivery',{p_operation:'dispatch',p_project_id:project,p_input:lease(recovered)}),code('PROVIDER_UNAVAILABLE'));
  await assert.rejects(delivery('dispatch',lease(recovered)),code('STALE_REVISION'));
  await sql.query(`update fmat.photon_contact_shares set lease_until=clock_timestamp()-interval '1 second' where id='${first.shareId}';`);
  assert.equal((await delivery('claim')).action,'uncertain');assert.equal((await delivery('claim')).action,'idle');
  assert.equal((await service.read(one.credential,{linkId:one.link}))?.status,'uncertain');

  await service.request(two.credential,{linkId:two.link,idempotencyKey:randomUUID()});const next=await delivery('claim');assert.equal(next.action,'send');
  assert.equal(two.credential.kind,'host');if(two.credential.kind!=='host')throw Error('fixture');
  // Observe a real lock wait, then let the persisted Auth session expire while
  // the waiter is blocked. Dispatch must use wall-clock time after the wait.
  const pid=Number((await holder.query(`begin;select pg_backend_pid();select id from fmat.hosts where id='${two.id}' for update;update auth.sessions set not_after=clock_timestamp()+interval '500 milliseconds' where id='${two.credential.sessionId}';`)).split('\n')[0]);
  const pending=delivery('dispatch',lease(next));let observed=false;
  for(let i=0;i<100;i++){observed=await sql.query(`select exists(select 1 from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)));`)==='t';if(observed)break;await delay(20);}
  assert.equal(observed,true);await delay(600);await holder.query('commit;');assert.deepEqual(await pending,{authorized:false});
  assert.equal(await sql.query(`select status from fmat.photon_contact_shares where id='${next.shareId}';`),'revoked');
  assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where host_id in ('${one.id}','${two.id}');`),'0');
 }finally{
  await holder.query('rollback;');
  await sql.query(`delete from fmat.audit_events where subject_id in(select id::text from fmat.photon_contact_shares where project_id='${project}');delete from fmat.photon_contact_shares where project_id='${project}';delete from fmat.photon_links where project_id='${project}';delete from fmat.photon_link_challenges where project_id='${project}';delete from fmat.photon_receivers where project_id='${project}';`);
  for(const u of users){await sql.query(`delete from fmat.hosts where id='${u.id}';delete from fmat.invitations where id='${u.invitation}';`);assert.equal((await fetch(local.API_URL+'/auth/v1/admin/users/'+u.id,{method:'DELETE',headers})).status,200);}
  sql.close();holder.close();
 }
});

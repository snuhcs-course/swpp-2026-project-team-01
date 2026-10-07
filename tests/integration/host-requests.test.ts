import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {HostRequests} from '../../lib/server/identity/host-requests.ts';
import {Database} from '../../lib/server/database/client.ts';
import {verifyHostToken,guestCredential,type Credential} from '../../lib/server/identity/credentials.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';
const code=(value:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===value;
test('host navigation bounds and redacts lists, scopes selected requests, and rechecks admission and Auth',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY};
 const headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'},sql=new LocalSql();
 const database=new Database(env),service=new HostRequests(database),hosts:{id:string;invitation:string;token:string;credential:Credential}[]=[];
 try{
  for(let n=0;n<2;n++){
   const email=randomUUID()+'@example.test',password=randomUUID()+randomUUID(),invitation=randomUUID();
   const create=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(create.status,200);const id=(await create.json()).id;
   const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);const token=(await login.json()).access_token,credential=await verifyHostToken(token,{env});hosts.push({id,invitation,token,credential});
   await assert.rejects(service.list(credential,{}),code('HOST_NOT_ADMITTED'));
   await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${email}','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','navigation-test');insert into fmat.hosts(id,email,invitation_id) values('${id}','${email}','${invitation}');`);
   assert.deepEqual(await service.list(credential,{}),{requests:[],nextCursor:null});
   await sql.query(`insert into fmat.requests(host_id,details,token_hash,expires_at,created_at,private_notes,private_scheduling_context) select '${id}',jsonb_build_object('requesterName','Person '||n,'requesterEmail','hidden@example.test','purpose',case when n=1 then 'Literal 100% _ 연구' else 'Meeting '||n end),encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),now()+interval '1 day',now()-interval '1 minute','PRIVATE NOTES','{"secret":"PRIVATE RULE"}' from generate_series(1,35) n;`);
  }
  const [a,b]=hosts,first=await service.list(a.credential,{});assert.equal(first.requests.length,30);assert.ok(first.nextCursor);
  assert.deepEqual(Object.keys(first.requests[0]).sort(),['closed','createdAt','proposalVersion','requestId','requesterName','revision','status','title','updatedAt']);
  assert.ok(!JSON.stringify(first).includes('PRIVATE'));assert.ok(!JSON.stringify(first).includes('hidden@example.test'));
  const second=await service.list(a.credential,{...first.nextCursor});assert.equal(second.requests.length,5);assert.equal(second.nextCursor,null);
  assert.equal(new Set([...first.requests,...second.requests].map(row=>row.requestId)).size,35);
  const other=(await service.list(b.credential,{})).requests[0];await assert.rejects(service.read(a.credential,{requestId:other.requestId}),code('NOT_FOUND'));await assert.rejects(service.read(a.credential,{requestId:randomUUID()}),code('NOT_FOUND'));
  const tampered=await service.list(a.credential,{beforeId:other.requestId,beforeCreatedAt:other.createdAt});assert.ok(tampered.requests.every(row=>row.requestId!==other.requestId));
  const match=await service.list(a.credential,{search:'100% _ 연구'});assert.equal(match.requests.length,1);assert.equal((await service.list(a.credential,{search:'PERSON'})).requests.length,30);assert.equal((await service.list(a.credential,{search:'absent'})).requests.length,0);
  const id=first.requests[0].requestId;assert.deepEqual(await service.read(a.credential,{requestId:id}),first.requests[0]);
  await sql.query(`update fmat.requests set expires_at=now()-interval '1 second' where id='${id}';`);
  assert.equal((await service.read(a.credential,{requestId:id})).status,'expired');assert.equal((await service.list(a.credential,{status:'closed'})).requests.length,1);
  await sql.query(`update fmat.requests set status='booking' where id='${id}';`);
  assert.equal((await service.read(a.credential,{requestId:id})).closed,false);assert.equal((await service.list(a.credential,{status:'closed'})).requests.length,0);
  await sql.query(`update fmat.requests set status='withdrawn' where id='${id}';`);
  assert.equal((await service.read(a.credential,{requestId:id})).closed,true);assert.equal((await service.list(a.credential,{status:'closed'})).requests[0].requestId,id);
  await assert.rejects(service.list(a.credential,{beforeId:id}));await assert.rejects(service.list(a.credential,{status:'arbitrary'}));await assert.rejects(service.list(a.credential,{search:'x'.repeat(201)}));await assert.rejects(service.list(a.credential,{hostId:b.id}));
  await assert.rejects(service.list({...a.credential},{}),code('UNAUTHORIZED'));await assert.rejects(service.list(guestCredential(id,randomBytes(32).toString('base64url')),{}),code('FORBIDDEN'));
  for(const token of [local.ANON_KEY,a.token]){const bypass=await fetch(local.API_URL+'/rest/v1/rpc/fmat_host_requests',{method:'POST',headers:{apikey:local.ANON_KEY,authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({p_operation:'list',p_credential:a.credential,p_input:{}})});assert.ok([401,403].includes(bypass.status));}
  await sql.query(`update fmat.hosts set revoked_at=now() where id='${a.id}';`);await assert.rejects(service.list(a.credential,{}),code('HOST_NOT_ADMITTED'));await assert.rejects(service.read(a.credential,{requestId:id}),code('HOST_NOT_ADMITTED'));
  await sql.query(`update fmat.hosts set revoked_at=null where id='${a.id}';`);
  assert.equal((await fetch(local.API_URL+'/auth/v1/logout?scope=global',{method:'POST',headers:{apikey:local.ANON_KEY,authorization:'Bearer '+a.token}})).status,204);
  await assert.rejects(service.list(a.credential,{}),code('UNAUTHORIZED'));await assert.rejects(service.read(a.credential,{requestId:id}),code('UNAUTHORIZED'));
 }finally{
  for(const host of hosts){await sql.query(`delete from fmat.requests where host_id='${host.id}';delete from fmat.hosts where id='${host.id}';delete from fmat.invitations where id='${host.invitation}';`);assert.equal((await fetch(local.API_URL+'/auth/v1/admin/users/'+host.id,{method:'DELETE',headers})).status,200);}sql.close();
 }
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Database} from '../../lib/server/database/client.ts';
import {verifyHostToken,guestCredential,type Credential} from '../../lib/server/identity/credentials.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {HostIMessage} from '../../lib/server/photon/linking.ts';
import {PhotonTransport,type PhotonClient} from '../../lib/server/photon/transport.ts';
import {dispatchLinkCodes} from '../../lib/server/photon/delivery.ts';
import {browserProof} from '../../lib/server/photon/proof.ts';
import {LocalSql} from './local-sql.ts';
const code=(value:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===value;
test('real Auth and durable Photon linking survive replay, lost sends, competing ownership and preflight logout',{timeout:60_000},async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const project=randomUUID(),env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),PHOTON_PROJECT_ID:project,PHOTON_PROJECT_SECRET:'fixture'};
 const headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 const sql=new LocalSql(),holder=new LocalSql(),database=new Database(env),users:{id:string;invitation:string;token:string;credential:Credential;browser:string}[]=[];
 const sent=new Map<string,{code:string;phone:string}>();let sends=0,lose=false,preflight:()=>Promise<void>=async()=>{};
 const client:PhotonClient={chats:{async shareContactInfo(){throw new Error('Unexpected contact share');}},addresses:{async isIMessageAvailable(){await preflight();return true;}},messages:{async sendText(space,text,options){
  sends++;assert.ok(options?.clientMessageId);const found=text.match(/code is (\d{6})/u);assert.ok(found);sent.set(options.clientMessageId,{code:found[1],phone:String(space).split(';')[2]});
  if(lose)throw new Error('Synthetic lost response after provider commit');
  return {guid:'message:'+options.clientMessageId,chatGuids:[String(space)],isFromMe:true,isDelivered:false,sendErrorCode:0} as unknown as Awaited<ReturnType<PhotonClient['messages']['sendText']>>;
 },async get(){throw new Error('synthetic read outage');}},async close(){}};
 const transport=new PhotonTransport(env,async()=>Response.json({succeed:true,data:{type:'shared',token:'fixture',expiresIn:300}}),()=>client);
 const service=new HostIMessage(database,env,transport);
 const age=(id:string)=>sql.query(`update fmat.photon_link_challenges set created_at=created_at-interval '61 seconds',expires_at=expires_at-interval '61 seconds' where host_id='${id}';`);
 try{
  await sql.query(`insert into fmat.photon_receivers(project_id,receiver_id,enabled) values('${project}','${randomUUID()}',true);`);
  for(let n=0;n<3;n++){
   const email=randomUUID()+'@example.test',password=randomUUID()+randomUUID(),invitation=randomUUID();
   const created=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);const id=(await created.json()).id;
   const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);const token=(await login.json()).access_token;
   users.push({id,invitation,token,credential:await verifyHostToken(token,{env}),browser:browserProof()});
   await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${email}','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','photon-test');insert into fmat.hosts(id,email,invitation_id) values('${id}','${email}','${invitation}');`);
  }
  const [one,two,three]=users,phone='+155501'+String(Math.floor(Math.random()*9000)+1000),input={phone,idempotencyKey:randomUUID()};
  await assert.rejects(service.read(guestCredential(randomUUID(),browserProof())),code('FORBIDDEN'));
  await assert.rejects(service.read({...one.credential}),code('UNAUTHORIZED'));
  const states=await Promise.all(Array.from({length:8},()=>service.start(one.credential,one.browser,input)));
  const challenge=states[0].challenge!.id;assert.ok(states.every(s=>s.challenge?.id===challenge));
  assert.equal(await sql.query(`select count(*) from fmat.photon_link_challenges where project_id='${project}';`),'1');
  assert.equal((await service.read(one.credential,browserProof())).challenge?.sameBrowser,false);
  assert.ok(!JSON.stringify(states).includes(phone));assert.equal(sends,0);
  // Two workers race for one durable intent. A lost provider response preserves
  // uncertainty; a later worker may only reconcile, never send another identity.
  lose=true;const dispatched=await Promise.all([dispatchLinkCodes(database,env,transport),dispatchLinkCodes(database,env,transport)]);
  assert.equal(dispatched.reduce((n,r)=>n+r.claimed,0),1);assert.equal(sends,1);assert.equal(sent.get(challenge)?.phone,phone);
  await sql.query(`update fmat.photon_link_challenges set checked_at=now()-interval '1 minute' where id='${challenge}';`);
  await dispatchLinkCodes(database,env,transport);assert.equal(sends,1);
  const verify={challengeId:challenge,code:sent.get(challenge)!.code,idempotencyKey:randomUUID()};
  await assert.rejects(service.verify(one.credential,browserProof(),verify),code('CHALLENGE_INVALID'));
  await assert.rejects(service.verify(two.credential,two.browser,verify),code('CHALLENGE_INVALID'));
  const wrong={...verify,code:verify.code==='000000'?'111111':'000000',idempotencyKey:randomUUID()};
  assert.equal((await service.verify(one.credential,one.browser,wrong)).outcome,'invalid_code');
  assert.equal((await service.verify(one.credential,one.browser,wrong)).challenge?.remainingAttempts,4);
  const lostDatabase=new Database(env,async(...args)=>{const response=await fetch(...args);if(String(args[0]).endsWith('/fmat_photon_link')&&JSON.parse(String(args[1]?.body)).p_operation==='verify'){assert.equal(response.status,200);await response.text();throw new Error('Synthetic lost verification response');}return response;});
  await assert.rejects(new HostIMessage(lostDatabase,env,transport).verify(one.credential,one.browser,verify),code('PROVIDER_UNAVAILABLE'));
  const linked=await service.verify(one.credential,one.browser,verify);assert.equal(linked.outcome,'linked');assert.ok(linked.link);
  await service.unlink(one.credential,one.browser,{linkId:linked.link.id});await assert.rejects(service.verify(one.credential,one.browser,verify),code('CHALLENGE_INVALID'));
  // Two signed-in hosts can prove the same number, but exactly one wins its
  // current ownership. Unique constraints plus a shared recipient lock fence it.
  await age(one.id);lose=false;
  const first=await service.start(one.credential,one.browser,{phone,idempotencyKey:randomUUID()});await age(one.id);
  const second=await service.start(two.credential,two.browser,{phone,idempotencyKey:randomUUID()});
  await dispatchLinkCodes(database,env,transport);
  const competing=await Promise.allSettled([[one,first],[two,second]].map(async([u,s])=>{
   const user=u as typeof one,state=s as typeof first,id=state.challenge!.id;return service.verify(user.credential,user.browser,{challengeId:id,code:sent.get(id)!.code,idempotencyKey:randomUUID()});
  }));
  assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);assert.equal(competing.filter(r=>r.status==='rejected'&&code('LINK_CONFLICT')(r.reason)).length,1);
  const winner=competing[0].status==='fulfilled'?one:two;
  // A stale unlink identity cannot revoke a later link.
  await service.unlink(one.credential,one.browser,{linkId:linked.link.id});assert.ok((await service.read(winner.credential)).link);
  // Cancel during token/address preflight must win before the provider send.
  const otherPhone=phone.slice(0,-1)+(phone.endsWith('9')?'0':String(Number(phone.at(-1))+1));
  const pending=await service.start(three.credential,three.browser,{phone:otherPhone,idempotencyKey:randomUUID()});
  let entered!:()=>void,release!:()=>void;const arrived=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  preflight=async()=>{entered();await gate;};const before=sends,worker=dispatchLinkCodes(database,env,transport);await arrived;
  const logout=await fetch(local.API_URL+'/auth/v1/logout?scope=global',{method:'POST',headers:{apikey:local.ANON_KEY,authorization:'Bearer '+three.token}});assert.equal(logout.status,204);
  release();await worker;assert.equal(sends,before);assert.ok(!sent.has(pending.challenge!.id));
  await assert.rejects(service.read(three.credential),code('UNAUTHORIZED'));
  // Verify the database actually waits on a host lock, then observes revoked
  // session state when the lock holder commits.
  const pid=await holder.query(`begin;select pg_backend_pid();select id from fmat.hosts where id='${winner.id}' for update;`);
  const waitingRead=service.read(winner.credential);const rejection=assert.rejects(waitingRead,code('UNAUTHORIZED'));let observed=false;
  for(let i=0;i<100;i++){observed=await sql.query(`select exists(select 1 from pg_stat_activity where ${Number(pid.split('\n')[0])}=any(pg_blocking_pids(pid)));`)==='t';if(observed)break;await delay(20);}
  assert.equal(observed,true);await holder.query(`delete from auth.sessions where user_id='${winner.id}';commit;`);await rejection;
  assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where host_id in (${users.map(u=>`'${u.id}'`).join(',')});`),'0');
 }finally{
  await holder.query('rollback;');
  await sql.query(`delete from fmat.audit_events where actor->>'id' in (${users.map(u=>`'${u.id}'`).join(',')||"''"});delete from fmat.photon_links where project_id='${project}';delete from fmat.photon_link_challenges where project_id='${project}';delete from fmat.photon_receivers where project_id='${project}';`);
  for(const u of users){await sql.query(`delete from fmat.hosts where id='${u.id}';delete from fmat.invitations where id='${u.invitation}';`);assert.equal((await fetch(local.API_URL+'/auth/v1/admin/users/'+u.id,{method:'DELETE',headers})).status,200);}
  sql.close();holder.close();
 }
});

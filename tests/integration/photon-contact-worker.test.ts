import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,execFile,fork} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {Database} from '../../lib/server/database/client.ts';
import {verifyHostToken} from '../../lib/server/identity/credentials.ts';
import {HostContactSharing} from '../../lib/server/photon/contact-sharing.ts';
import {HostIMessage} from '../../lib/server/photon/linking.ts';
import {dispatchContactShares} from '../../lib/server/photon/contact-delivery.ts';
import {PhotonTransport,type PhotonClient} from '../../lib/server/photon/transport.ts';
import {contactSnapshot} from '../../lib/contracts/contact-diagnostics.ts';
import {LocalSql} from './local-sql.ts';

test('native contact worker recovers lost wakeup and process kills without duplicate sharing',{timeout:60000},async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.equal(new URL(local.API_URL).hostname,'127.0.0.1');
 const project=randomUUID(),env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,PHOTON_PROJECT_ID:project,PHOTON_PROJECT_SECRET:'synthetic'};
 const headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'},sql=new LocalSql(),database=new Database(env),service=new HostContactSharing(database,env);
 const invitation=randomUUID(),email=randomUUID()+'@example.test',password=randomUUID()+randomUUID();let userId:string|undefined,providerCalls=0;
 const provider=createServer((req,res)=>{assert.equal(req.method,'POST');providerCalls++;res.end('{}');});await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));const address=provider.address();assert.ok(address&&typeof address==='object');const port=address.port;
 async function child(point=''){
  const child=fork(new URL('./contact-crash-child.ts',import.meta.url),[],{execArgv:['--import','tsx'],env:{PATH:process.env.PATH,...env,FMAT_CONTACT_PROVIDER:'http://127.0.0.1:'+port,FMAT_CONTACT_CRASH:point},stdio:['ignore','ignore','pipe','ipc']});
  child.stderr?.resume();let fault='',result:unknown;
  child.on('message',(message:any)=>{if(message.fault)fault=message.fault;if(message.result)result=message.result;});
  const exit=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Contact child timed out'));},15000);child.once('error',e=>{clearTimeout(timeout);reject(e);});child.once('exit',(code,signal)=>{clearTimeout(timeout);resolve({code,signal});});});
  if(point){assert.equal(fault,point);assert.equal(exit.signal,'SIGKILL');assert.equal(result,undefined);}else assert.equal(exit.code,0);
  return result;
 }
 try{
  const created=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);userId=(await created.json()).id;assert.ok(userId);
  const login=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:local.ANON_KEY,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);const credential=await verifyHostToken((await login.json()).access_token,{env});
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${email}','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','contact-worker-test');insert into fmat.hosts(id,email,invitation_id) values('${userId}','${email}','${invitation}');insert into fmat.photon_receivers values('${project}','${randomUUID()}',true,now());`);
  async function createIntent(){
   const link=randomUUID(),challenge=randomUUID(),phone='+15550400001';
   await sql.query(`update fmat.photon_links set revoked_at=clock_timestamp() where host_id='${userId}' and revoked_at is null;
    insert into fmat.photon_link_challenges(id,host_id,project_id,credential,browser_hash,phone,line,space_id,code_hash,request_key,consumed_at,delivery_status)
    values('${challenge}','${userId}','${project}','${JSON.stringify(credential)}',repeat('b',64),'${phone}','shared','any;-;${phone}',repeat('c',64),'${randomUUID()}',now(),'accepted');
    insert into fmat.photon_links(id,host_id,project_id,phone,line,space_id,challenge_id) values('${link}','${userId}','${project}','${phone}','shared','any;-;${phone}','${challenge}');`);
   return service.request(credential,{linkId:link,idempotencyKey:randomUUID()});
  }
  for(const point of ['', 'after:claim','after:dispatch','after:provider','after:finish']){
   const intent=await createIntent(),before=providerCalls;
   // Omit any immediate wakeup; restart/scheduled invocation must discover it.
   await child(point);
   if(point){await sql.query(`update fmat.photon_contact_shares set lease_until=case when lease_token is null then null else clock_timestamp()-interval '1 second' end where id='${intent.id}';`);await child();}
   const expected=['after:dispatch','after:provider'].includes(point)?'uncertain':'accepted';
   assert.equal((await service.read(credential,{linkId:intent.linkId}))?.status,expected);
   assert.equal(providerCalls-before,point==='after:dispatch'?0:1);
   await child();assert.equal(providerCalls-before,point==='after:dispatch'?0:1,'repeated recovery must not share again');
  }
  // Use the actual transport for revocation during its address preflight.
  const intent=await createIntent();let entered!:()=>void,release!:()=>void,nativeCalls=0;
  const arrived=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  const client:PhotonClient={chats:{async shareContactInfo(){nativeCalls++;}},messages:{async sendText(){throw Error('No text send');},async get(){throw Error('No reconciliation');}},addresses:{async isIMessageAvailable(){entered();await gate;return true;}},async close(){}};
  const transport=new PhotonTransport(env,async()=>Response.json({succeed:true,data:{type:'shared',token:'synthetic',expiresIn:300}}),()=>client);
  const running=dispatchContactShares(database,env,transport);await arrived;
  try{await new HostIMessage(database,env).unlink(credential,undefined,{linkId:intent.linkId});}finally{release();}await running;
  assert.equal(nativeCalls,0);assert.equal(await sql.query(`select status from fmat.photon_contact_shares where id='${intent.id}';`),'revoked');
  const pending=await createIntent();await sql.query(`update fmat.photon_contact_shares set created_at=clock_timestamp()-interval '6 minutes' where id='${pending.id}';`);
  // Actual operator CLI must be read-only and exclude all stored secrets/routes.
  const before=await sql.query(`select md5(string_agg(to_jsonb(s)::text,'' order by id)) from fmat.photon_contact_shares s where project_id='${project}';`);
  for(const limit of [0,20]){
   const out=await promisify(execFile)(process.execPath,['--import','tsx','scripts/diagnostics.ts','--project','local','--contacts','--samples',String(limit)],{env:{PATH:process.env.PATH,...env},timeout:10000});
   const {project:target,...snapshot}=JSON.parse(out.stdout);assert.equal(target,'local');contactSnapshot.parse(snapshot);assert.ok(!out.stdout.includes('+15550400001'));assert.ok(!out.stdout.includes(local.SERVICE_ROLE_KEY));assert.ok(!out.stdout.includes('sessionId'));
   assert.equal(snapshot.signals[0].count,1);assert.equal(snapshot.signals[2].count,2);assert.equal(snapshot.signals[0].samples.length,Math.min(1,limit));
  }
  assert.equal(await sql.query(`select md5(string_agg(to_jsonb(s)::text,'' order by id)) from fmat.photon_contact_shares s where project_id='${project}';`),before);
 }finally{
  provider.close();provider.closeAllConnections();
  await sql.query(`delete from fmat.audit_events where subject_id in(select id::text from fmat.photon_contact_shares where project_id='${project}')${userId?` or actor->>'id'='${userId}'`:''};delete from fmat.photon_contact_shares where project_id='${project}';delete from fmat.photon_links where project_id='${project}';delete from fmat.photon_link_challenges where project_id='${project}';delete from fmat.photon_receivers where project_id='${project}';`);
  if(userId){await sql.query(`delete from fmat.hosts where id='${userId}';delete from fmat.invitations where id='${invitation}';`);assert.equal((await fetch(local.API_URL+'/auth/v1/admin/users/'+userId,{method:'DELETE',headers})).status,200);}sql.close();
 }
});

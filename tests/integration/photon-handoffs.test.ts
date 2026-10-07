import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {Database} from '../../lib/server/database/client.ts';
import {PhotonHandoffs} from '../../lib/server/photon/handoffs.ts';
import {photonWebhook} from '../../lib/server/photon/webhook.ts';
import {LocalSql} from './local-sql.ts';

test('private unlinked handoff freezes one token and survives lost acknowledgments without granting host access',{timeout:45_000},async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const project=randomUUID(),receiver=randomUUID(),secret=randomBytes(32).toString('hex'),phone='+155501'+String(Math.floor(Math.random()*9000)+1000);
 const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,PHOTON_PROJECT_ID:project,PHOTON_WEBHOOK_ID:receiver,IMESSAGE_WEBHOOK_SECRET:secret,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_ORIGIN:'https://fixture.invalid'};
 const sql=new LocalSql(),db=new Database(env);let sends=0,reads=0,proof:{handoffId:string;token:string}|undefined;
 const transport={async send(route:{line:string;spaceId:string},recipient:string,text:string,id:string,authorize:()=>Promise<void>){
  await authorize();sends++;assert.deepEqual(route,{line:'shared',spaceId:'any;-;'+phone});assert.equal(recipient,phone);
  assert.ok(!text.includes('untrusted private message'));
  const url=new URL(text.match(/https:\/\/[^\s]+/u)![0]);assert.equal(url.origin,env.APP_ORIGIN);assert.equal(url.pathname,'/app');assert.equal(url.search,'');
  const value=new URLSearchParams(url.hash.slice(1)).get('imessage')!;const [handoffId,token]=value.split('.');assert.equal(handoffId,id);proof={handoffId,token};
  return {status:'accepted' as const,providerReference:'fixture-handoff-guid'};
 },async reconcile(_route:unknown,reference:string|null){reads++;assert.equal(reference,'fixture-handoff-guid');return {status:'delivered' as const,providerReference:reference};}};
 const service=new PhotonHandoffs(db,env,transport);
 async function receive(key:string,number=phone){
  const space={id:'any;-;'+number,platform:'imessage',type:'dm',phone:'shared'},timestamp=String(Math.floor(Date.now()/1000));
  const body=JSON.stringify({event:'messages',space,message:{id:key,platform:'imessage',direction:'inbound',timestamp:new Date().toISOString(),sender:{id:number,platform:'imessage'},space,content:{type:'text',text:'untrusted private message'}}});
  const request=()=>new Request('https://fixture.invalid/api/providers/photon',{method:'POST',body,headers:{'content-type':'application/json','x-spectrum-webhook-id':receiver,'x-spectrum-timestamp':timestamp,'x-spectrum-signature':'v0='+createHmac('sha256',secret).update(`v0:${timestamp}:${body}`).digest('hex')}});
  const responses=await Promise.all(Array.from({length:8},()=>photonWebhook(request(),{env,database:db})));assert.ok(responses.every(r=>r.status===200));
 }
 try{
  await sql.query(`insert into fmat.photon_receivers(project_id,receiver_id,enabled) values('${project}','${receiver}',true);`);
  await receive('first');
  const lostPrepare=new PhotonHandoffs(new Database(env,async(...args)=>{const response=await fetch(...args);assert.equal(response.status,200);await response.text();throw new Error('Synthetic lost commit acknowledgment');}),env,transport);
  await assert.rejects(()=>lostPrepare.prepare());await Promise.all([service.prepare(),service.prepare()]);
  assert.equal(await sql.query(`select count(*) from fmat.photon_handoffs where project_id='${project}';`),'1');
  const lostFinish=new PhotonHandoffs(new Database(env,async(input,init)=>{const response=await fetch(input,init);if(JSON.parse(String(init?.body)).p_operation==='finish'){assert.equal(response.status,200);await response.text();throw new Error('Synthetic lost send acknowledgment');}return response;}),env,transport);
  await Promise.all([lostFinish.dispatch(),lostFinish.dispatch()]);assert.equal(sends,1);assert.ok(proof);
  const metadata=await service.resolve(proof);assert.equal(metadata.phone,phone);assert.deepEqual(Object.keys(metadata).sort(),['expiresAt','handoffId','line','phone','spaceId']);
  const stored=await sql.query(`select encrypted_token from fmat.photon_handoffs where project_id='${project}';`);assert.ok(!stored.includes(proof.token));
  await assert.rejects(()=>service.resolve({...proof,token:randomBytes(32).toString('base64url')}));
  await sql.query(`update fmat.photon_handoffs set checked_at=clock_timestamp()-interval '31 seconds' where project_id='${project}';`);
  await service.dispatch();assert.equal(sends,1);assert.equal(reads,1);
  assert.equal(await sql.query(`select status||':'||(encrypted_token is null)::text from fmat.photon_handoffs where project_id='${project}';`),'delivered:true');
  await service.resolve(proof);
  await receive('rapid');assert.equal((await service.prepare()).limited,1);
  assert.equal(await sql.query(`select count(*) from fmat.photon_inbox where project_id='${project}' and (link_id is not null or runtime_message_id is not null);`),'0');
  await sql.query(`update fmat.photon_receivers set receiver_id='${randomUUID()}' where project_id='${project}';`);await assert.rejects(()=>service.resolve(proof));
  await sql.query(`update fmat.photon_receivers set receiver_id='${receiver}' where project_id='${project}';`);
  await receive('preflight-revocation',phone.replace('+155501','+155502'));await service.prepare();
  const revoked=new PhotonHandoffs(db,env,{async send(_route,_phone,_text,_id,authorize){
   await sql.query(`update fmat.photon_receivers set enabled=false where project_id='${project}';`);
   await authorize();assert.fail('disabled receiver reached provider send');
  },async reconcile(){assert.fail('prepared handoff should enter send preflight');}});
  assert.deepEqual(await revoked.dispatch(),{claimed:1,suppressed:0,recorded:1});
  assert.equal(await sql.query(`select h.revoked_at is not null and h.encrypted_token is null from fmat.photon_handoffs h join fmat.photon_inbox i on i.id=h.inbox_id where i.project_id='${project}' and i.message_id='preflight-revocation';`),'t');
 }finally{
  await sql.query(`delete from fmat.queue_publications p using fmat.jobs j,fmat.photon_inbox i where p.job_id=j.id and j.payload->>'inboxId'=i.id::text and i.project_id='${project}';delete from pgmq.q_fmat_jobs q using fmat.jobs j,fmat.photon_inbox i where q.message->>'jobId'=j.id::text and j.payload->>'inboxId'=i.id::text and i.project_id='${project}';delete from fmat.jobs j using fmat.photon_inbox i where j.payload->>'inboxId'=i.id::text and i.project_id='${project}';delete from fmat.photon_handoffs where project_id='${project}';delete from fmat.photon_inbox where project_id='${project}';delete from fmat.photon_receivers where project_id='${project}';`);sql.close();
 }
});

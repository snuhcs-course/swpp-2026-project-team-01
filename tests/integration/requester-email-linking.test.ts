import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash,generateKeyPairSync,sign} from 'node:crypto';
import {RequesterEmailLinking} from '../../lib/server/agentmail/linking.ts';
import {AgentMailMessages} from '../../lib/server/agentmail/messages.ts';
import {verifyAgentMailAuthor} from '../../lib/server/agentmail/author.ts';
import {Database} from '../../lib/server/database/client.ts';
import {guestCredential} from '../../lib/server/identity/credentials.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';
const code=(value:string)=>(e:unknown)=>e instanceof ApplicationError&&e.code===value;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
test('Requester email linking preserves current authority across retries, signed forwarding, rotation and delayed receipts',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const inbox=randomUUID()+'@example.test',receiver=randomUUID(),env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,AGENTMAIL_API_KEY:"fixture-key",AGENTMAIL_INBOX_ID:inbox,AGENTMAIL_RECEIVER_ID:receiver,TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,23).toString('base64')};
 const db=new Database(env),sql=new LocalSql(),host=randomUUID(),invite=randomUUID(),requests:string[]=[];
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),dnsRecord='v=DKIM1; k=rsa; p='+publicKey.export({format:'der',type:'spki'}).toString('base64');
 const messages=new Map<string,{json:Record<string,unknown>;raw:Buffer}>();
 const providers={messages:new AgentMailMessages(env,async url=>{const id=decodeURIComponent(new URL(String(url)).pathname.split('/').at(-1)!);return Response.json(messages.get(id)!.json);}),raw:async(input:{messageId:string})=>messages.get(input.messageId)!.raw,author:(raw:Buffer,expected:{senderClaim:string;messageId:string})=>verifyAgentMailAuthor(raw,expected,{resolver:async()=>[[dnsRecord]]})};
 const service=new RequesterEmailLinking(db,env,providers);
 async function request(verified=true){const id=randomUUID(),token=randomBytes(32).toString('base64url');requests.push(id);await sql.query(`insert into fmat.requests(id,host_id,details,token_hash,contact_verified_email,expires_at) values('${id}','${host}','{"requesterEmail":"guest@example.test"}','${sha(token)}',${verified?"'guest@example.test'":'null'},clock_timestamp()+interval '1 day');`);return {id,token,guest:guestCredential(id,token)};}
 async function receipt(text:string,thread=randomUUID(),sender='guest@example.test'){
  const id='<'+randomUUID()+'@example.test>',timestamp=new Date().toISOString(),body=text+'\r\n',from='From: '+sender,mid='Message-ID: '+id;
  const unsigned=`DKIM-Signature: v=1; a=rsa-sha256; c=simple/simple; d=example.test; s=fixture; h=from:message-id; bh=${createHash('sha256').update(body).digest('base64')}; b=`;
  const sig=sign('RSA-SHA256',Buffer.from(from+'\r\n'+mid+'\r\n'+unsigned),privateKey).toString('base64');
  const raw=Buffer.from(unsigned+sig+'\r\n'+from+'\r\n'+mid+'\r\n\r\n'+body);
  messages.set(id,{raw,json:{inbox_id:inbox,thread_id:thread,message_id:id,timestamp,labels:['received'],from:sender,to:[inbox],text,extracted_text:text}});
  const saved=await db.rpc('fmat_agentmail_ingress',{p_receiver_id:receiver,p_inbox_id:inbox,p_input:{deliveryId:randomUUID(),eventId:randomUUID(),inboxId:inbox,threadId:thread,messageId:id,occurredAt:timestamp,payloadHash:sha(raw.toString())}}) as {receiptId:string};
  return {id:saved.receiptId,messageId:id,thread};
 }
 const start=(r:Awaited<ReturnType<typeof request>>,key=randomUUID())=>service.start(r.guest,{requestId:r.id,revision:1,idempotencyKey:key});
 async function cool(id:string){await sql.query(`update fmat.requester_email_links set created_at=created_at-interval '61 seconds' where request_id='${id}';`);}
 try{
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invite}','host@example.test','${sha(invite)}',now()+interval '1 day','email-link-fixture');insert into fmat.hosts(id,email,invitation_id) values('${host}','host@example.test','${invite}');insert into fmat.agentmail_receivers(inbox_id,receiver_id,enabled) values('${inbox}','${receiver}',true);`);
  const unverified=await request(false);await assert.rejects(start(unverified),code('CONTACT_NOT_VERIFIED'));
  const r=await request(),key=randomUUID(),starts=await Promise.all(Array.from({length:8},()=>start(r,key))),link=starts[0];
  assert.ok(starts.every(x=>x.linkId===link.linkId&&x.linkingText===link.linkingText));assert.equal(link.status,'pending');assert.ok(link.linkingText);assert.equal(await sql.query(`select count(*) from fmat.requester_email_links where request_id='${r.id}';`),'1');
  await assert.rejects(start(r),code('EMAIL_LINK_LIMIT'));await assert.rejects(service.read({...r.guest},{requestId:r.id}),code('UNAUTHORIZED'));
  const before=await receipt('Earlier message'),bind=await receipt(link.linkingText!,before.thread),forward=await receipt(link.linkingText!,randomUUID(),'other@example.test');
  await assert.rejects(service.bind(forward.id),code('NOT_FOUND'));
  const bound=await Promise.all(Array.from({length:8},()=>service.bind(bind.id)));assert.ok(bound.every(x=>x.linkId===link.linkId));
  assert.equal((await service.read(r.guest,{requestId:r.id})).linkingText,null);assert.equal(await sql.query(`select encrypted_proof is null from fmat.requester_email_links where id='${link.linkId}';`),'t');
  assert.equal(await sql.query(`select count(*) from fmat.requester_email_evidence where link_id='${link.linkId}';`),'1');
  await assert.rejects(service.authorize(before.id),code('NOT_FOUND'));await assert.rejects(service.authorize(bind.id),code('INVALID_INPUT'));
  const retryInDifferentThread=await receipt(link.linkingText!);await assert.rejects(service.bind(retryInDifferentThread.id),code('IDEMPOTENCY_CONFLICT'));
  const next=await receipt('A new request detail',bind.thread),authorized=await service.authorize(next.id);assert.equal(authorized.requestId,r.id);assert.equal('tokenHash' in authorized,false);assert.equal(authorized.text,'A new request detail');assert.deepEqual(await service.authorize(next.id),authorized);
  const wrong=await receipt('Wrong sender',bind.thread,'other@example.test');await assert.rejects(service.authorize(wrong.id),code('NOT_FOUND'));
  const unknown=await receipt('Unknown thread');await assert.rejects(service.authorize(unknown.id),code('NOT_FOUND'));
  const other=await request(),otherLink=await start(other),cross=await receipt(otherLink.linkingText!,bind.thread);await assert.rejects(service.bind(cross.id),code('EMAIL_LINK_CONFLICT'));assert.equal((await service.read(other.guest,{requestId:other.id})).status,'pending');
  await sql.query(`update fmat.requests set details=details||'{"purpose":"New purpose"}',revision=revision+1 where id='${r.id}';`);assert.equal((await service.authorize(next.id)).requestId,r.id);
  await sql.query(`update fmat.requests set details=details||'{"requesterEmail":"changed@example.test"}',contact_verified_email='changed@example.test' where id='${r.id}';update fmat.requests set details=details||'{"requesterEmail":"guest@example.test"}',contact_verified_email='guest@example.test' where id='${r.id}';`);
  assert.equal((await service.read(r.guest,{requestId:r.id})).status,'revoked');await assert.rejects(service.authorize(next.id),code('NOT_FOUND'));await assert.rejects(service.bind(bind.id),code('NOT_FOUND'));
  // Lost start and bind responses recover the same committed operation, including its proof.
  const lostRequest=await request(),lostKey=randomUUID();let dropped=false;
  const lostDb=new Database(env,async(url,init)=>{const response=await fetch(url,init);if(response.ok&&!dropped&&JSON.parse(String(init?.body)).p_operation==='start'){dropped=true;throw new Error('lost committed start');}return response;});
  await assert.rejects(new RequesterEmailLinking(lostDb,env,providers).start(lostRequest.guest,{requestId:lostRequest.id,revision:1,idempotencyKey:lostKey}),code('PROVIDER_UNAVAILABLE'));assert.equal(dropped,true);
  const recovered=await start(lostRequest,lostKey),lostReceipt=await receipt(recovered.linkingText!);let lostBind=false;
  const lostBindDb=new Database(env,async(url,init)=>{const response=await fetch(url,init);if(response.ok&&!lostBind&&JSON.parse(String(init?.body)).p_operation==='bind'){lostBind=true;throw new Error('lost committed binding');}return response;});
  await assert.rejects(new RequesterEmailLinking(lostBindDb,env,providers).bind(lostReceipt.id),code('PROVIDER_UNAVAILABLE'));assert.equal(lostBind,true);assert.equal((await service.bind(lostReceipt.id)).linkId,recovered.linkId);
  assert.equal((await service.revoke(lostRequest.guest,{requestId:lostRequest.id,linkId:recovered.linkId})).status,'revoked');await assert.rejects(service.bind(lostReceipt.id),code('NOT_FOUND'));
  for(const change of ['rotation','revocation','closed','expiry','lost_contact']){
   const f=await request(),l=await start(f),b=await receipt(l.linkingText!);await service.bind(b.id);const n=await receipt('next',b.thread);
   const updates:Record<string,string>={rotation:`token_hash='${sha(randomUUID())}'`,revocation:'token_revoked_at=clock_timestamp()',closed:"status='declined'",expiry:"token_expires_at=clock_timestamp()-interval '1 second'",lost_contact:'contact_verified_email=null'};
   await sql.query(`update fmat.requests set ${updates[change]} where id='${f.id}';`);await assert.rejects(service.authorize(n.id),code('NOT_FOUND'));
  }
  // Receiver fencing is rechecked after provider reads; revocation stays available during outages.
  const fenced=await request(),fencedLink=await start(fenced),fencedReceipt=await receipt(fencedLink.linkingText!);
  const raced=new RequesterEmailLinking(db,env,{...providers,raw:async(input:{messageId:string})=>{
   await sql.query(`update fmat.agentmail_receivers set enabled=false where inbox_id='${inbox}';`);
   return providers.raw(input);
  }});
  await assert.rejects(raced.bind(fencedReceipt.id),code('CONFIGURATION_UNAVAILABLE'));
  assert.equal((await service.read(fenced.guest,{requestId:fenced.id})).status,'unavailable');
  assert.equal((await service.revoke(fenced.guest,{requestId:fenced.id,linkId:fencedLink.linkId})).status,'revoked');
  assert.equal((await service.revoke(fenced.guest,{requestId:fenced.id,linkId:fencedLink.linkId})).status,'revoked');
  await sql.query(`update fmat.agentmail_receivers set enabled=true where inbox_id='${inbox}';`);
  const rotatedReceiver=await request(),rotatedLink=await start(rotatedReceiver),rotatedReceipt=await receipt(rotatedLink.linkingText!),nextReceiver=randomUUID();
  await sql.query(`update fmat.agentmail_receivers set receiver_id='${nextReceiver}' where inbox_id='${inbox}';`);
  await assert.rejects(service.bind(rotatedReceipt.id),code('CONFIGURATION_UNAVAILABLE'));
  const replacement=new RequesterEmailLinking(db,{...env,AGENTMAIL_RECEIVER_ID:nextReceiver},providers);
  await assert.rejects(replacement.bind(rotatedReceipt.id),code('NOT_FOUND'));
  assert.equal((await replacement.read(rotatedReceiver.guest,{requestId:rotatedReceiver.id})).status,'unavailable');
  await sql.query(`update fmat.agentmail_receivers set receiver_id='${receiver}' where inbox_id='${inbox}';`);
  // Revocation during a raw-message download cannot be overridden by valid signature evidence.
  const revokedDuringRead=await request(),revokedLink=await start(revokedDuringRead),revokedReceipt=await receipt(revokedLink.linkingText!);
  const revokedReader=new RequesterEmailLinking(db,env,{...providers,raw:async(input:{messageId:string})=>{
   await service.revoke(revokedDuringRead.guest,{requestId:revokedDuringRead.id,linkId:revokedLink.linkId});
   return providers.raw(input);
  }});
  await assert.rejects(revokedReader.bind(revokedReceipt.id),code('NOT_FOUND'));
  const expired=await request(),expiredLink=await start(expired),expiredReceipt=await receipt(expiredLink.linkingText!);await sql.query(`update fmat.requester_email_links set challenge_expires_at=clock_timestamp()-interval '1 second' where id='${expiredLink.linkId}';`);await assert.rejects(service.bind(expiredReceipt.id),code('CHALLENGE_INVALID'));assert.equal((await service.read(expired.guest,{requestId:expired.id})).status,'expired');
  const rate=await request();for(let i=0;i<5;i++){await start(rate);await cool(rate.id);}await assert.rejects(start(rate),code('EMAIL_LINK_LIMIT'));
  for(const role of ['anon','authenticated','service_role'])for(const table of ['requester_email_links','requester_email_evidence'])assert.equal(await sql.query(`select has_table_privilege('${role}','fmat.${table}','select,insert,update,delete');`),'f');
  assert.equal(await sql.query(`select has_function_privilege('anon','public.fmat_requester_email_link(text,jsonb,uuid,text,jsonb)','execute')||','||has_function_privilege('authenticated','public.fmat_requester_email_receipt(text,uuid,text,jsonb)','execute');`),'false,false');
  assert.equal(await sql.query(`select count(*) from fmat.conversation_grants g join fmat.conversation_scopes s on s.id=g.conversation_id where s.request_id in(select id from fmat.requests where host_id='${host}');`),'0');
 }finally{
  await sql.query(`delete from fmat.requester_email_evidence where inbox_id='${inbox}';delete from fmat.requester_email_links where inbox_id='${inbox}';delete from pgmq.q_fmat_jobs where msg_id in(select p.message_id from fmat.queue_publications p join fmat.jobs j on j.id=p.job_id where j.payload->>'receiptId' in(select id::text from fmat.agentmail_inbox where inbox_id='${inbox}'));delete from fmat.queue_publications where job_id in(select id from fmat.jobs where payload->>'receiptId' in(select id::text from fmat.agentmail_inbox where inbox_id='${inbox}'));delete from fmat.jobs where payload->>'receiptId' in(select id::text from fmat.agentmail_inbox where inbox_id='${inbox}');delete from fmat.agentmail_deliveries where inbox_id='${inbox}';delete from fmat.agentmail_inbox where inbox_id='${inbox}';delete from fmat.agentmail_receivers where inbox_id='${inbox}';delete from fmat.requests where host_id='${host}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invite}';`);sql.close();
 }
});

import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Database} from '../../lib/server/database/client.ts';
import {BookingDelivery} from '../../lib/server/email/booking-delivery.ts';
import {CloudflareEmail} from '../../lib/server/email/cloudflare.ts';
import {BookingReceipt,bookingReceiptCredential} from '../../lib/server/booking/receipt.ts';
import {requireCredential} from '../../lib/server/identity/credentials.ts';
import {LocalSql} from './local-sql.ts';

export async function verifyBookingDelivery(database:Database,baseEnv:NodeJS.ProcessEnv,hostId:string){
 const sql=new LocalSql(),env={...baseEnv,APP_ORIGIN:'https://release.findmeatime.com',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_EMAIL_FROM:'no-reply@findmeatime.com',CLOUDFLARE_EMAIL_API_TOKEN:'synthetic'};
 let posts=0,mode='success',activeJob='',duringSend:(()=>Promise<void>)|undefined;
 const messages:{to:string;text:string;html:string}[]=[];
 const provider=new CloudflareEmail(env,async(_url,init)=>{
  posts++;const message=JSON.parse(String(init?.body));messages.push(message);
  assert.equal(await sql.query(`select status from fmat.outbox where id=(select (payload->>'outboxId')::uuid from fmat.jobs where id='${activeJob}');`),'sending');
  if(duringSend)await duringSend();
  if(mode==='expired')await sql.query(`update fmat.jobs set lease_until=clock_timestamp()-interval '1 second' where id='${activeJob}';`);
  if(mode==='lost')throw new Error('provider response lost');
  return Response.json({success:true,errors:[],result:{message_id:'synthetic-'+posts,delivered:[],queued:[message.to],permanent_bounces:mode==='bounce'?[message.to]:[],suppressed_recipients:mode==='suppress'?[message.to]:[]}});
 });
 const worker=(db=database)=>new BookingDelivery(db,env,provider);
 async function own(jobId:string){activeJob=jobId;const lease={workerId:'delivery-fixture-'+randomUUID(),jobId,leaseToken:randomUUID()};await sql.query(`update fmat.jobs set status='running',worker_id='${lease.workerId}',lease_token='${lease.leaseToken}',lease_until=clock_timestamp()+interval '60 seconds' where id='${jobId}';`);return lease;}
 const status=(id:string)=>sql.query(`select status from fmat.outbox where id='${id}';`);
 try{
  const rows: {id:string;requestId:string;audience:string;jobId:string}[]=JSON.parse(await sql.query(`select jsonb_agg(jsonb_build_object('id',o.id,'requestId',r.id,'audience',o.audience,'jobId',j.id) order by r.created_at,r.id,o.audience) from fmat.requests r join fmat.outbox o on o.payload->>'requestId'=r.id::text join fmat.jobs j on j.payload->>'outboxId'=o.id::text where r.host_id='${hostId}' and r.status='booked' and j.kind='delivery';`));
  assert.equal(rows.length,10);
  const original=await sql.query(`select jsonb_agg(jsonb_build_object('id',id,'status',status,'event',event) order by id)::text from fmat.requests where host_id='${hostId}';`);
  const calendarJobs=await sql.query(`select count(*) from fmat.jobs where kind in ('booking','booking_reconcile') and payload->>'requestId' in(select id::text from fmat.requests where host_id='${hostId}');`);
  // A concurrent duplicate must defer while the original sender still owns its lease.
  const first=rows[0],firstLease=await own(first.jobId);
  const duplicate=await sql.query(`select fmat.enqueue_job('delivery','duplicate-email-${randomUUID()}',payload) from fmat.jobs where id='${first.jobId}';`);
  duringSend=async()=>{const duplicateLease=await own(duplicate);await assert.rejects(database.rpc('fmat_booking_delivery',{p_operation:'record',p_lease:duplicateLease,p_input:{outcome:'uncertain',reason:'prior_dispatch_uncertain'}}));assert.equal(await worker().process(duplicateLease),'retry');assert.equal(await status(first.id),'sending');activeJob=first.jobId;};
  assert.equal(await worker().process(firstLease),'sent');duringSend=undefined;assert.equal(posts,1);
  assert.equal(await worker().process(await own(duplicate)),'sent');assert.equal(posts,1);
  // Lost provider response exposes only a receipt, never broader guest authority.
  mode='lost';assert.equal(await worker().process(await own(rows[1].jobId)),'uncertain');assert.equal(posts,2);mode='success';
  const token=messages.at(-1)!.text.match(/#receipt=([A-Za-z0-9_-]{43})/)?.[1];assert.ok(token);
  const credential=bookingReceiptCredential(rows[1].requestId,token),receipt=new BookingReceipt(database);
  assert.equal((await receipt.read(credential,{requestId:rows[1].requestId})).receipt?.organizer?.email,'selected-calendar@example.test');
  assert.throws(()=>requireCredential(credential as never));await assert.rejects(receipt.read(credential,{requestId:rows[3].requestId}));
  const parent=await sql.query(`select token_hash from fmat.requests where id='${rows[1].requestId}';`);
  await sql.query(`update fmat.requests set token_hash=repeat('9',64) where id='${rows[1].requestId}';`);await assert.rejects(receipt.read(credential,{requestId:rows[1].requestId}));await sql.query(`update fmat.requests set token_hash='${parent}' where id='${rows[1].requestId}';`);
  // Preparation commit with lost acknowledgement retains identical encrypted content.
  let drop=true;
  const lostPrepare=new Database(env,async(url,init)=>{const response=await fetch(url,init),body=JSON.parse(String(init?.body));if(drop&&body.p_operation==='prepare'&&response.ok){drop=false;throw new Error('lost prepare acknowledgement');}return response;});
  assert.equal(await worker(lostPrepare).process(await own(rows[2].jobId)),'retry');assert.equal(drop,false);
  const frozen=await sql.query(`select encrypted_prepared from fmat.booking_deliveries where outbox_id='${rows[2].id}';`);
  const preparedLease=await own(rows[2].jobId);
  const preparedState=await database.rpc('fmat_booking_delivery',{p_operation:'load',p_lease:preparedLease,p_input:{}}) as {basis:string};
  await assert.rejects(database.rpc('fmat_booking_delivery',{p_operation:'prepare',p_lease:preparedLease,p_input:{basis:preparedState.basis,encryptedPrepared:frozen,receiptTokenHash:null,unexpected:true}}));
  await sql.query(`do $$begin update fmat.booking_deliveries set encrypted_prepared='changed' where outbox_id='${rows[2].id}';raise exception 'mutable fixture';exception when raise_exception then if sqlerrm<>'IMMUTABLE_DELIVERY' then raise;end if;end$$;`);
  assert.equal(await worker().process(preparedLease),'sent');assert.equal(await sql.query(`select encrypted_prepared from fmat.booking_deliveries where outbox_id='${rows[2].id}';`),frozen);assert.equal(posts,3);
  // Parent-token rotation after preparation suppresses before dispatch.
  const rotated=new Database(env,async(url,init)=>{const response=await fetch(url,init),body=JSON.parse(String(init?.body));if(body.p_operation==='prepare'&&response.ok)await sql.query(`update fmat.requests set token_hash=repeat('8',64) where id='${rows[3].requestId}';`);return response;});
  assert.equal(await worker(rotated).process(await own(rows[3].jobId)),'suppressed');assert.equal(posts,3);
  // A lost positive dispatch receipt cannot be retried as an HTTP send.
  drop=true;const lostDispatch=new Database(env,async(url,init)=>{const response=await fetch(url,init),body=JSON.parse(String(init?.body));if(drop&&body.p_operation==='dispatch'&&response.ok){drop=false;throw new Error('lost dispatch acknowledgement');}return response;});
  assert.equal(await worker(lostDispatch).process(await own(rows[4].jobId)),'uncertain');assert.equal(drop,false);assert.equal(posts,3);
  // A provider call that outlives its owner cannot commit sent or permit another send.
  mode='expired';assert.equal(await worker().process(await own(rows[5].jobId)),'lease_lost');assert.equal(await status(rows[5].id),'sending');mode='success';
  assert.equal(await worker().process(await own(rows[5].jobId)),'uncertain');assert.equal(posts,4);
  mode='bounce';assert.equal(await worker().process(await own(rows[6].jobId)),'failed');mode='suppress';assert.equal(await worker().process(await own(rows[7].jobId)),'suppressed');mode='success';assert.equal(posts,6);
  // The original owner can recover a lost atomic completion acknowledgement.
  drop=true;const lostRecord=new Database(env,async(url,init)=>{const response=await fetch(url,init),body=JSON.parse(String(init?.body));if(drop&&body.p_operation==='record'&&response.ok){drop=false;throw new Error('lost record acknowledgement');}return response;});
  await worker(lostRecord).process(await own(rows[8].jobId));assert.equal(drop,false);assert.equal(await status(rows[8].id),'sent');assert.equal(posts,7);
  await sql.query(`update fmat.requests set token_expires_at=clock_timestamp()-interval '1 second' where id='${rows[9].requestId}';`);
  assert.equal(await worker().process(await own(rows[9].jobId)),'suppressed');assert.equal(posts,7);
  // Exhaustion must stop claiming that an unsent message is still queued.
  for(const crashed of [false,true]){
   const exhaustedId=randomUUID();
   await sql.query(`insert into fmat.outbox(id,dedupe_key,audience,recipient,payload) select '${exhaustedId}','exhausted:${exhaustedId}',audience,recipient,payload from fmat.outbox where id='${first.id}';`);
   const exhaustedJob=await sql.query(`select fmat.enqueue_job('delivery','exhausted:${exhaustedId}',jsonb_build_object('outboxId','${exhaustedId}'));`);
   const exhaustedLease=await own(exhaustedJob);
   await sql.query(`update fmat.jobs set attempts=max_attempts,available_at='1900-01-01'${crashed?",lease_until=clock_timestamp()-interval '1 second'":''} where id='${exhaustedJob}';`);
   if(crashed)assert.deepEqual(await worker().run(),{claimed:1,outcome:'failed'});
   else assert.equal(await new BookingDelivery(database,{...env,TOKEN_ENCRYPTION_KEY:'invalid'},provider).process(exhaustedLease),'retry');
   assert.equal(await status(exhaustedId),'failed');assert.equal(posts,7);
  }
  assert.equal(await sql.query(`select jsonb_agg(jsonb_build_object('id',id,'status',status,'event',event) order by id)::text from fmat.requests where host_id='${hostId}';`),original);
  assert.equal(await sql.query(`select count(*) from fmat.jobs where kind in ('booking','booking_reconcile') and payload->>'requestId' in(select id::text from fmat.requests where host_id='${hostId}');`),calendarJobs);
  assert.equal(await sql.query(`select has_function_privilege('anon','public.fmat_booking_delivery(text,jsonb,jsonb)','EXECUTE')||','||has_function_privilege('authenticated','public.fmat_booking_delivery(text,jsonb,jsonb)','EXECUTE')||','||has_table_privilege('service_role','fmat.booking_deliveries','SELECT');`),'false,false,false');
 }finally{sql.close();}
}

import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {expect,type Page} from '@playwright/test';
import type {LocalSql} from '../integration/local-sql.ts';
export async function verifyBookingApproval(host:Page,guest:Page,sql:LocalSql,hostId:string){
 const origin=new URL(host.url()).origin,id=randomUUID(),token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
 const original=await sql.query(`select rules::text from fmat.hosts where id='${hostId}';`);
 const rules={timezone:'UTC',availability:[{days:[0,1,2,3,4,5,6],start:'00:00',end:'23:59'}],focusBlocks:[],bufferMinutes:0,durationMinutes:30,preferences:'',travelMode:'NONE',meetingMode:'online',locationPolicy:'per_meeting',locations:[],travelBufferMinutes:0};
 const day=new Date(Date.now()+2*86400000).toISOString().slice(0,10),details={requesterName:'Approval fixture',requesterEmail:'approval-fixture@example.test',purpose:'Review this exact proposal',durationMinutes:30,timezone:'UTC',windows:[{start:day+'T10:00:00Z',end:day+'T12:00:00Z'}],mode:'online',location:'https://meet.example.test/approved'};
 const post=async(path:string,data:unknown)=>{const response=await guest.request.post(origin+'/api/browser/'+path,{headers:{origin},data});assert.equal(response.status(),200,await response.text());return response.json();};
 try{
  await sql.query(`update fmat.hosts set rules='${JSON.stringify(rules)}',rules_version=rules_version+1 where id='${hostId}';insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${id}','${hostId}','${JSON.stringify(details)}','${hash}',now()+interval '3 days');`);
  await post('guest/exchange',{requestId:id,token});let state=await post('scheduling/evaluate',{requestId:id,revision:1,audience:'guest'});
  state=await post('scheduling/select',{requestId:id,revision:state.revision,audience:'guest',publicationId:state.publication.id,candidateId:state.publication.candidates[0].id,confirmed:true,idempotencyKey:randomUUID()});
  await host.goto(origin+'/app?request='+id);const card=host.getByRole('region',{name:'Host booking approval',exact:true});
  await card.getByText('Waiting for the requester to agree to this proposal.',{exact:true}).waitFor();assert.equal(await card.getByRole('button',{name:'Review approval',exact:true}).count(),0);
  await post('scheduling/agree',{requestId:id,revision:state.revision,audience:'guest',proposalVersion:state.proposal.version,confirmed:true,idempotencyKey:randomUUID()});
  await card.getByRole('button',{name:'Check approval status',exact:true}).click();await card.getByText('The requester must verify their contact email before booking.',{exact:true}).waitFor();
  assert.equal((await guest.request.post(origin+'/api/browser/booking-approval/approve',{headers:{origin},data:{}})).status(),401);
  assert.equal((await host.request.post(origin+'/api/browser/booking-approval/approve',{headers:{origin:'https://wrong.test'},data:{}})).status(),403);
  // Synthetic verified-contact fixture only; this test sends no human email.
  await sql.query(`update fmat.requests set contact_verified_email='approval-fixture@example.test' where id='${id}';`);
  await card.getByRole('button',{name:'Check approval status',exact:true}).click();await card.getByRole('button',{name:'Review approval',exact:true}).click();await card.getByRole('button',{name:'Keep reviewing',exact:true}).click();assert.equal(await sql.query(`select count(*) from fmat.host_approvals where request_id='${id}';`),'0');
  await card.getByRole('button',{name:'Review approval',exact:true}).click();
  await host.setViewportSize({width:320,height:844});await card.scrollIntoViewIfNeeded();assert.equal(await host.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.ok(await card.getByRole('button',{name:'Confirm approval',exact:true}).evaluate(e=>e.scrollWidth<=e.clientWidth&&e.getBoundingClientRect().right<=e.closest('[role=region]')!.getBoundingClientRect().right));await host.screenshot({path:'.local/rebuild/browser-screenshots/approval-mobile.png',fullPage:true});
  await host.setViewportSize({width:1280,height:1000});await host.evaluate(()=>{document.documentElement.style.zoom='2';});assert.equal(await host.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await host.screenshot({path:'.local/rebuild/browser-screenshots/approval-zoom.png',fullPage:true});await host.evaluate(()=>{document.documentElement.style.zoom='';});
  const inputs:unknown[]=[];await host.route('**/api/browser/booking-approval/approve',async route=>{inputs.push(route.request().postDataJSON());if(inputs.length===1)return route.abort('failed');const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});
  await card.getByRole('button',{name:'Confirm approval',exact:true}).click();await card.getByRole('alert').waitFor();await card.getByRole('button',{name:'Check approval status',exact:true}).click();await card.getByRole('button',{name:'Retry same approval',exact:true}).click();
  await card.getByRole('button',{name:'Check approval status',exact:true}).click();await card.getByText('Your approval is recorded. Booking still requires current availability checks and a confirmed Calendar event.',{exact:true}).waitFor();
  assert.deepEqual(inputs[0],inputs[1]);assert.equal(await sql.query(`select count(*) from fmat.host_approvals where request_id='${id}';`),'1');assert.equal(await sql.query(`select count(*) from fmat.jobs where kind='booking' and payload->>'requestId'='${id}';`),'1');
  await expect(host.getByLabel('Message your scheduling assistant')).toHaveCount(0);await host.reload();await card.getByText('Your approval is recorded. Booking still requires current availability checks and a confirmed Calendar event.',{exact:true}).waitFor();
  // Synthetic persisted provider evidence exercises the real receipt API/UI;
  // actual worker outcomes are separately covered by the integration suite.
  const pendingReceipt=host.getByRole('region',{name:'Booking confirmation',exact:true});
  await pendingReceipt.getByText('Booking in progress',{exact:true}).waitFor();
  assert.equal(await pendingReceipt.getByRole('link',{name:'Join meeting',exact:true}).count(),0);
  await sql.query(`update fmat.booking_attempts set phase='confirmed',confirmed_at=clock_timestamp(),provider_evidence=jsonb_build_object('calendarId',calendar_id,'eventId',event_id,'payloadFingerprint',payload_fingerprint,'etag','fixture','organizer',jsonb_build_object('email','calendar-owner@example.test'),'eventUrl','https://www.google.com/calendar/event?eid=fixture') where request_id='${id}';update fmat.requests set status='booked',event=jsonb_build_object('id',(select event_id from fmat.booking_attempts where request_id='${id}')),revision=revision+1,private_notes='receipt private sentinel' where id='${id}';`);
  await pendingReceipt.getByRole('button',{name:'Check booking status',exact:true}).click();await pendingReceipt.getByText('Meeting confirmed',{exact:true}).waitFor();
  await guest.goto(origin+'/booking/'+id);const receipt=guest.getByRole('region',{name:'Booking confirmation',exact:true});await receipt.getByText('Meeting confirmed',{exact:true}).waitFor();
  await expect(receipt.getByRole('link',{name:'Join meeting',exact:true})).toHaveAttribute('href',details.location);
  await expect(receipt.getByRole('link',{name:'Open in Google Calendar',exact:true})).toHaveAttribute('href','https://www.google.com/calendar/event?eid=fixture');
  await expect(receipt.getByText(details.purpose,{exact:true})).toBeVisible();await expect(receipt.getByText('30 minutes',{exact:true})).toBeVisible();await expect(receipt.getByText(details.requesterEmail,{exact:true})).toBeVisible();
  assert.equal(await guest.getByText('receipt private sentinel',{exact:true}).count(),0);await expect(guest.getByLabel('Message your scheduling assistant')).toHaveCount(0);
  const receiptResponse=await guest.request.get(origin+'/api/browser/booking-receipt?audience=guest&requestId='+id);assert.equal(receiptResponse.status(),200);assert.match(receiptResponse.headers()['cache-control'],/no-store/);assert.doesNotMatch(await receiptResponse.text(),/private sentinel|tokenHash|encryptedCredential/);
  await guest.setViewportSize({width:320,height:844});await receipt.scrollIntoViewIfNeeded();assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await guest.screenshot({path:'.local/rebuild/browser-screenshots/receipt-mobile.png',fullPage:true});
  await guest.setViewportSize({width:1280,height:1000});await guest.evaluate(()=>{document.documentElement.style.zoom='2';});assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await guest.screenshot({path:'.local/rebuild/browser-screenshots/receipt-zoom.png',fullPage:true});await guest.evaluate(()=>{document.documentElement.style.zoom='';});
  // A fresh browser exchanges an email-only receipt token, with no guest session.
  const emailToken=randomBytes(32).toString('base64url'),emailHash=createHash('sha256').update(emailToken).digest('hex'),outboxId=randomUUID();
  await sql.query(`insert into fmat.outbox(id,dedupe_key,audience,recipient,payload,status) values('${outboxId}','booking-confirmed:${id}:requester','requester','{"email":"${details.requesterEmail}"}','{"type":"booking_confirmed","requestId":"${id}"}','sent');insert into fmat.booking_deliveries(outbox_id,request_id,basis,encrypted_prepared,receipt_token_hash,parent_token_hash,receipt_expires_at,dispatched_at,dispatch_job_id,dispatch_lease_token) select '${outboxId}',r.id,repeat('a',64),'synthetic-browser-fixture','${emailHash}',r.token_hash,r.token_expires_at,clock_timestamp(),j.id,gen_random_uuid() from fmat.requests r join fmat.jobs j on j.payload->>'requestId'=r.id::text and j.kind='booking' where r.id='${id}';`);
  const emailContext=await guest.context().browser()!.newContext(),emailPage=await emailContext.newPage();
  try{
   await emailPage.goto(origin+'/booking/'+id+'#receipt='+emailToken);
   const emailReceipt=emailPage.getByRole('region',{name:'Booking confirmation',exact:true});
   await emailReceipt.getByText('Meeting confirmed',{exact:true}).waitFor();
   await expect(emailReceipt.getByText('calendar-owner@example.test',{exact:true})).toBeVisible();
   assert.equal(new URL(emailPage.url()).hash,'');
   const cookie=(await emailContext.cookies()).find(c=>c.name==='fmat-receipt-'+id);assert.ok(cookie?.httpOnly);assert.equal(cookie.sameSite,'Lax');
   assert.equal((await emailContext.request.get(origin+'/api/browser/guest/state?requestId='+id)).status(),401);
   assert.equal((await emailContext.request.post(origin+'/api/browser/scheduling/evaluate',{headers:{origin},data:{requestId:id,revision:1,audience:'guest'}})).status(),401);
   assert.equal((await emailContext.request.post(origin+'/api/browser/booking-receipt/exchange',{headers:{origin:'https://wrong.test'},data:{requestId:id,token:emailToken}})).status(),403);
   await expect(emailPage.getByLabel('Message your scheduling assistant')).toHaveCount(0);
   await emailPage.reload();await emailReceipt.getByText('Meeting confirmed',{exact:true}).waitFor();
   await sql.query(`update fmat.requests set token_hash=repeat('7',64) where id='${id}';`);
   await emailReceipt.getByRole('button',{name:'Check booking status',exact:true}).click();await emailReceipt.getByRole('alert').waitFor();
   await expect(emailReceipt.getByRole('link',{name:'Join meeting',exact:true})).toHaveCount(0);
   await sql.query(`update fmat.requests set token_hash='${hash}' where id='${id}';`);
  }finally{await emailContext.close();}
  await sql.query(`update fmat.requests set token_expires_at=clock_timestamp()-interval '1 second' where id='${id}';`);
  await receipt.getByRole('button',{name:'Check booking status',exact:true}).click();await receipt.getByRole('alert').waitFor();await expect(receipt.getByRole('link',{name:'Join meeting',exact:true})).toHaveCount(0);await expect(receipt.getByText(details.requesterEmail,{exact:true})).toHaveCount(0);
  await host.getByRole('button',{name:'Back to host chat',exact:true}).click();await host.getByRole('button',{name:'Disconnect Google',exact:true}).waitFor();
 }finally{
  await host.unroute('**/api/browser/booking-approval/approve');
  await sql.query(`set session_replication_role=replica;delete from fmat.booking_deliveries where request_id='${id}';delete from fmat.outbox where payload->>'requestId'='${id}';delete from fmat.jobs where payload->>'requestId'='${id}';delete from fmat.web_approval_decisions where request_id='${id}';delete from fmat.host_reservations where attempt_id in(select id from fmat.booking_attempts where request_id='${id}');delete from fmat.booking_attempts where request_id='${id}';delete from fmat.host_approvals where request_id='${id}';delete from fmat.booking_identities where request_id='${id}';delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where request_id='${id}');delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where request_id='${id}');delete from fmat.conversation_scopes where request_id='${id}';delete from fmat.scheduling_decisions where request_id='${id}';delete from fmat.proposal_evidence where request_id='${id}';delete from fmat.proposals where request_id='${id}';delete from fmat.candidate_publications where request_id='${id}';delete from fmat.candidate_rankings where request_id='${id}';delete from fmat.candidate_evaluations where request_id='${id}';delete from fmat.request_history where request_id='${id}';delete from fmat.audit_events where subject_id='${id}';delete from fmat.requests where id='${id}';update fmat.hosts set rules='${original.replaceAll("'","''")}',rules_version=rules_version+1 where id='${hostId}';set session_replication_role=origin;`);
 }
}

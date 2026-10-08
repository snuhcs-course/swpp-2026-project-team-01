import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {expect,type Page} from '@playwright/test';
import type {LocalSql} from '../integration/local-sql.ts';

export async function verifyPreparedWithdrawal(host:Page,guest:Page,sql:LocalSql,hostId:string,details:Record<string,unknown>){
 const hostUrl=host.url(),guestUrl=guest.url(),origin=new URL(hostUrl).origin,id=randomUUID(),token=randomBytes(32).toString('base64url');
 const post=async(page:Page,path:string,data:unknown)=>{const response=await page.request.post(origin+'/api/browser/'+path,{headers:{origin},data});assert.equal(response.status(),200,await response.text());return response.json();};
 try{
  await sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${id}','${hostId}','${JSON.stringify(details)}','${createHash('sha256').update(token).digest('hex')}',now()+interval '3 days');`);
  await post(guest,'guest/exchange',{requestId:id,token});let state=await post(guest,'scheduling/evaluate',{requestId:id,revision:1,audience:'guest'});
  state=await post(guest,'scheduling/select',{requestId:id,revision:state.revision,audience:'guest',publicationId:state.publication.id,candidateId:state.publication.candidates[0].id,confirmed:true,idempotencyKey:randomUUID()});
  state=await post(guest,'scheduling/agree',{requestId:id,revision:state.revision,audience:'guest',proposalVersion:state.proposal.version,confirmed:true,idempotencyKey:randomUUID()});
  await sql.query(`update fmat.requests set contact_verified_email=details->>'requesterEmail' where id='${id}';`);
  await post(host,'booking-approval/approve',{requestId:id,revision:state.revision,proposalVersion:state.proposal.version,confirmed:true,idempotencyKey:randomUUID()});
  await host.goto(origin+'/app?request='+id);
  await expect(host.getByRole('region',{name:'Request status and closure',exact:true}).getByRole('button',{name:'Decline request',exact:true})).toBeVisible();
  await guest.goto(origin+'/booking/'+id);const card=guest.getByRole('region',{name:'Request status and closure',exact:true});
  await expect(guest.getByText('Your proposal is saved. Check booking status below.',{exact:true})).toBeVisible();
  await expect(guest.getByText('Your saved request is protected. Use the conversation below to discuss the details.',{exact:true})).toHaveCount(0);
  await expect(card.getByText('Calendar creation has not started. You can still withdraw this request; the server will check again when you confirm.',{exact:true})).toBeVisible();
  await card.getByRole('button',{name:'Withdraw request',exact:true}).click();
  await guest.setViewportSize({width:320,height:844});await card.scrollIntoViewIfNeeded();assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await guest.screenshot({path:'.local/rebuild/browser-screenshots/prepared-withdrawal-mobile.png',fullPage:true});
  const inputs:unknown[]=[];
  await guest.route('**/api/browser/request-lifecycle/withdraw',async route=>{inputs.push(route.request().postDataJSON());if(inputs.length===1)return route.abort('failed');const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});
  await card.getByRole('button',{name:'Confirm withdraw',exact:true}).click();
  await card.getByRole('button',{name:'Check request status',exact:true}).click();
  await card.getByRole('button',{name:'Retry same decision',exact:true}).click();
  await expect(guest.getByText('withdrawn',{exact:true})).toBeVisible();assert.deepEqual(inputs[0],inputs[1]);
  assert.equal(await sql.query(`select phase from fmat.booking_attempts where request_id='${id}';`),'blocked');
  assert.equal(await sql.query(`select count(*) from fmat.booking_dispatches where attempt_id in(select id from fmat.booking_attempts where request_id='${id}');`),'0');
  await expect(guest.getByRole('link',{name:'Join meeting',exact:true})).toHaveCount(0);await expect(guest.getByLabel('Message your scheduling assistant')).toHaveCount(0);
 }finally{
  await guest.unroute('**/api/browser/request-lifecycle/withdraw');
  await sql.query(`set session_replication_role=replica;delete from fmat.request_closures where request_id='${id}';delete from pgmq.q_fmat_jobs where message->>'jobId' in(select id::text from fmat.jobs where payload->>'requestId'='${id}');delete from pgmq.a_fmat_jobs where message->>'jobId' in(select id::text from fmat.jobs where payload->>'requestId'='${id}');delete from fmat.queue_publications where job_id in(select id from fmat.jobs where payload->>'requestId'='${id}');delete from fmat.jobs where payload->>'requestId'='${id}';delete from fmat.web_approval_decisions where request_id='${id}';delete from fmat.host_reservations where attempt_id in(select id from fmat.booking_attempts where request_id='${id}');delete from fmat.booking_attempts where request_id='${id}';delete from fmat.host_approvals where request_id='${id}';delete from fmat.booking_identities where request_id='${id}';delete from fmat.scheduling_decisions where request_id='${id}';delete from fmat.proposal_evidence where request_id='${id}';delete from fmat.proposals where request_id='${id}';delete from fmat.candidate_publications where request_id='${id}';delete from fmat.candidate_rankings where request_id='${id}';delete from fmat.candidate_evaluations where request_id='${id}';delete from fmat.request_history where request_id='${id}';delete from fmat.audit_events where subject_id='${id}';delete from fmat.requests where id='${id}';set session_replication_role=origin;`);
  await host.goto(hostUrl);await guest.goto(guestUrl);
 }
}

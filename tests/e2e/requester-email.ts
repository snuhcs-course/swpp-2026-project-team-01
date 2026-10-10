import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {expect,type Page,type BrowserContext} from '@playwright/test';
import type {LocalSql} from '../integration/local-sql.ts';
export const emailReceiver='82000000-0000-4000-8000-000000000001',emailInbox='browser-email-link@example.test';
export async function verifyRequesterEmail(page:Page,context:BrowserContext,sql:LocalSql,requestId:string){
 const origin='http://localhost:3000',base=origin+'/api/browser/requester-email/',card=page.getByRole('region',{name:'Requester email linking'});
 await sql.query(`insert into fmat.agentmail_receivers(inbox_id,receiver_id,enabled) values('${emailInbox}','${emailReceiver}',true);`);
 try{
  await page.reload();await card.getByText('Verify your current contact email above before linking.').waitFor();
  const missing=await page.context().browser()!.newContext();assert.equal((await missing.request.get(base+'state?requestId='+requestId)).status(),401);await missing.close();
  for(const operation of ['start','revoke'])assert.equal((await context.request.post(base+operation,{headers:{origin:'https://wrong.test'},data:{}})).status(),403);
  assert.equal((await context.request.get(base+'state?requestId='+requestId+'&unexpected=true')).status(),400);
  await sql.query(`update fmat.requests set details=details||'{"requesterEmail":"guest@example.test"}',contact_verified_email='guest@example.test' where id='${requestId}';`);
  await card.getByRole('button',{name:'Check email link',exact:true}).click();await card.getByRole('button',{name:'Create linking message'}).waitFor();
  // Commit the real command, lose its response, and recover the exact operation.
  const bodies:string[]=[];let drop=true;
  await page.route(base+'start',async route=>{bodies.push(route.request().postData()!);const result=await route.fetch();if(drop){drop=false;await route.abort();}else await route.fulfill({response:result});});
  await card.getByRole('button',{name:'Create linking message'}).click();await card.getByRole('button',{name:'Retry same linking action'}).waitFor();
  const proof=await card.getByLabel('Private linking message').inputValue();assert.match(proof,/^FMAT-LINK /);
  await card.getByRole('button',{name:'Retry same linking action'}).click();await expect(card.getByRole('button',{name:'Retry same linking action'})).toHaveCount(0);assert.equal(bodies[0],bodies[1]);
  await page.unroute(base+'start');await page.reload();await expect(card.getByLabel('Private linking message')).toHaveValue(proof);
  const state=await context.request.get(base+'state?requestId='+requestId);assert.match(state.headers()['cache-control'],/private.*no-store/);const data=await state.json();assert.equal('encryptedProof' in data,false);assert.equal('tokenHash' in data,false);
  assert.equal(await page.evaluate(p=>JSON.stringify({...localStorage,...sessionStorage}).includes(p),proof),false);
  await page.setViewportSize({width:320,height:844});await card.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await card.getByLabel('Private linking message').focus();await expect(card.getByLabel('Private linking message')).toBeFocused();await card.screenshot({path:'.local/rebuild/browser-screenshots/requester-email-320.png'});
  await page.setViewportSize({width:1280,height:900});
  // Seed the independently verified provider boundary; integration tests exercise actual DKIM verification.
  const receipt=randomUUID(),proofHash=createHash('sha256').update(proof.split('.')[1]).digest('hex');
  await sql.query(`insert into fmat.agentmail_inbox(id,inbox_id,receiver_id,event_id,message_id,thread_id,occurred_at,payload_hash,received_at) values('${receipt}','${emailInbox}','${emailReceiver}','${receipt}','${receipt}','${receipt}',clock_timestamp(),repeat('a',64),clock_timestamp());select public.fmat_requester_email_receipt('bind','${emailReceiver}','${emailInbox}',jsonb_build_object('receiptId','${receipt}','linkId','${data.linkId}','proofHash','${proofHash}','authorEmail','guest@example.test','recipientEmail','${emailInbox}','parentMessageId',null,'rawHash',repeat('b',64),'signatureId',repeat('c',64)));`);
  await card.getByRole('button',{name:'Check email link',exact:true}).click();await card.getByText('Your email thread is linked. Reply in that same thread to continue this meeting.').waitFor();await expect(card.getByLabel('Private linking message')).toHaveCount(0);
  // Losing an unlink response must remove the secret immediately; state read confirms revocation.
  await page.route(base+'revoke',async route=>{await route.fetch();await route.abort();});await card.getByRole('button',{name:'Unlink email'}).click();await card.getByText('Email is unlinked. Messages in the old thread cannot access this meeting.').waitFor();await expect(card.getByLabel('Private linking message')).toHaveCount(0);await page.unroute(base+'revoke');
  await sql.query(`update fmat.requester_email_links set created_at=created_at-interval '61 seconds' where request_id='${requestId}';`);
  await card.getByRole('button',{name:'Create linking message'}).click();await card.getByLabel('Private linking message').waitFor();
  await sql.query(`update fmat.requester_email_links set challenge_expires_at=clock_timestamp()-interval '1 second' where request_id='${requestId}';`);
  await card.getByRole('button',{name:'Check email link',exact:true}).click();await card.getByText('This email link has expired. Create a new linking message to continue.').waitFor();await expect(card.getByLabel('Private linking message')).toHaveCount(0);
  await sql.query(`update fmat.agentmail_receivers set enabled=false where inbox_id='${emailInbox}';`);await card.getByRole('button',{name:'Check email link',exact:true}).click();await card.getByText('Email linking is unavailable. Continue here on the web.').waitFor();await expect(card.getByRole('button',{name:'Create linking message'})).toHaveCount(0);await card.getByRole('button',{name:'Unlink email'}).click();await card.getByText('Email is unlinked. Messages in the old thread cannot access this meeting.').waitFor();
 }finally{
  await page.unroute(base+'start');await page.unroute(base+'revoke');
  await sql.query(`delete from fmat.requester_email_evidence where inbox_id='${emailInbox}';delete from fmat.requester_email_links where request_id='${requestId}';delete from fmat.agentmail_inbox where inbox_id='${emailInbox}';delete from fmat.agentmail_receivers where inbox_id='${emailInbox}';update fmat.requests set contact_verified_email=null,details=details-'requesterEmail' where id='${requestId}';`);
 }
}

import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {expect,type Page} from '@playwright/test';
import {Database} from '../../lib/server/database/client.ts';
import {ContactVerificationDelivery} from '../../lib/server/email/contact-delivery.ts';
import {CloudflareEmail} from '../../lib/server/email/cloudflare.ts';
import type {LocalSql} from '../integration/local-sql.ts';
export async function verifyContactEmail(host:Page,guest:Page,sql:LocalSql,requestId:string){
 const origin=new URL(host.url()).origin,card=guest.getByRole('region',{name:'Contact email verification',exact:true}),local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_EMAIL_API_TOKEN:'synthetic-browser',CLOUDFLARE_EMAIL_FROM:'no-reply@findmeatime.com'};
 assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 let emitted='',mode='success',sends=0;
 const provider=new CloudflareEmail(env,async(_url,init)=>{const message=JSON.parse(String(init?.body));sends++;emitted=message.text.match(/Your verification code: (\d{6})/u)?.[1]??'';assert.match(emitted,/^\d{6}$/u);assert.equal(message.to,'approval-fixture@example.test');if(mode==='uncertain')throw new Error('synthetic lost email response');return Response.json({success:true,errors:[],result:{message_id:'browser-'+sends,delivered:[],queued:[message.to],permanent_bounces:[],suppressed_recipients:[]}});});
 async function send(){const jobId=await sql.query(`select j.id from fmat.jobs j join fmat.contact_verifications c on j.payload->>'outboxId'=c.outbox_id::text where c.request_id='${requestId}' order by c.created_at desc limit 1;`),lease={jobId,workerId:'browser-contact-'+randomUUID(),leaseToken:randomUUID()};await sql.query(`update fmat.jobs set status='running',worker_id='${lease.workerId}',lease_token='${lease.leaseToken}',lease_until=clock_timestamp()+interval '1 minute' where id='${jobId}';`);return new ContactVerificationDelivery(new Database(env),env,provider).process(lease);}
 async function refresh(){await card.getByRole('button',{name:'Check verification status',exact:true}).click();}
 async function cooldown(){await sql.query(`update fmat.contact_verifications set created_at=created_at-interval '61 seconds' where request_id='${requestId}';`);await refresh();await expect(card.getByRole('button',{name:'Request a new code',exact:true})).toBeEnabled();}
 const statePath=origin+'/api/browser/contact-verification/state?requestId='+requestId;
 assert.equal((await host.request.get(statePath)).status(),401);
 assert.equal((await guest.request.post(origin+'/api/browser/contact-verification/start',{headers:{origin:'https://wrong.test'},data:{}})).status(),403);
 await guest.goto(origin+'/booking/'+requestId);await card.getByRole('button',{name:'Send verification code',exact:true}).waitFor();
 const requestBodies:unknown[]=[];
 // A committed code request with a lost response recovers through the same key.
 await guest.route('**/api/browser/contact-verification/start',async route=>{requestBodies.push(route.request().postDataJSON());await route.fetch();await route.abort('failed');},{times:1});
 await card.getByRole('button',{name:'Send verification code',exact:true}).click();await card.getByRole('button',{name:'Retry same verification action',exact:true}).waitFor();
 await guest.route('**/api/browser/contact-verification/start',async route=>{requestBodies.push(route.request().postDataJSON());await route.continue();},{times:1});
 await card.getByRole('button',{name:'Retry same verification action',exact:true}).click();await expect(card.getByLabel('Six-digit verification code')).toBeEnabled();assert.deepEqual(requestBodies[0],requestBodies[1]);
 assert.equal(await sql.query(`select count(*) from fmat.contact_verifications where request_id='${requestId}';`),'1');assert.equal(await send(),'sent');await refresh();await card.getByText('Your code email was accepted for delivery. Check your inbox and spam folder.',{exact:true}).waitFor();
 const snapshot=await guest.request.get(statePath);assert.equal(snapshot.status(),200);assert.match(snapshot.headers()['cache-control'],/no-store/u);assert.doesNotMatch(await snapshot.text(),/encrypted|codeHash|tokenHash/u);
 await guest.reload();await expect(card.getByLabel('Six-digit verification code')).toHaveValue('');assert.equal(sends,1);
 const confirmations:unknown[]=[];
 await guest.route('**/api/browser/contact-verification/confirm',async route=>{confirmations.push(route.request().postDataJSON());await route.fetch();await route.abort('failed');},{times:1});
 await card.getByLabel('Six-digit verification code').fill(emitted==='000000'?'000001':'000000');await card.getByRole('button',{name:'Verify email',exact:true}).click();await card.getByRole('button',{name:'Retry same verification action',exact:true}).waitFor();
 await guest.route('**/api/browser/contact-verification/confirm',async route=>{confirmations.push(route.request().postDataJSON());await route.continue();},{times:1});
 await card.getByRole('button',{name:'Retry same verification action',exact:true}).click();await card.getByText('That code did not match. 4 attempts remain.',{exact:true}).waitFor();assert.deepEqual(confirmations[0],confirmations[1]);assert.equal(await sql.query(`select failed_attempts from fmat.contact_verifications where request_id='${requestId}';`),'1');
 // Exhaustion, expiry and uncertain email are observable, recoverable states.
 await sql.query(`update fmat.contact_verifications set failed_attempts=5 where request_id='${requestId}';`);await refresh();await card.getByText('No attempts remain. Request a new code to continue.',{exact:true}).waitFor();await expect(card.getByLabel('Six-digit verification code')).toHaveCount(0);
 await cooldown();await card.getByRole('button',{name:'Request a new code',exact:true}).click();await expect(card.getByLabel('Six-digit verification code')).toBeEnabled();mode='uncertain';assert.equal(await send(),'uncertain');mode='success';await refresh();await card.getByText(/We could not confirm whether the code email was sent/).waitFor();
 await sql.query(`update fmat.contact_verifications set expires_at=clock_timestamp()-interval '1 second' where request_id='${requestId}';`);await refresh();await card.getByText('This code has expired. Request a new code to continue.',{exact:true}).waitFor();
 await cooldown();await card.getByRole('button',{name:'Request a new code',exact:true}).click();await expect(card.getByLabel('Six-digit verification code')).toBeEnabled();assert.equal(await send(),'sent');await refresh();
 // An unsent confirmation retains its key too, and the final committed response may be lost.
 const retries:unknown[]=[];
 await guest.route('**/api/browser/contact-verification/confirm',async route=>{retries.push(route.request().postDataJSON());await route.abort('failed');},{times:1});
 await card.getByLabel('Six-digit verification code').fill(emitted);await card.getByRole('button',{name:'Verify email',exact:true}).click();await card.getByRole('button',{name:'Retry same verification action',exact:true}).waitFor();
 await guest.setViewportSize({width:320,height:844});await card.getByRole('button',{name:'Retry same verification action',exact:true}).scrollIntoViewIfNeeded();assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await guest.screenshot({path:'.local/rebuild/browser-screenshots/contact-mobile.png',fullPage:true});
 await guest.setViewportSize({width:1280,height:1000});await guest.evaluate(()=>{document.documentElement.style.zoom='2';});await card.getByRole('button',{name:'Retry same verification action',exact:true}).scrollIntoViewIfNeeded();assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await guest.screenshot({path:'.local/rebuild/browser-screenshots/contact-zoom.png',fullPage:true});await guest.evaluate(()=>{document.documentElement.style.zoom='';});
 await guest.route('**/api/browser/contact-verification/confirm',async route=>{retries.push(route.request().postDataJSON());await route.fetch();await route.abort('failed');},{times:1});
 const retry=card.getByRole('button',{name:'Retry same verification action',exact:true});await retry.focus();await guest.keyboard.press('Enter');await card.getByText('Your contact email is verified.',{exact:true}).waitFor();assert.deepEqual(retries[0],retries[1]);
 assert.equal(await sql.query(`select contact_verified_email='approval-fixture@example.test' and host_approved_version is null and event is null from fmat.requests where id='${requestId}';`),'t');
 await guest.reload();await card.getByText('Your contact email is verified.',{exact:true}).waitFor();await expect(card.getByLabel('Six-digit verification code')).toHaveCount(0);
 // Contact edits invalidate the shown proof and old codes; restore via a fresh explicit proof.
 await sql.query(`update fmat.requests set details=details||'{"requesterEmail":"changed@example.test"}',contact_verified_email=null,revision=revision+1 where id='${requestId}';`);await refresh();await card.getByText('changed@example.test',{exact:true}).waitFor();await expect(card.getByText('Your contact email is verified.',{exact:true})).toHaveCount(0);
 await sql.query(`update fmat.requests set details=details||'{"requesterEmail":"approval-fixture@example.test"}',revision=revision+1 where id='${requestId}';`);await refresh();await cooldown();await card.getByRole('button',{name:'Request a new code',exact:true}).click();await expect(card.getByLabel('Six-digit verification code')).toBeEnabled();assert.equal(await send(),'sent');await card.getByLabel('Six-digit verification code').fill(emitted);await card.getByRole('button',{name:'Verify email',exact:true}).click();await card.getByText('Your contact email is verified.',{exact:true}).waitFor();
}

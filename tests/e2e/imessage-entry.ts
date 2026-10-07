import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {expect,type Page,type BrowserContext} from '@playwright/test';
import {Database} from '../../lib/server/database/client.ts';
import {PhotonHandoffs} from '../../lib/server/photon/handoffs.ts';
import {photonWebhook} from '../../lib/server/photon/webhook.ts';
import {dispatchLinkCodes} from '../../lib/server/photon/delivery.ts';
import {LocalSql} from '../integration/local-sql.ts';
import {photonProject} from './setup-imessage.ts';

export async function beginIMessageEntry(page:Page,context:BrowserContext,local:Record<string,string>,sql:LocalSql){
 const origin='http://localhost:3000',receiver=randomUUID(),secret=randomBytes(32).toString('hex'),phone='+15550109999';
 const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,PHOTON_PROJECT_ID:photonProject,PHOTON_WEBHOOK_ID:receiver,
  IMESSAGE_WEBHOOK_SECRET:secret,TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),APP_ORIGIN:origin};
 const db=new Database(env);let url='';
 await cleanupIMessageEntry(sql);
 await sql.query(`insert into fmat.photon_receivers(project_id,receiver_id,enabled) values('${photonProject}','${receiver}',true);`);
 const space={id:'any;-;'+phone,platform:'imessage',type:'dm',phone:'shared'},timestamp=String(Math.floor(Date.now()/1000));
 const body=JSON.stringify({event:'messages',space,message:{id:'browser-entry',platform:'imessage',direction:'inbound',timestamp:new Date().toISOString(),sender:{id:phone,platform:'imessage'},space,content:{type:'text',text:'Help me get started'}}});
 assert.equal((await photonWebhook(new Request(origin+'/api/providers/photon',{method:'POST',body,headers:{'content-type':'application/json','x-spectrum-webhook-id':receiver,'x-spectrum-timestamp':timestamp,'x-spectrum-signature':'v0='+createHmac('sha256',secret).update(`v0:${timestamp}:${body}`).digest('hex')}}),{env,database:db})).status,200);
 const entries=new PhotonHandoffs(db,env,{async send(_route,_phone,text,_id,authorize){await authorize();url=text.match(/http:\/\/[^\s]+/u)![0];return {status:'delivered',providerReference:'browser-handoff'};},async reconcile(){assert.fail('one handoff only');}});
 assert.equal((await entries.prepare()).handoff,1);await entries.dispatch();assert.ok(url);
 const [handoffId,token]=new URLSearchParams(new URL(url).hash.slice(1)).get('imessage')!.split('.');
 // The exchange may commit while its response is lost; reopening in this
 // browser must succeed without allowing a transferred link in another one.
 let lost=false;await page.route('**/api/browser/imessage-entry/exchange',async route=>{if(lost)return route.continue();lost=true;await route.fetch();await route.abort('failed');});
 await page.goto(url);await page.getByRole('alert').filter({hasText:'private link'}).waitFor();assert.equal(new URL(page.url()).hash,'');
 await page.unroute('**/api/browser/imessage-entry/exchange');await page.goto(url);await page.getByRole('region',{name:'Private iMessage continuation'}).getByRole('status').waitFor();assert.equal(new URL(page.url()).hash,'');
 const cookies=await context.cookies();for(const name of ['fmat-imessage','fmat-imessage-entry'])assert.ok(cookies.find(c=>c.name===name)?.httpOnly);
 assert.equal(await page.evaluate(()=>document.cookie.includes('fmat-imessage')),false);
 const wrong=await context.browser()!.newContext();
 await wrong.request.post(origin+'/api/browser/imessage-entry/bind',{headers:{origin},data:{}});
 assert.equal((await wrong.request.post(origin+'/api/browser/imessage-entry/exchange',{headers:{origin},data:{handoffId,token}})).status(),400);await wrong.close();
 assert.equal((await context.request.post(origin+'/api/browser/imessage-entry/exchange',{headers:{origin:'https://wrong.test'},data:{handoffId,token}})).status(),403);
 assert.equal((await context.request.post(origin+'/api/browser/imessage/continue',{headers:{origin},data:{idempotencyKey:randomUUID()}})).status(),401);
 await page.setViewportSize({width:320,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'.local/rebuild/browser-screenshots/imessage-entry-signin.png',fullPage:true});await page.setViewportSize({width:1280,height:900});
 return {
  async finish(host:string){
   const card=page.getByRole('region',{name:'Connect iMessage'});await card.getByRole('button',{name:'Send verification code'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Confirm these meeting settings'}).count(),0,'Inbound entry is available before settings confirmation');
   let lostStart=false;await page.route('**/api/browser/imessage/continue',async route=>{if(lostStart)return route.continue();lostStart=true;await route.fetch();await route.abort('failed');});
   await card.getByRole('button',{name:'Send verification code'}).click();await card.getByRole('alert').waitFor();await card.getByRole('button',{name:'Send verification code'}).click();
   await card.getByText('Your code request is saved and waiting to send.',{exact:true}).waitFor();await page.unroute('**/api/browser/imessage/continue');
   const state=await (await context.request.get(origin+'/api/browser/imessage/read')).json(),challenge=state.challenge.id;
   assert.equal(await sql.query(`select count(*) from fmat.photon_link_challenges where host_id='${host}';`),'1');
   assert.equal(await sql.query(`select c.phone='${phone}' and c.line='shared' and c.expires_at<=h.expires_at from fmat.photon_link_challenges c join fmat.photon_handoffs h on h.challenge_id=c.id where c.id='${challenge}';`),'t');
   let code='';await dispatchLinkCodes(db,env,{async send(route,recipient,text,_id,authorize){await authorize();assert.equal(recipient,phone);assert.deepEqual(route,{line:'shared',spaceId:'any;-;'+phone});code=text.match(/code is (\d{6})/u)![1];return {status:'delivered',providerReference:'browser-code'};},async reconcile(){assert.fail('no resend');}});
   await card.getByRole('button',{name:'Check iMessage status'}).click();const input=card.getByLabel('Six-digit iMessage code');await input.waitFor();
   await page.setViewportSize({width:320,height:844});await input.scrollIntoViewIfNeeded();await expect(input).toBeInViewport();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/imessage-entry-code.png',fullPage:true});
   await input.fill(code);await card.getByRole('button',{name:'Confirm and link'}).click();await card.getByText('iMessage connected · ••••9999',{exact:true}).waitFor();
   assert.ok(!(await context.cookies()).some(c=>c.name==='fmat-imessage-entry'));assert.ok(!(await page.locator('body').innerText()).includes(token));
   assert.equal(await sql.query(`select count(*) from fmat.photon_inbox where project_id='${photonProject}' and (link_id is not null or runtime_message_id is not null);`),'0','Original unlinked message never inherits authority');
   assert.deepEqual(await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)})),{local:[],session:[]});
   await card.getByRole('button',{name:'Unlink iMessage',exact:true}).click();await card.getByRole('button',{name:'Confirm unlink'}).click();
   await expect(card).toHaveCount(0);await page.setViewportSize({width:1280,height:900});
  },
  cleanup:()=>cleanupIMessageEntry(sql)
 };
}

export async function cleanupIMessageEntry(sql:LocalSql){
   await sql.query(`delete from fmat.queue_publications p using fmat.jobs j,fmat.photon_inbox i where p.job_id=j.id and j.payload->>'inboxId'=i.id::text and i.project_id='${photonProject}';delete from pgmq.q_fmat_jobs q using fmat.jobs j,fmat.photon_inbox i where q.message->>'jobId'=j.id::text and j.payload->>'inboxId'=i.id::text and i.project_id='${photonProject}';delete from fmat.jobs j using fmat.photon_inbox i where j.payload->>'inboxId'=i.id::text and i.project_id='${photonProject}';delete from fmat.photon_handoffs where project_id='${photonProject}';delete from fmat.photon_inbox where project_id='${photonProject}';delete from fmat.photon_links where project_id='${photonProject}';delete from fmat.photon_link_challenges where project_id='${photonProject}';delete from fmat.photon_receivers where project_id='${photonProject}';`);
}

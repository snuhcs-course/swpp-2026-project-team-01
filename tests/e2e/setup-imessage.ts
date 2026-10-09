import assert from 'node:assert/strict';
import {expect,type Page,type BrowserContext} from '@playwright/test';
import {Database} from '../../lib/server/database/client.ts';
import {dispatchLinkCodes} from '../../lib/server/photon/delivery.ts';
import {LocalSql} from '../integration/local-sql.ts';
export const photonProject='b3000000-0000-4000-8000-000000000030';
export async function verifyIMessage(page:Page,context:BrowserContext,host:string,local:Record<string,string>,sql:LocalSql){
 const origin='http://localhost:3000',env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,PHOTON_PROJECT_ID:photonProject,TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
 const database=new Database(env),card=page.getByRole('region',{name:'Connect iMessage'}),codes=new Map<string,string>();let sends=0;
 const transport={async send(_route:unknown,_phone:string,text:string,id:string,authorize:()=>Promise<void>){await authorize();sends++;const code=text.match(/code is (\d{6})/u)?.[1];assert.ok(code);codes.set(id,code);return {status:'accepted' as const,providerReference:'fixture:'+id};},async reconcile(){return {status:'uncertain' as const,providerReference:null};}};
 const state=async()=>(await context.request.get(origin+'/api/browser/imessage/read')).json();
 const age=()=>sql.query(`update fmat.photon_link_challenges set created_at=created_at-interval '61 seconds',expires_at=expires_at-interval '61 seconds' where host_id='${host}';`);
 await sql.query(`insert into fmat.photon_receivers(project_id,receiver_id,enabled) values('${photonProject}','b4000000-0000-4000-8000-000000000030',true);`);
 try{
  await card.getByRole('button',{name:'Check iMessage status'}).click();await expect(card.getByRole('button',{name:'Connect iMessage',exact:true})).toBeEnabled();
  assert.match(await page.evaluate(()=>getComputedStyle(document.body).fontFamily),/Inter/i);
  const contrast=await page.evaluate(()=>{
   const style=getComputedStyle(document.documentElement),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true})!;
   const values=Object.fromEntries(['--muted-foreground','--background','--muted','--primary-foreground','--primary','--destructive','--card'].map(name=>{ctx.fillStyle=style.getPropertyValue(name);ctx.fillRect(0,0,1,1);return [name,[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(c=>{const v=c/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0)];}));
   return [['--muted-foreground','--background'],['--muted-foreground','--muted'],['--primary-foreground','--primary'],['--destructive','--card']].map(([a,b])=>{const x=values[a],y=values[b];return {pair:a+'/'+b,ratio:(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};});
  });for(const check of contrast)assert.ok(check.ratio>=4.5,check.pair+' text contrast');
  await card.getByRole('button',{name:'Connect iMessage',exact:true}).click();const phone=card.getByLabel('Private iMessage number');await expect(phone).toBeFocused();await expect(phone).toBeVisible();await phone.fill('+15550100001');
  await page.setViewportSize({width:320,height:844});await phone.focus();await phone.scrollIntoViewIfNeeded();await expect(phone).toBeInViewport();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/imessage-phone-mobile.png',fullPage:true});
  let lostStart=false;await page.route('**/api/browser/imessage/start',async route=>{if(lostStart)return route.continue();lostStart=true;await route.fetch();await route.abort('failed');});
  await card.getByRole('button',{name:'Send code',exact:true}).click();await card.getByRole('alert').waitFor();await card.getByRole('button',{name:'Send code',exact:true}).click();await card.getByText('Your code request is saved and waiting to send.',{exact:true}).waitFor();await page.unroute('**/api/browser/imessage/start');
  let current=await state();const first=current.challenge.id;assert.equal(await sql.query(`select count(*) from fmat.photon_link_challenges where host_id='${host}';`),'1');
  const cookies=await context.cookies();const binding=cookies.find(c=>c.name==='fmat-imessage');assert.ok(binding?.httpOnly);assert.equal(binding.sameSite,'Lax');assert.equal(await page.evaluate(()=>document.cookie.includes('fmat-imessage')),false);
  await dispatchLinkCodes(database,env,transport);assert.equal(sends,1);await card.getByRole('button',{name:'Check iMessage status'}).click();const codeInput=card.getByLabel('Six-digit iMessage code');await expect(codeInput).toBeFocused();await codeInput.fill(codes.get(first)!);
  await page.reload();await codeInput.waitFor();assert.equal(await codeInput.inputValue(),'','reload does not restore a verification code');
  // Same signed-in account in another browser cannot verify using a copied Auth
  // cookie: the independent proof is absent and no private field is shown.
  const wrong=await context.browser()!.newContext();await wrong.addCookies(cookies.filter(c=>c.name!=='fmat-imessage'));
  const denied=await wrong.request.post(origin+'/api/browser/imessage/verify',{headers:{origin},data:{challengeId:first,code:codes.get(first),idempotencyKey:crypto.randomUUID()}});assert.equal(denied.status(),400);await wrong.close();
  await codeInput.fill(codes.get(first)==='000000'?'111111':'000000');await card.getByRole('button',{name:'Confirm and link'}).click();await card.getByRole('alert').filter({hasText:'4 attempts remain'}).waitFor();assert.equal(await codeInput.inputValue(),'');
  await expect(codeInput).toHaveAttribute('aria-invalid','true');await expect(codeInput).toBeFocused();await expect(card.locator('form')).toBeVisible();assert.ok((await codeInput.boundingBox())!.height>=40,'Invalid-code recovery keeps a usable input layout');
  assert.ok(await card.locator('[data-slot="input-otp-slot"]').evaluateAll(slots=>slots.every(slot=>slot.getBoundingClientRect().height>=44)));
  await codeInput.fill(codes.get(first)!);await page.emulateMedia({reducedMotion:'reduce'});await codeInput.focus();await codeInput.scrollIntoViewIfNeeded();await expect(codeInput).toBeInViewport();await page.screenshot({path:'.local/rebuild/browser-screenshots/imessage-code-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});await codeInput.focus();await codeInput.scrollIntoViewIfNeeded();await page.screenshot({path:'.local/rebuild/browser-screenshots/imessage-code-desktop.png',fullPage:true});
  await page.evaluate(()=>{document.documentElement.style.zoom='2';});await codeInput.focus();await codeInput.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/imessage-code-zoom.png',fullPage:true});await page.evaluate(()=>{document.documentElement.style.zoom='';});
  await codeInput.focus();await codeInput.press('Tab');await expect(card.getByRole('button',{name:'Confirm and link'})).toBeFocused();
  await card.getByRole('button',{name:'Maybe later',exact:true}).focus();await expect(card.getByRole('button',{name:'Maybe later',exact:true})).toBeInViewport();await page.screenshot({path:'.local/rebuild/browser-screenshots/imessage-actions-desktop.png',fullPage:true});
  assert.ok(await page.getByRole('button',{name:'Jump to latest message'}).evaluate(button=>{
   const viewport=document.querySelector('[data-slot="message-scroller-viewport"]')!;
   return button.getBoundingClientRect().top>=viewport.getBoundingClientRect().bottom;
  }),'Latest-message control must not overlay focused inline actions');
  assert.ok((await page.getByRole('button',{name:'Jump to latest message'}).boundingBox())!.height>=44);
  let lostVerify=false;await page.route('**/api/browser/imessage/verify',async route=>{if(lostVerify)return route.continue();lostVerify=true;await route.fetch();await route.abort('failed');});
  await card.getByRole('button',{name:'Confirm and link'}).click();await card.getByRole('alert').waitFor();await page.reload();await card.getByText('iMessage connected · ••••0001',{exact:true}).waitFor();await page.unroute('**/api/browser/imessage/verify');
  assert.equal(await codeInput.count(),0);assert.equal(await sql.query(`select count(*) from fmat.photon_links where host_id='${host}' and revoked_at is null;`),'1');
  await card.getByRole('button',{name:'Unlink iMessage'}).click();await card.getByRole('button',{name:'Keep connected'}).click();assert.ok((await state()).link);await card.getByRole('button',{name:'Unlink iMessage'}).click();await card.getByRole('button',{name:'Confirm unlink'}).click();await card.getByRole('button',{name:'Connect iMessage',exact:true}).waitFor();assert.equal((await state()).link,null);
  await age();await card.getByRole('button',{name:'Connect iMessage',exact:true}).click();await phone.fill('+15550100002');await card.getByRole('button',{name:'Send code',exact:true}).click();await card.getByText('Your code request is saved and waiting to send.',{exact:true}).waitFor();current=await state();const second=current.challenge.id;
  await card.getByRole('button',{name:'Change number',exact:true}).click();await phone.waitFor();assert.equal(await codeInput.count(),0);assert.equal(await sql.query(`select revoked_at is not null and encrypted_code is null from fmat.photon_link_challenges where id='${second}';`),'t');
  await card.getByRole('button',{name:'Maybe later',exact:true}).click();await card.getByText('You chose to continue on the web.',{exact:false}).waitFor();await page.reload();await card.getByText('You chose to continue on the web.',{exact:false}).waitFor();assert.equal((await state()).skipped,true);
  // Expiry is derived locally and server-side; a known failed dispatch never
  // offers a verification input or silently sends again.
  await age();await card.getByRole('button',{name:'Connect iMessage',exact:true}).click();await phone.fill('+15550100003');await card.getByRole('button',{name:'Send code',exact:true}).click();await card.getByText('Your code request is saved and waiting to send.',{exact:true}).waitFor();current=await state();const third=current.challenge.id;
  await sql.query(`update fmat.photon_link_challenges set created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' where id='${third}';`);await card.getByRole('button',{name:'Check iMessage status'}).click();await card.getByText('This code has expired.',{exact:false}).waitFor();assert.equal(await codeInput.count(),0);
  await card.getByRole('button',{name:'Request a new code'}).click();await phone.fill('+15550100004');await card.getByRole('button',{name:'Send code',exact:true}).click();await card.getByText('Your code request is saved and waiting to send.',{exact:true}).waitFor();
  await dispatchLinkCodes(database,env,{...transport,async send(){return {status:'failed',providerReference:null};}});await card.getByRole('button',{name:'Check iMessage status'}).click();await card.getByText('The code could not be delivered.',{exact:false}).waitFor();assert.equal(await codeInput.count(),0);
  await card.getByRole('button',{name:'Maybe later',exact:true}).click();await card.getByText('You chose to continue on the web.',{exact:false}).waitFor();await page.reload();await card.getByText('You chose to continue on the web.',{exact:false}).waitFor();
  // Protected values never enter persisted conversations, model messages,
  // saved card state, page text or browser storage.
  const snapshot=await sql.query(`select coalesce(string_agg(to_jsonb(t)::text,''),'') from fmat.setup_turns t where conversation_id in(select id from fmat.setup_conversations where host_id='${host}');`);
  const runtime=await sql.query(`select coalesce(string_agg(to_jsonb(m)::text,''),'') from fmat.runtime_messages m where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');`);
  for(const value of codes.values()){assert.ok(!snapshot.includes(value));assert.ok(!runtime.includes(value));assert.ok(!(await page.locator('body').innerText()).includes(value));}
  assert.deepEqual(await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)})),{local:[],session:[]});assert.equal(await page.getByLabel('Message your scheduling assistant').inputValue(),'');assert.equal(new URL(page.url()).pathname,'/app');
 }finally{
  await sql.query(`delete from fmat.audit_events where operation in('photon_link','photon_unlink') and actor->>'id'='${host}';delete from fmat.photon_links where project_id='${photonProject}';delete from fmat.photon_link_challenges where project_id='${photonProject}';delete from fmat.photon_receivers where project_id='${photonProject}';`);
 }
}

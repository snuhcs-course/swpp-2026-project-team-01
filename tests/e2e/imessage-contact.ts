import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect,type Page,type BrowserContext} from '@playwright/test';
import {Database} from '../../lib/server/database/client.ts';
import {dispatchContactShares} from '../../lib/server/photon/contact-delivery.ts';
import type {LocalSql} from '../integration/local-sql.ts';

export async function verifyContactSharing(page:Page,context:BrowserContext,host:string,env:Record<string,string>,sql:LocalSql){
 const origin='http://localhost:3000',base=origin+'/api/browser/imessage/contact/',card=page.getByRole('region',{name:'iMessage contact card'});
 const add=card.getByRole('button',{name:'Add to contacts',exact:true}),refresh=card.getByRole('button',{name:'Check contact status'});
 const link=(await (await context.request.get(origin+'/api/browser/imessage/read')).json()).link.id;
 const count=()=>sql.query(`select count(*) from fmat.photon_contact_shares where host_id='${host}';`);
 await expect(add).toBeEnabled();assert.equal(await count(),'0','Linking does not request a card');
 for(const [path,options,status] of [
  ['request',{headers:{origin:'https://other.example'},data:{linkId:link,idempotencyKey:randomUUID()}},403],
  ['request',{headers:{origin},data:{linkId:randomUUID(),idempotencyKey:randomUUID()}},404],
  ['request',{headers:{origin},data:{linkId:link,idempotencyKey:randomUUID(),phone:'+15550109999'}},400],
 ] as const){assert.equal((await context.request.post(base+path,options)).status(),status);}
 const anonymous=await context.browser()!.newContext();try{assert.equal((await anonymous.request.get(base+'read?linkId='+link)).status(),401);}finally{await anonymous.close();}
 assert.equal(await count(),'0');
 // A failed initial status read must not expose a speculative send action.
 await page.route('**/api/browser/imessage/contact/read?*',route=>route.abort());await refresh.click();await card.getByRole('alert').waitFor();await expect(add).toHaveCount(0);
 await page.unroute('**/api/browser/imessage/contact/read?*');await refresh.click();await expect(add).toBeEnabled();
 await page.setViewportSize({width:320,height:844});await add.focus();await add.scrollIntoViewIfNeeded();await expect(add).toBeInViewport();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.ok((await add.boundingBox())!.height>=44);
 await page.screenshot({path:'.local/rebuild/browser-screenshots/imessage-contact-mobile.png',fullPage:true});
 const attempts:string[]=[];let committed=false;
 await page.route('**/api/browser/imessage/contact/request',async route=>{
  attempts.push(route.request().postDataJSON().idempotencyKey);
  if(attempts.length===1)return route.abort();
  await route.fetch();committed=true;await route.abort();
 });
 await page.keyboard.press('Enter');await card.getByRole('alert').waitFor();assert.equal(await count(),'0');
 await refresh.click();await expect(add).toBeEnabled();
 await add.evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
 await card.getByRole('alert').waitFor();assert.equal(committed,true);assert.equal(attempts.length,2);assert.equal(attempts[0],attempts[1]);assert.equal(await count(),'1');
 await page.unroute('**/api/browser/imessage/contact/request');await page.reload();await card.getByText('Your contact card request is queued.',{exact:true}).waitFor();await expect(add).toHaveCount(0);
 const read=await context.request.get(base+'read?linkId='+link);assert.match(read.headers()['cache-control'],/private, no-store/);assert.ok(read.headers().vary.split(',').map(value=>value.trim().toLowerCase()).includes('cookie'));
 const saved=await read.json();assert.deepEqual(Object.keys(saved).sort(),['id','linkId','requestedAt','status']);
 let sends=0;const database=new Database(env);
 await dispatchContactShares(database,env,{async shareContact(_route,_phone,authorize){await authorize();sends++;return {status:'accepted'};}});
 await refresh.click();await card.getByText('The messaging service accepted the contact card request.',{exact:false}).waitFor();await expect(add).toHaveCount(0);
 await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>{document.documentElement.style.zoom='2';});await refresh.focus();await refresh.scrollIntoViewIfNeeded();await expect(refresh).toBeInViewport();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'.local/rebuild/browser-screenshots/imessage-contact-zoom.png',fullPage:true});await page.evaluate(()=>{document.documentElement.style.zoom='';});
 // A controlled replacement simulates another authenticated browser linking.
 // Hold a response for the old link across replacement to test stale-result fencing.
 let release!:()=>void,seen!:()=>void;const held=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>seen=resolve);
 await page.route('**/api/browser/imessage/contact/read?*',async route=>{if(!route.request().url().endsWith(link))return route.continue();const response=await route.fetch();seen();await held;await route.fulfill({response}).catch(()=>{});});
 await refresh.click();await started;
 const replacement=randomUUID(),challenge=randomUUID();
 await sql.query(`update fmat.photon_links set revoked_at=now() where id='${link}';insert into fmat.photon_link_challenges(id,host_id,project_id,credential,browser_hash,phone,line,space_id,code_hash,request_key,consumed_at) select '${challenge}',c.host_id,c.project_id,c.credential,c.browser_hash,c.phone,c.line,c.space_id,c.code_hash,'${challenge}',now() from fmat.photon_link_challenges c join fmat.photon_links l on l.challenge_id=c.id where l.id='${link}';insert into fmat.photon_links(id,host_id,project_id,phone,line,space_id,challenge_id) select '${replacement}',host_id,project_id,phone,line,space_id,'${challenge}' from fmat.photon_links where id='${link}';`);
 await page.getByRole('button',{name:'Check iMessage status'}).click();await expect(add).toBeEnabled();release();await page.unroute('**/api/browser/imessage/contact/read?*');await expect(card.getByText('No contact card requested.',{exact:true})).toBeVisible();
 assert.equal((await context.request.post(base+'request',{headers:{origin},data:{linkId:link,idempotencyKey:randomUUID()}})).status(),404);
 await add.click();await card.getByText('Your contact card request is queued.',{exact:true}).waitFor();
 await dispatchContactShares(database,env,{async shareContact(_route,_phone,authorize){await authorize();sends++;return {status:'uncertain'};}});
 await refresh.click();await card.getByText('The contact card result is uncertain.',{exact:false}).waitFor();await expect(add).toHaveCount(0);
 await page.reload();await card.getByText('The contact card result is uncertain.',{exact:false}).waitFor();await refresh.click();await dispatchContactShares(database,env,{async shareContact(){throw new Error('Unexpected repeat native share');}});assert.equal(sends,2);
}

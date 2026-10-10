import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect,type Page} from '@playwright/test';
import type {LocalSql} from '../integration/local-sql.ts';

export async function verifyHostRequestListRecovery(page:Page,sql:LocalSql,host:string){
 assert.equal(new URL(page.url()).origin,'http://localhost:3000');
 const ids=Array.from({length:35},()=>randomUUID()),prefix='Picker '+randomUUID(),endpoint='**/api/browser/host/requests?*';
 const picker=page.getByRole('region',{name:'Meeting request picker'}),toggle=page.getByRole('button',{name:'Meeting requests',exact:true}),loading=picker.getByRole('status').filter({hasText:'Loading requests…'});
 let release=()=>{},entered=()=>{},wait=new Promise<void>(resolve=>{release=resolve;}),arrived=new Promise<void>(resolve=>{entered=resolve;}),reads=0;
 const routed:Promise<void>[]=[];
 await sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values ${ids.map((id,n)=>`('${id}','${host}',jsonb_build_object('purpose','${prefix} ${n}','requesterName','Picker fixture'),encode(extensions.digest('${id}','sha256'),'hex'),now()+interval '1 day')`).join(',')};`);
 try{
  await page.route(endpoint,route=>{const index=++reads;const work=(async()=>{entered();await wait;if(index===1)await route.fulfill({status:503,json:{error:{message:'Request list is temporarily unavailable.'}}});else await route.continue();})();routed.push(work);return work;});
  await toggle.click();await arrived;await expect(loading).toBeVisible();await expect(picker.getByRole('listitem')).toHaveCount(0);
  release();await Promise.all(routed);await expect(picker.getByRole('alert')).toContainText('Request list is temporarily unavailable.');await expect(loading).toHaveCount(0);
  await page.setViewportSize({width:320,height:900});const retry=picker.getByRole('button',{name:'Retry list',exact:true});await retry.focus();await expect(retry).toBeInViewport();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/host-request-list-error-320.png'});
  wait=new Promise<void>(resolve=>{release=resolve;});arrived=new Promise<void>(resolve=>{entered=resolve;});
  await page.keyboard.press('Enter');await arrived;await expect(loading).toBeVisible();await expect(picker.getByRole('alert')).toHaveCount(0);
  release();await Promise.all(routed);await expect(picker.getByRole('listitem')).toHaveCount(30);await page.unroute(endpoint);
  await picker.getByLabel('Search requests',{exact:true}).fill(prefix);const searched=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/browser/host/requests'&&new URL(response.url()).searchParams.get('search')===prefix);await picker.getByRole('button',{name:'Search requests',exact:true}).click();await (await searched).finished();await expect(picker.getByRole('listitem').filter({hasText:prefix})).toHaveCount(30);
  const first=await picker.getByRole('listitem').allTextContents();assert.equal(first.length,30);assert.ok(first.every(text=>text.includes(prefix)));
  await picker.getByRole('button',{name:'Older requests',exact:true}).click();await expect(picker.getByRole('listitem')).toHaveCount(5);
  const second=await picker.getByRole('listitem').allTextContents();assert.equal(new Set([...first,...second]).size,35);await expect(picker.getByRole('button',{name:'Older requests',exact:true})).toHaveCount(0);
  await picker.getByRole('button',{name:'Refresh newest',exact:true}).click();await expect(picker.getByRole('listitem')).toHaveCount(30);assert.deepEqual(await picker.getByRole('listitem').allTextContents(),first);
  await picker.getByLabel('Search requests',{exact:true}).fill(prefix+' absent');await picker.getByRole('button',{name:'Search requests',exact:true}).click();await expect(picker.getByText('No requests match this search.',{exact:true})).toBeVisible();await expect(picker.getByRole('listitem')).toHaveCount(0);
  assert.equal(new URL(page.url()).pathname,'/app');await toggle.click();await expect(picker).toHaveCount(0);
 }finally{release();await Promise.allSettled(routed);await page.unroute(endpoint);await page.setViewportSize({width:1280,height:900});await sql.query(`delete from fmat.requests where host_id='${host}' and id in(${ids.map(id=>`'${id}'`).join(',')});`);}
}

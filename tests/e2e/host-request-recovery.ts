import assert from 'node:assert/strict';
import {expect,type Page} from '@playwright/test';

export async function verifyHostRequestRecovery(page:Page,requestId:string){
 const origin=new URL(page.url()).origin;assert.equal(origin,'http://localhost:3000');
 const endpoint='**/api/browser/host/request?*',selected=page.getByRole('region',{name:'Selected meeting request'});
 const error=page.getByRole('alert').filter({hasText:'Request unavailable'}),loading=page.getByRole('status').filter({hasText:'Opening your selected request…'});
 let release=()=>{};
 const routed:Promise<void>[]=[];
 try{
  await page.route(endpoint,route=>route.fulfill({status:503,json:{error:{message:'Request could not be loaded. Try again.'}}}));
  await page.goto(origin+'/app?request='+requestId);
  await expect(error).toContainText('Request could not be loaded.');await expect(loading).toHaveCount(0);
  await expect(selected).toHaveCount(0);await expect(page.getByLabel('Message your scheduling assistant')).toHaveCount(0);
  await page.setViewportSize({width:320,height:900});
  const retry=error.getByRole('button',{name:'Retry request',exact:true});await retry.focus();await expect(retry).toBeInViewport();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'.local/rebuild/browser-screenshots/host-request-read-error-320.png'});
  await page.unroute(endpoint);
  let entered!:()=>void;const arrived=new Promise<void>(resolve=>{entered=resolve;}),wait=new Promise<void>(resolve=>{release=resolve;});
  await page.route(endpoint,route=>{const work=(async()=>{entered();await wait;await route.continue();})();routed.push(work);return work;});
  await retry.click();await arrived;
  await expect(loading).toBeVisible();await expect(error).toHaveCount(0);await expect(selected).toHaveCount(0);
  release();await Promise.all(routed);await expect(selected.getByText('Separate discussion',{exact:true})).toBeVisible();await expect(loading).toHaveCount(0);
  await expect(selected.getByText('Separate discussion',{exact:true})).toBeFocused();
  await page.unroute(endpoint);

  // Leaving a delayed selection must not let its eventual result replace setup.
  let enteredAgain!:()=>void;const arrivedAgain=new Promise<void>(resolve=>{enteredAgain=resolve;}),waitAgain=new Promise<void>(resolve=>{release=resolve;});
  await page.route(endpoint,route=>{const work=(async()=>{const response=await route.fetch();enteredAgain();await waitAgain;await route.fulfill({response});})();routed.push(work);return work;});
  await page.reload();await arrivedAgain;await expect(loading).toBeVisible();
  await page.getByRole('button',{name:'Back to host chat',exact:true}).click();
  await expect(page.getByRole('region',{name:'Your meeting setup'})).toBeVisible();
  const lateResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/browser/host/request');
  release();await Promise.all(routed);await (await lateResponse).finished();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expect(selected).toHaveCount(0);await expect(loading).toHaveCount(0);await expect(error).toHaveCount(0);
  assert.equal(new URL(page.url()).pathname,'/app');assert.equal(new URL(page.url()).search,'');
 }finally{release();await Promise.allSettled(routed);await page.unroute(endpoint);await page.setViewportSize({width:1280,height:900});}
}

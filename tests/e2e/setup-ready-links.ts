import assert from 'node:assert/strict';
import {expect,type Page,type BrowserContext} from '@playwright/test';

export async function verifyReadyLinks(page:Page,context:BrowserContext,origin:string){
 assert.equal(origin,'http://localhost:3000');
 const before=await (await context.request.get(origin+'/api/browser/setup/read')).json();
 const region=page.getByRole('region',{name:'Share your booking link'}),booking=region.getByRole('link',{name:'Open booking page'}),instructions=region.getByRole('link',{name:'Open agent instructions'});
 await expect(booking).toHaveAttribute('href','/'+before.confirmed.handle);
 await expect(instructions).toHaveAttribute('href','/'+before.confirmed.handle+'/SKILL.md');
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});await booking.focus();await expect(booking).toBeInViewport();
  assert.ok((await booking.boundingBox())!.height>=44);assert.notEqual(await booking.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
  await page.keyboard.press('Tab');await expect(instructions).toBeFocused();assert.ok((await instructions.boundingBox())!.height>=44);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`.local/rebuild/browser-screenshots/readiness-${width}.png`});
 }
 await page.evaluate(()=>{document.documentElement.style.zoom='2';});await booking.focus();await expect(booking).toBeInViewport();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'.local/rebuild/browser-screenshots/readiness-zoom.png'});await page.evaluate(()=>{document.documentElement.style.zoom='';});
 // A refocus checks current access and immediately hides the previous result.
 let release!:()=>void,entered!:()=>void;const arrived=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
 await page.route('**/api/browser/setup/readiness',async route=>{entered();await wait;await route.fulfill({status:503,json:{error:{message:'Calendar access could not be checked.'}}});});
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await arrived;await expect(booking).toHaveCount(0);await expect(region.getByRole('status')).toHaveText('Checking your booking link and Calendar access…');release();
 await expect(region.getByRole('alert')).toContainText('Calendar access could not be checked.');await page.unroute('**/api/browser/setup/readiness');
 await page.route('**/api/browser/setup/readiness',route=>route.fulfill({json:{ready:false,reason:'calendar'}}));
 await region.getByRole('button',{name:'Check booking link again'}).click();await expect(region.getByRole('alert')).toContainText('writable booking destination');await expect(booking).toHaveCount(0);
 await page.unroute('**/api/browser/setup/readiness');await region.getByRole('button',{name:'Check booking link again'}).click();await expect(booking).toBeVisible();
 assert.deepEqual(await (await context.request.get(origin+'/api/browser/setup/read')).json(),before,'Readiness checks cannot mutate setup');
 await page.setViewportSize({width:1280,height:900});await page.emulateMedia({reducedMotion:'no-preference'});
}

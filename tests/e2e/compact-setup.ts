import {verifyCalendarChoicesRecovery} from './calendar-choices-recovery.ts';
import assert from 'node:assert/strict';
import {expect,type Page,type BrowserContext} from '@playwright/test';

export async function verifyCompactSetup(page:Page,context:BrowserContext,origin:string){
 assert.equal(origin,'http://localhost:3000');
 const setup=page.getByRole('region',{name:'Your meeting setup'}),choices=page.getByRole('region',{name:'Calendar choices'});
 const before=await (await context.request.get(origin+'/api/browser/setup/read')).json();
 const change=choices.getByRole('button',{name:'Change calendar choices'});
 await expect(change).toHaveAttribute('aria-expanded','false');await expect(choices.getByRole('checkbox')).toHaveCount(0);
 await expect(setup.getByRole('figure')).toHaveCount(0);
 const show=setup.getByRole('button',{name:'Show preference details'});await show.focus();await page.keyboard.press('Enter');
 await expect(setup.getByRole('figure',{name:'Your confirmed meeting week'})).toBeVisible();
 const hide=setup.getByRole('button',{name:'Hide preference details'});await hide.focus();await page.keyboard.press('Enter');await expect(show).toBeFocused();
 // Compact state never hides invalid saved selections or a failed authorized read.
 await page.route('**/api/browser/calendar/list',async route=>{const response=await route.fetch(),body=await response.json();body.calendars=body.calendars.filter((c:{id:string})=>c.id!==body.bookingCalendarId);await route.fulfill({response,json:body});});
 await page.reload();await choices.getByRole('alert').filter({hasText:'A saved calendar is no longer available'}).waitFor();await expect(choices.getByRole('checkbox').first()).toBeVisible();await expect(choices.getByRole('button',{name:'Change calendar choices'})).toHaveCount(0);
 await page.unroute('**/api/browser/calendar/list');
 await verifyCalendarChoicesRecovery(page);
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});await change.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(change).toBeFocused();await page.evaluate(()=>window.scrollTo(0,0));
  await expect(change).toBeInViewport();assert.ok((await change.boundingBox())!.height>=44);assert.notEqual(await change.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`.local/rebuild/browser-screenshots/compact-setup-${width}.png`});
  await show.focus();await expect(show).toBeInViewport();await page.screenshot({path:`.local/rebuild/browser-screenshots/compact-preferences-${width}.png`});
  const composer=page.getByLabel('Message your scheduling assistant');await composer.focus();await expect(composer).toBeInViewport();
  await page.screenshot({path:`.local/rebuild/browser-screenshots/compact-composer-${width}.png`});
 }
 await page.evaluate(()=>{document.documentElement.style.zoom='2';});await change.focus();await expect(change).toBeInViewport();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'.local/rebuild/browser-screenshots/compact-setup-zoom.png'});
 await change.click();const close=choices.getByRole('button',{name:'Close without saving'});await expect(close).toHaveAttribute('aria-expanded','true');await choices.getByRole('checkbox').first().focus();await expect(choices.getByRole('checkbox').first()).toBeInViewport();await page.screenshot({path:'.local/rebuild/browser-screenshots/compact-calendar-edit-zoom.png'});await close.click();await expect(change).toBeFocused();
 await page.evaluate(()=>{document.documentElement.style.zoom='';});await page.setViewportSize({width:1280,height:900});await page.emulateMedia({reducedMotion:'no-preference'});
 const after=await (await context.request.get(origin+'/api/browser/setup/read')).json();assert.deepEqual(after,before,'Disclosure and recovery checks do not change setup');
}

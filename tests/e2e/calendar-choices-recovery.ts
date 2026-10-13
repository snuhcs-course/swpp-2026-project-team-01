import assert from 'node:assert/strict';
import {expect,type Page} from '@playwright/test';
export async function verifyCalendarChoicesRecovery(page:Page){
 const origin=new URL(page.url()).origin;assert.equal(origin,'http://localhost:3000');
 // Let persisted chat replay settle before testing isolated read recovery.
 const savedReplies=await page.locator('.chat-response').allTextContents();
 const before=await (await page.request.get(origin+'/api/browser/calendar/list')).json();
 const panel=page.getByRole('region',{name:'Calendar choices'}),retry=panel.getByRole('button',{name:'Try again',exact:true});
 const error=panel.getByRole('alert').filter({hasText:'Calendar choices could not be loaded.'}),endpoint='**/api/browser/calendar/list';
 try{
  await page.route(endpoint,route=>route.fulfill({status:503,json:{error:{message:'Calendar choices could not be loaded.'}}}));
  await page.reload();await expect(page.locator('.chat-response')).toHaveText(savedReplies);await expect(error).toBeVisible();await expect(panel.getByRole('checkbox')).toHaveCount(0);await expect(panel).toHaveAttribute('aria-busy','false');
  await page.unroute(endpoint);
  await page.route(endpoint,route=>route.fulfill({json:{...before,calendars:[]}}));
  await retry.click();await expect(panel.getByText('No checked calendars. Check a calendar in Google Calendar, then return to this page.',{exact:true})).toBeVisible();
  await expect(panel.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();await expect(panel.locator('legend')).toBeFocused();
  await page.unroute(endpoint);
  let release=()=>{};const held=new Promise<void>(resolve=>release=resolve);
  await page.route(endpoint,async route=>{await held;await route.abort().catch(()=>{});});
  await page.reload();await expect(page.locator('.chat-response')).toHaveText(savedReplies);await expect(error).toBeVisible({timeout:25_000});release();await page.unroute(endpoint);
  await page.setViewportSize({width:320,height:900});await retry.focus();await expect(retry).toBeInViewport();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'.local/rebuild/browser-screenshots/calendar-choices-timeout-320.png'});
  await page.keyboard.press('Enter');await expect(panel.getByRole('button',{name:'Change calendar choices',exact:true})).toBeFocused();await expect(error).toHaveCount(0);
  assert.deepEqual(await (await page.request.get(origin+'/api/browser/calendar/list')).json(),before,'Recovery does not alter saved selections');
 }finally{await page.unroute(endpoint);await page.setViewportSize({width:1280,height:900});}
}

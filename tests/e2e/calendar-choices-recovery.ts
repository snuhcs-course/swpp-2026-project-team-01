import assert from 'node:assert/strict';
import {expect,type Page} from '@playwright/test';

export async function verifyCalendarChoicesRecovery(page:Page){
 const origin=new URL(page.url()).origin;assert.equal(origin,'http://localhost:3000');
 const before=await (await page.request.get(origin+'/api/browser/calendar/list')).json();
 const panel=page.getByRole('region',{name:'Calendar choices'}),reload=panel.getByRole('button',{name:'Reload calendar choices',exact:true});
 const loading=panel.getByRole('status').filter({hasText:'Loading your calendars…'}),error=panel.getByRole('alert').filter({hasText:'Calendar choices could not be loaded.'});
 const endpoint='**/api/browser/calendar/list',routed:Promise<void>[]=[];
 let release=()=>{},entered=()=>{},wait:Promise<void>,arrived:Promise<void>;
 function hold(){wait=new Promise<void>(resolve=>release=resolve);arrived=new Promise<void>(resolve=>entered=resolve);}
 try{
  hold();await page.route(endpoint,route=>{const work=(async()=>{entered();await wait;await route.fulfill({status:503,json:{error:{message:'Calendar choices could not be loaded.'}}});})();routed.push(work);return work;});
  await reload.click();await arrived!;await expect(loading).toBeVisible();await expect(panel).toHaveAttribute('aria-busy','true');await expect(panel.getByRole('checkbox')).toHaveCount(0);
  release();await Promise.all(routed);await expect(error).toBeFocused();await expect(loading).toHaveCount(0);await expect(panel).toHaveAttribute('aria-busy','false');await page.unroute(endpoint);
  // Empty metadata is distinct from a failed read and cannot enable saving.
  hold();await page.route(endpoint,route=>{const work=(async()=>{entered();await wait;await route.fulfill({json:{...before,calendars:[]}});})();routed.push(work);return work;});
  await reload.focus();await page.keyboard.press('Enter');await arrived!;await expect(error).toHaveCount(0);await expect(loading).toBeVisible();release();await Promise.all(routed);
  await expect(panel.getByText('No calendars are available. Reconnect Google with an account that has calendars.',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Confirm calendar choices'})).toBeDisabled();await expect(panel.getByRole('checkbox')).toHaveCount(0);await expect(panel.locator('legend').filter({hasText:'Calendars to check for conflicts'})).toBeFocused();await page.unroute(endpoint);
  // A truly stalled fetch must leave loading without a response or user action.
  hold();await page.route(endpoint,route=>{const work=(async()=>{entered();await wait;await route.abort();})();routed.push(work);return work;});
  await reload.click();await arrived!;await expect(loading).toBeVisible();await expect(error).toBeFocused({timeout:20_000});await expect(loading).toHaveCount(0);await expect(panel).toHaveAttribute('aria-busy','false');
  release();await Promise.allSettled(routed);await page.unroute(endpoint);
  await page.setViewportSize({width:320,height:900});await reload.focus();await expect(reload).toBeInViewport();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/calendar-choices-timeout-320.png'});
  await page.keyboard.press('Enter');await expect(panel.getByRole('button',{name:'Change calendar choices',exact:true})).toBeFocused();await expect(error).toHaveCount(0);await expect(loading).toHaveCount(0);
  assert.deepEqual(await (await page.request.get(origin+'/api/browser/calendar/list')).json(),before,'Read failure, empty metadata and timeout do not alter saved selections');
 }finally{release();await Promise.allSettled(routed);await page.unroute(endpoint);await page.setViewportSize({width:1280,height:900});}
}

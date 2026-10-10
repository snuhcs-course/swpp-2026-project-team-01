import assert from 'node:assert/strict';
import {expect,type Page} from '@playwright/test';

export async function verifyCalendarReadRecovery(page:Page,requestId?:string){
 const origin=new URL(page.url()).origin;assert.equal(origin,'http://localhost:3000');
 const path=requestId?'/booking/'+requestId:'/app',endpoint=origin+'/api/browser/calendar/status'+(requestId?'?requestId='+requestId:'');
 const before=await (await page.request.get(endpoint)).json(),viewport=page.viewportSize();
 const match=(url:URL)=>url.pathname==='/api/browser/calendar/status';
 const panel=page.getByRole('region',{name:'Google Calendar connection'}),loading=panel.getByRole('status').filter({hasText:'Checking Google Calendar connection…'});
 let release=()=>{},entered=()=>{},arrived=new Promise<void>(resolve=>{entered=resolve;}),wait=new Promise<void>(resolve=>{release=resolve;}),reads=0;
 const routed:Promise<void>[]=[];
 try{
  await page.route(match,route=>{const read=++reads;const work=(async()=>{entered();await wait;if(read===1)await route.fulfill({status:503,json:{error:{message:'Calendar connection could not be checked.'}}});else await route.continue();})();routed.push(work);return work;});
  await page.goto(origin+path+(requestId?'':'?calendar=connected'));await arrived;
  await expect(loading).toBeVisible();await expect(panel).toHaveAttribute('aria-busy','true');
  await expect(panel.getByRole('button',{name:'Connect Google Calendar',exact:true})).toHaveCount(0);
  await expect(panel.getByText('Google Calendar connected',{exact:true})).toHaveCount(0);
  release();await Promise.all(routed);
  await expect(panel.getByRole('alert')).toContainText('Calendar connection could not be checked.');if(!requestId)await expect(panel.getByRole('alert')).toBeFocused();
  await expect(loading).toHaveCount(0);await expect(panel).toHaveAttribute('aria-busy','false');
  await expect(panel.getByText('Google connection saved.',{exact:true})).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'Connect Google Calendar',exact:true})).toHaveCount(0);
  if(requestId)await expect(panel.getByRole('button',{name:'Enter availability manually',exact:true})).toBeEnabled();
  await page.setViewportSize({width:320,height:900});
  const retry=panel.getByRole('button',{name:'Retry connection status',exact:true});await retry.focus();await panel.getByRole('alert').scrollIntoViewIfNeeded();await expect(retry).toBeInViewport();await expect(panel.getByRole('alert')).toBeInViewport();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'.local/rebuild/browser-screenshots/calendar-status-error-'+(requestId?'guest':'host')+'-320.png'});
  arrived=new Promise<void>(resolve=>{entered=resolve;});wait=new Promise<void>(resolve=>{release=resolve;});
  await retry.click();await arrived;await expect(loading).toBeVisible();await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'Retry connection status',exact:true})).toHaveCount(0);
  release();await Promise.all(routed);await expect(loading).toHaveCount(0);
  if(before.connected)await expect(panel.getByText('Google Calendar connected',{exact:true})).toBeVisible();
  else await expect(panel.getByRole('button',{name:'Connect Google Calendar',exact:true})).toBeEnabled();
  await expect(panel.getByRole('status').filter({hasText:requestId?'Calendar connection checked.':'Google connection saved.'})).toBeFocused();
  assert.equal(new URL(page.url()).search,'');assert.deepEqual(await (await page.request.get(endpoint)).json(),before,'Read recovery preserves connection and selections');
 }finally{release();await Promise.allSettled(routed);await page.unroute(match);if(viewport)await page.setViewportSize(viewport);}
}

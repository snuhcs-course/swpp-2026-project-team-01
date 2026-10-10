import {verifySetupEditorReadNavigation} from './setup-editor-read-navigation.ts';
import assert from 'node:assert/strict';
import {expect,type Page,type BrowserContext} from '@playwright/test';

export async function verifySetupReadRecovery(page:Page,context:BrowserContext,origin:string){
 assert.equal(origin,'http://localhost:3000');
 const before=await (await context.request.get(origin+'/api/browser/setup/read')).json();
 const setup=page.getByRole('region',{name:'Your meeting setup'}),reload=setup.getByRole('button',{name:'Reload setup',exact:true});
 const loading=setup.getByRole('status').filter({hasText:'Loading setup…'}),error=setup.getByRole('alert');
 const endpoint='**/api/browser/setup/read';
 let release=()=>{};
 try{
  await page.route(endpoint,route=>route.fulfill({status:503,json:{error:{message:'Setup could not be loaded. Try again.'}}}));
  await page.reload();await expect(error).toContainText('Setup could not be loaded.');
  await expect(loading).toHaveCount(0);await expect(setup).toHaveAttribute('aria-busy','false');await expect(reload).toBeEnabled();
  await expect(setup.getByRole('button',{name:'Edit profile',exact:true})).toHaveCount(0);
  await expect(setup.getByRole('link',{name:'Open booking page'})).toHaveCount(0);
  await page.setViewportSize({width:320,height:900});await reload.focus();await expect(reload).toBeInViewport();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'.local/rebuild/browser-screenshots/setup-read-error-320.png'});
  await page.unroute(endpoint);
  let entered!:()=>void;const arrived=new Promise<void>(resolve=>{entered=resolve;}),wait=new Promise<void>(resolve=>{release=resolve;});
  await page.route(endpoint,async route=>{entered();await wait;await route.continue();});
  await reload.click();await arrived;
  await expect(loading).toBeVisible();await expect(error).toHaveCount(0);await expect(setup).toHaveAttribute('aria-busy','true');
  await expect(reload).toBeDisabled();release();
  await expect(setup.getByRole('button',{name:'Edit profile',exact:true})).toBeEnabled();
  await expect(loading).toHaveCount(0);await expect(error).toHaveCount(0);await expect(setup).toHaveAttribute('aria-busy','false');
  await page.unroute(endpoint);
  await verifySetupEditorReadNavigation(page);
  // A failed refresh must not leave previously published links actionable.
  await page.route(endpoint,route=>route.fulfill({status:503,json:{error:{message:'Setup could not be loaded. Try again.'}}}));
  await reload.click();await expect(error).toContainText('Setup could not be loaded.');await expect(loading).toHaveCount(0);
  await expect(setup.getByRole('link',{name:'Open booking page'})).toHaveCount(0);
  await page.unroute(endpoint);await reload.click();
  await expect(setup.getByRole('link',{name:'Open booking page'})).toBeVisible();await expect(error).toHaveCount(0);
  assert.deepEqual(await (await context.request.get(origin+'/api/browser/setup/read')).json(),before,'Read retries cannot alter the saved draft or confirmed settings');
 }finally{
  release();await page.unroute(endpoint);await page.setViewportSize({width:1280,height:900});
 }
}

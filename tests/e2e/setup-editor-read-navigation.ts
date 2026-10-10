import assert from 'node:assert/strict';
import {expect,type Page} from '@playwright/test';

export async function verifySetupEditorReadNavigation(page:Page){
 const origin=new URL(page.url()).origin;assert.equal(origin,'http://localhost:3000');
 const setup=page.getByRole('region',{name:'Your meeting setup'}),edit=setup.getByRole('button',{name:'Edit profile',exact:true});
 const before=await (await page.request.get(origin+'/api/browser/setup/read')).json();
 let release!:()=>void,entered!:()=>void;const wait=new Promise<void>(resolve=>release=resolve),arrived=new Promise<void>(resolve=>entered=resolve),routed:Promise<void>[]=[];
 let writes=0;const observe=(request:import('@playwright/test').Request)=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/browser/setup/draft')writes++;};
 page.on('request',observe);
 try{
  await page.route('**/api/browser/setup/read',route=>{const work=(async()=>{entered();await wait;await route.continue();})();routed.push(work);return work;});
  await setup.getByRole('button',{name:'Reload setup',exact:true}).click();await arrived;await expect(setup).toHaveAttribute('aria-busy','true');
  await expect(edit).toBeEnabled();await edit.focus();await page.keyboard.press('Enter');
  const heading=setup.locator('legend').filter({hasText:/^Your booking profile$/});await expect(heading).toBeFocused();
  const name=setup.getByLabel('Display name',{exact:true});await name.fill('Unsubmitted local edit');
  await expect(setup.getByRole('button',{name:'Use these preferences in my draft',exact:true})).toBeDisabled();
  // Programmatic form submission still cannot bypass the pending-read guard.
  await name.evaluate(element=>element.closest('form')!.requestSubmit());
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));assert.equal(writes,0);
  await setup.getByRole('button',{name:'Cancel edit',exact:true}).click();await expect(edit).toBeFocused();
  await page.keyboard.press('Enter');await expect(heading).toBeFocused();await name.fill('Retained through read');
  release();await Promise.all(routed);await expect(setup).toHaveAttribute('aria-busy','false');
  await expect(name).toHaveValue('Retained through read');await expect(name).toBeFocused();
  await setup.getByRole('button',{name:'Cancel edit',exact:true}).click();await expect(edit).toBeFocused();assert.equal(writes,0);
  assert.deepEqual(await (await page.request.get(origin+'/api/browser/setup/read')).json(),before,'Local editing and cancelled review do not mutate saved setup');
 }finally{release();await Promise.allSettled(routed);await page.unroute('**/api/browser/setup/read');page.off('request',observe);}
}

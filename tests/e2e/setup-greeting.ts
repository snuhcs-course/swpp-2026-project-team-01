import assert from 'node:assert/strict';
import {expect,type Page} from '@playwright/test';

export async function verifySetupGreeting(page:Page){
 const origin=new URL(page.url()).origin;assert.equal(origin,'http://localhost:3000');
 const before=await (await page.request.get(origin+'/api/browser/setup/read')).json();
 const panel=page.getByRole('region',{name:'Google Calendar connection'});
 const greeting=panel.getByText('Hi! I’m your scheduling assistant. Let’s set up your meetings together.',{exact:true});
 const connect=panel.getByRole('button',{name:'Connect Google Calendar',exact:true});
 const manual=page.getByRole('button',{name:'Set preferences without connecting yet',exact:true});
 await expect(greeting).toHaveCount(1);await expect(connect).toBeEnabled();await expect(manual).toBeVisible();
 await expect(page.getByLabel('Message your scheduling assistant')).toBeEnabled();
 await expect(page.locator('.chat-composer')).toHaveCSS('opacity','1');
 await expect(panel.locator('[data-slot="ai-message"]')).toHaveCount(2);
 await expect(panel.locator('[data-slot="ai-message-content"] button')).toHaveCount(0);
 await expect(panel.locator('[data-slot="chat-action"]').getByRole('button',{name:'Connect Google Calendar',exact:true})).toHaveCount(1);
 assert.equal(await greeting.evaluate(node=>node.closest('[data-slot="ai-message"]')?.textContent?.includes('Could you connect Google Calendar?')),false);
 await expect(page.getByRole('button',{name:'Meeting requests',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Edit profile',exact:true})).toHaveCount(0);
 await expect(page.getByRole('region',{name:'Calendar suggestions'})).toHaveCount(0);
 const viewport=page.viewportSize();
 for(const [width,height] of [[1280,900],[390,844],[320,640]]){
  await page.setViewportSize({width,height});await greeting.scrollIntoViewIfNeeded();
  await expect(greeting).toBeInViewport();await expect(connect).toBeInViewport();
  await expect(page.getByLabel('Message your scheduling assistant')).toBeInViewport();
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeInViewport();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`.local/rebuild/browser-screenshots/setup-greeting-${width}.png`});
 }
 const account=page.getByRole('button',{name:'Workspace menu'});await account.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('menuitem',{name:'Meeting requests',exact:true})).toBeVisible();
 await expect(page.getByRole('menuitem',{name:'Host chat',exact:true})).toBeVisible();
 await expect(page.getByRole('menuitem',{name:'Manage agent permissions'})).toBeVisible();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'.local/rebuild/browser-screenshots/setup-account-menu-320.png'});await page.keyboard.press('Escape');await expect(account).toBeFocused();
 await manual.focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Edit profile',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Hide manual setup',exact:true}).click();
 await page.reload();await expect(greeting).toHaveCount(1);await expect(manual).toBeVisible();
 assert.deepEqual(await (await page.request.get(origin+'/api/browser/setup/read')).json(),before,'Opening manual controls and reloading cannot change saved setup');
 // The chat button, not a direct API shortcut, starts the existing PKCE flow.
 let consent:URL|undefined;
 await page.route('https://accounts.google.com/**',async route=>{consent=new URL(route.request().url());await route.fulfill({status:200,contentType:'text/html',body:'<p>Controlled Google consent boundary</p>'});});
 try{
  await connect.focus();await page.keyboard.press('Enter');await page.getByText('Controlled Google consent boundary').waitFor();
  assert.ok(consent);assert.equal(consent.searchParams.get('redirect_uri'),origin+'/connections/google/callback');
  assert.equal(consent.searchParams.get('code_challenge_method'),'S256');
  await page.goto(origin+'/connections/google/callback?state='+encodeURIComponent(consent.searchParams.get('state')!)+'&error=access_denied');
  await expect(panel.getByRole('status').filter({hasText:'Google connection was skipped.'})).toBeFocused();
  await expect(greeting).toHaveCount(1);await expect(connect).toBeEnabled();
  assert.deepEqual(await (await page.request.get(origin+'/api/browser/setup/read')).json(),before);
 }finally{await page.unroute('https://accounts.google.com/**');if(viewport)await page.setViewportSize(viewport);}
}

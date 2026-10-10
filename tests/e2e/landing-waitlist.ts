import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect,type Page,type BrowserContext,type Request} from '@playwright/test';
import type {LocalSql} from '../integration/local-sql.ts';

export async function verifyLandingWaitlist(page:Page,context:BrowserContext,origin:string,sql:LocalSql){
 const email=`landing-${randomUUID()}@example.test`,inputs:{email:string;name:string;idempotencyKey:string}[]=[],apiCalls:string[]=[];
 const observe=(request:Request)=>{if(request.url().startsWith(origin+'/api/'))apiCalls.push(new URL(request.url()).pathname);};
 page.on('request',observe);
 try{
  await page.goto(origin+'/');
  await expect(page.getByRole('heading',{level:1})).toContainText('good conversation');
  await expect(page.getByRole('link',{name:'Open your host workspace'})).toHaveAttribute('href','/app');
  const form=page.getByRole('form',{name:'Join the waitlist'}),address=form.getByLabel('Email address'),submit=form.getByRole('button',{name:'Join the waitlist',exact:true});
  await expect(form).toBeVisible();assert.deepEqual(apiCalls,[],'Landing has no authenticated bootstrap or private history request');
  await address.fill('invalid-address');await submit.click();assert.deepEqual(apiCalls,[],'Native email validation prevents invalid submissions');
  await form.getByLabel('Name (optional)').fill('Synthetic applicant');await address.fill(email);
  await page.route('**/api/browser/waitlist',async route=>{
   inputs.push(route.request().postDataJSON());const response=await route.fetch();assert.equal(response.status(),200);
   if(inputs.length===1)await route.abort('failed');else await route.fulfill({response});
  });
  await address.focus();await page.keyboard.press('Tab');await expect(submit).toBeFocused();await page.keyboard.press('Enter');
  await expect(form.getByRole('alert')).toContainText('couldn’t confirm');await expect(form.getByRole('alert')).toBeFocused();
  await expect(address).toHaveValue(email);assert.equal(await sql.query(`select count(*) from fmat.waitlist where email='${email}';`),'1','First response is lost after a real commit');
  await submit.click();await expect(form.getByRole('status')).toContainText('You’re on the list');
  assert.equal(inputs.length,2);assert.deepEqual(inputs[1],inputs[0],'Uncertain retry preserves the exact command and key');
  await page.unroute('**/api/browser/waitlist');await page.reload();
  await address.fill(email.toUpperCase());await submit.click();await expect(form.getByRole('status')).toContainText('You’re on the list');
  assert.equal(await sql.query(`select count(*) from fmat.waitlist where email='${email}';`),'1','Reload and normalized email remain deduplicated');
  assert.equal(await sql.query(`select (select count(*) from fmat.hosts where email='${email}')+(select count(*) from auth.users where email='${email}')+(select count(*) from fmat.invitations where email='${email}');`),'0','Enrollment creates no identity, invitation or host access');
  assert.equal((await context.request.get(origin+'/api/browser/host/state')).status(),401);
  assert.ok(apiCalls.every(path=>path==='/api/browser/waitlist'));
  assert.deepEqual(await context.cookies(),[],'Enrollment installs no auth/request credential');
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const width of [320,390,1280]){
   await page.setViewportSize({width,height:900});await form.scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await expect(submit).toBeInViewport();
   await page.screenshot({path:`.local/rebuild/browser-screenshots/landing-waitlist-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:640,height:900});await page.evaluate(()=>{document.documentElement.style.zoom='2';});await submit.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await expect(submit).toBeInViewport();
  await page.screenshot({path:'.local/rebuild/browser-screenshots/landing-waitlist-zoom.png',fullPage:true});
 }finally{
  page.off('request',observe);await page.unroute('**/api/browser/waitlist');
  await page.evaluate(()=>{document.documentElement.style.zoom='';});await page.setViewportSize({width:1280,height:900});await page.emulateMedia({reducedMotion:'no-preference'});
  await sql.query(`delete from fmat.idempotency where operation='waitlist_join' and input->>'email'='${email}';delete from fmat.waitlist where email='${email}';`);
 }
}

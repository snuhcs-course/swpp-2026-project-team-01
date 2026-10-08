import assert from 'node:assert/strict';
import {expect,type Page,type Locator,type BrowserContext} from '@playwright/test';

// Runs inside the authenticated local browser journey, including model failure.
export async function verifyWeeklyPreview(page:Page,setup:Locator,context:BrowserContext,origin:string){
 assert.equal(origin,'http://localhost:3000');
 const before=await (await context.request.get(origin+'/api/browser/setup/read')).json();
 const preview=setup.getByRole('figure',{name:'Your edited meeting week'});
 await preview.waitFor();assert.equal(await preview.getByRole('listitem').count(),7);
 const window=setup.getByRole('group',{name:'Window 1',exact:true});
 const start=window.getByLabel('Window start 1',{exact:true}),end=window.getByLabel('Window end 1',{exact:true});
 const oldStart=await start.inputValue(),oldEnd=await end.inputValue();
 const sunday=window.getByRole('checkbox',{name:'Sunday',exact:true}),oldSunday=await sunday.isChecked();
 await start.fill('');await expect(preview.getByText('Complete the days and start/end times to preview unfinished windows.')).toBeVisible();
 await end.fill('23:45');await start.fill('22:15');await sunday.check();
 const sundayRow=preview.getByRole('listitem').filter({hasText:'Sunday'});
 await expect(sundayRow).toContainText('22:15–23:45');
 assert.equal((await (await context.request.get(origin+'/api/browser/setup/read')).json()).revision,before.revision,'Preview edits do not save a draft');
 // Native time controls may tab through hour/minute/period segments first.
 await start.focus();for(let i=0;i<6&&!await end.evaluate(e=>e===document.activeElement);i++)await page.keyboard.press('Tab');await expect(end).toBeFocused();
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});await preview.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await preview.evaluate(e=>e.scrollWidth>e.clientWidth),false);
  const caption=preview.locator('figcaption');await caption.scrollIntoViewIfNeeded();await expect(caption).toBeInViewport();
  await page.screenshot({path:`.local/rebuild/browser-screenshots/weekly-preview-${width}-top.png`});
  await sundayRow.scrollIntoViewIfNeeded();await expect(sundayRow).toBeInViewport();
  await page.screenshot({path:`.local/rebuild/browser-screenshots/weekly-preview-${width}-bottom.png`});
 }
 await page.evaluate(()=>{document.documentElement.style.zoom='2';});await preview.scrollIntoViewIfNeeded();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await preview.locator('figcaption').scrollIntoViewIfNeeded();await expect(preview.locator('figcaption')).toBeInViewport();
 await page.screenshot({path:'.local/rebuild/browser-screenshots/weekly-preview-zoom-top.png'});
 await sundayRow.scrollIntoViewIfNeeded();await expect(sundayRow).toBeInViewport();
 await page.screenshot({path:'.local/rebuild/browser-screenshots/weekly-preview-zoom-bottom.png'});
 assert.equal(await preview.locator('.weekly-preview-window').first().evaluate(e=>getComputedStyle(e).animationName),'none');
 await page.evaluate(()=>{document.documentElement.style.zoom='';});await page.setViewportSize({width:1280,height:900});
 await start.fill(oldStart);await end.fill(oldEnd);await sunday.setChecked(oldSunday);
 await setup.getByRole('button',{name:'Cancel edit'}).click();
 const after=await (await context.request.get(origin+'/api/browser/setup/read')).json();assert.deepEqual(after.draft,before.draft,'Cancel preserves the existing draft');
 await setup.getByRole('button',{name:'Edit schedule',exact:true}).click();
 await expect(setup.getByLabel('Window start 1',{exact:true})).toHaveValue(oldStart);
 await page.emulateMedia({reducedMotion:'no-preference'});
}

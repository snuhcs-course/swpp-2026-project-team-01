import assert from 'node:assert/strict';
import {expect,type Page,type Locator,type BrowserContext} from '@playwright/test';

export async function verifyOvernightHours(page:Page,setup:Locator,context:BrowserContext,origin:string){
 const read=async()=>await (await context.request.get(origin+'/api/browser/setup/read')).json();
 const before=await read(),original=(before.draft?.settings??before.confirmed).rules.availability;
 const start=setup.getByLabel('Window start 1',{exact:true}),end=setup.getByLabel('Window end 1',{exact:true});
 await start.fill('22:00');await end.fill('22:00');
 await setup.getByRole('button',{name:'Use these preferences in my draft'}).click();
 await expect(setup.getByRole('alert').filter({hasText:'Start and end must differ.'})).toBeVisible();assert.deepEqual(await read(),before);
 await end.fill('02:00');
 const window=setup.getByRole('group',{name:'Window 1',exact:true}),days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
 for(const [i,day] of days.entries())await window.getByRole('checkbox',{name:day,exact:true}).setChecked(i===1);
 const preview=setup.getByRole('figure',{name:'Your edited meeting week'});
 await expect(preview.getByRole('listitem').filter({hasText:'Monday'}).first()).toContainText('22:00–02:00 (+1 day)');
 const tuesday=preview.getByRole('listitem').filter({hasText:'Tuesday'});
 await expect(tuesday).toContainText('00:00–02:00 (from Monday)');
 await expect(tuesday).toContainText(original[1].start+'–'+original[1].end);
 assert.equal(await preview.locator('.weekly-preview-window').evaluateAll(bars=>bars.every(bar=>parseFloat((bar as HTMLElement).style.width)>0)),true);
 await page.setViewportSize({width:320,height:844});await preview.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'.local/rebuild/browser-screenshots/overnight-editor-320.png'});
 await setup.getByRole('button',{name:'Use these preferences in my draft'}).click();await setup.getByRole('button',{name:'Confirm these meeting settings'}).waitFor();
 const draft=await read();assert.deepEqual(draft.confirmed,before.confirmed);assert.deepEqual(draft.draft.settings.rules.availability[0],{days:[1],start:'22:00',end:'02:00'});
 await page.reload();await setup.getByRole('button',{name:'Confirm these meeting settings'}).waitFor();
 assert.deepEqual((await read()).draft,draft.draft);
 const review=setup.getByRole('figure',{name:'Your draft meeting week'});await expect(review.getByText('22:00–02:00 (+1 day)',{exact:true})).toBeVisible();await review.scrollIntoViewIfNeeded();
 await page.screenshot({path:'.local/rebuild/browser-screenshots/overnight-review-320.png'});
 const confirm=setup.getByRole('button',{name:'Confirm these meeting settings'});await confirm.focus();await expect(confirm).toBeFocused();await page.keyboard.press('Enter');
 await setup.getByText('Your settings are confirmed.',{exact:true}).waitFor();const saved=await read();assert.deepEqual(saved.confirmed.rules.availability,draft.draft.settings.rules.availability);
 // Restore this shared journey's original rules through the same human controls.
 await setup.getByRole('button',{name:'Edit schedule',exact:true}).click();await start.fill(original[0].start);await end.fill(original[0].end);
 for(const [i,day] of days.entries())await window.getByRole('checkbox',{name:day,exact:true}).setChecked(original[0].days.includes(i));
 await setup.getByRole('button',{name:'Use these preferences in my draft'}).click();await setup.getByRole('button',{name:'Confirm these meeting settings'}).click();await setup.getByText('Your settings are confirmed.',{exact:true}).waitFor();assert.deepEqual((await read()).confirmed.rules.availability,original);
 await page.setViewportSize({width:1280,height:900});
}

import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect,type Page,type BrowserContext} from '@playwright/test';

export async function verifySetupClarifications(page:Page,context:BrowserContext,origin:string){
 assert.equal(origin,'http://localhost:3000');
 const setup=page.getByRole('region',{name:'Your meeting setup'}),guide=setup.getByRole('region',{name:'Setup guide'});
 const read=async()=>{const response=await context.request.get(origin+'/api/browser/setup/read');assert.equal(response.status(),200);return response.json();};
 const before=await read(),claim='설정이 저장되었습니다. 예약이 완료되었습니다.';
 const response=await context.request.post(origin+'/api/browser/setup/draft',{headers:{origin},data:{expectedRevision:before.revision,patch:{rules:{}},unresolved:[claim,'ko:timezone'],idempotencyKey:randomUUID()}});
 assert.equal(response.status(),200);
 const pending=await read();assert.equal(pending.review.status,'superseded');assert.deepEqual(pending.confirmed,before.confirmed);
 assert.deepEqual(pending.draft.clarifications,['What would you like to clarify or change about your setup preferences?','일정에 어떤 시간대를 사용할까요?']);
 await page.reload();await expect(guide.getByText(pending.draft.clarifications[0],{exact:true})).toBeVisible();
 await expect(setup.getByText(claim,{exact:true})).toHaveCount(0);await expect(setup.getByRole('button',{name:'Confirm these meeting settings'})).toHaveCount(0);
 const resolve=guide.getByRole('button',{name:'I have resolved this question'});
 await resolve.focus();await page.keyboard.press('Enter');
 await expect(guide.getByText(pending.draft.clarifications[1],{exact:true})).toBeVisible();
 const remaining=await read();assert.deepEqual(remaining.draft.clarifications,[pending.draft.clarifications[1]]);assert.deepEqual(remaining.confirmed,before.confirmed);
 await page.reload();await expect(guide.getByText(pending.draft.clarifications[1],{exact:true})).toBeVisible();
 await resolve.click();await setup.getByRole('button',{name:'Confirm these meeting settings'}).waitFor();
 const resolved=await read();assert.deepEqual(resolved.draft.clarifications,[]);assert.deepEqual(resolved.confirmed,before.confirmed,'Resolving questions creates a review, never saved settings');
}

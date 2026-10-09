import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {setupFailureState} from './setup-failure.ts';

test('setup failure evidence identifies hidden ancestors without collecting private content',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  await page.setContent('<div data-slot="message-scroller-viewport" data-pending-scroll style="visibility:hidden"><section aria-label="Your meeting setup"><section aria-label="Connect iMessage"><input type="tel" value="private-phone-sentinel" data-secret="private-attribute-sentinel"></section></section></div><p>private-body-sentinel</p>');
  const result=await setupFailureState(page);
  assert.equal(result.phone.length,1);
  assert.ok(result.phone[0].ancestors.some(a=>a.pendingScroll&&a.visibility==='hidden'));
  assert.equal(result.phone[0].focused,false);
  assert.ok(!JSON.stringify(result).includes('sentinel'));
  await page.setContent('<p>No setup controls</p>');
  assert.deepEqual(await setupFailureState(page),{setup:[],imessage:[],phone:[],code:[],form:[],viewport:[]});
 }finally{await browser.close();}
});

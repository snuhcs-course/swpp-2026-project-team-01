import {setupReadFocusState} from './setup-read-focus.ts';
import {privateCheckboxProbe} from './private-checkbox-probe.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {setupFailureState} from './setup-failure.ts';

test('setup failure evidence identifies hidden ancestors without collecting private content',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  await page.setContent('<div data-slot="message-scroller-viewport" data-pending-scroll style="visibility:hidden"><section aria-label="Your meeting setup"><input type="time" value="12:34" data-secret="private-time-sentinel"><section aria-label="Connect iMessage"><input type="tel" value="private-phone-sentinel" data-secret="private-attribute-sentinel"></section></section></div><p>private-body-sentinel</p>');
  const result=await setupFailureState(page);
  assert.equal(result.phone.length,1);assert.equal(result.times.length,1);
  assert.ok(result.phone[0].ancestors.some(a=>a.pendingScroll&&a.visibility==='hidden'));
  assert.equal(result.phone[0].focused,false);
  assert.ok(!JSON.stringify(result).includes('sentinel'));
  await page.setContent('<p>No setup controls</p>');
  assert.deepEqual(await setupFailureState(page),{times:[],setup:[],imessage:[],phone:[],code:[],form:[],viewport:[]});
 }finally{await browser.close();}
});


test('private checkbox trace distinguishes field growth from scroll movement without private content',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  await page.setContent('<div data-slot="message-scroller-viewport" style="height:200px;overflow:auto"><form aria-label="Additional preferences decision"><textarea style="height:64px;display:block">private-reason-sentinel</textarea><button type="button" role="checkbox" aria-checked="false" data-secret="private-attribute-sentinel">private-label-sentinel</button><div style="height:500px"></div></form></div>');
  await page.evaluate(privateCheckboxProbe);
  const states=await page.evaluate(()=>{
   const probe=(window as unknown as {privateCheckboxDiagnostic:{state:()=>unknown;stop:()=>void}}).privateCheckboxDiagnostic;
   const before=probe.state();document.querySelector('textarea')!.style.height='120px';
   const grown=probe.state();document.querySelector('[data-slot="message-scroller-viewport"]')!.scrollTop=20;
   const scrolled=probe.state();probe.stop();return {before,grown,scrolled};
  }) as {before:{textarea:{height:number};viewportScrollTop:number};grown:{textarea:{height:number};viewportScrollTop:number};scrolled:{textarea:{height:number};viewportScrollTop:number}};
  assert.equal(states.grown.textarea.height-states.before.textarea.height,56);
  assert.equal(states.grown.viewportScrollTop,states.before.viewportScrollTop);
  assert.equal(states.scrolled.viewportScrollTop,20);
  assert.equal(states.scrolled.textarea.height,states.grown.textarea.height);
  assert.ok(!JSON.stringify(states).includes('sentinel'));
 }finally{await browser.close();}
});


test('setup retry geometry is serializable before mobile viewport cleanup',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:320,height:900}});
  await page.setContent('<div data-slot="message-scroller-viewport" data-pending-scroll style="height:100px;overflow:auto"><div style="height:400px"></div><button data-secret="private-attribute-sentinel">Reload setup</button><input value="private-value-sentinel"></div>');
  const button=page.getByRole('button',{name:'Reload setup'}),before=await setupReadFocusState(button);
  assert.equal(before.window.width,320);assert.equal(before.focused,false);assert.equal(before.pending,true);
  assert.ok(before.button.y>before.viewport!.y+before.viewport!.height);
  await button.focus();const focused=await setupReadFocusState(button);
  assert.equal(focused.focused,true);assert.ok(focused.scrollTop!>before.scrollTop!);
  assert.ok(focused.button.y<focused.viewport!.y+focused.viewport!.height);
  assert.ok(!JSON.stringify(focused).includes('sentinel'));
  await page.setViewportSize({width:1280,height:900});
  assert.equal(before.window.width,320,'Captured mobile geometry survives later cleanup resize');
 }finally{await browser.close();}
});

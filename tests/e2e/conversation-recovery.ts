import assert from 'node:assert/strict';
import {expect,type Page} from '@playwright/test';

/** Browser behavior with controlled recovery responses. Actual terminal-runtime
 * and SQL transition acceptance is covered separately, never inferred here. */
export async function verifyConversationRecoveryControls(page:Page){
 const snapshots=/\/api\/browser\/conversations\/[a-f0-9-]{36}$/;
 const recoveries='**/api/browser/conversations/*/recovery',streams='**/api/browser/conversations/*/stream?*';
 let scope='',generation=0,state='recovery_required',posts:unknown[]=[],lose=true,commit=false,readsFail=false;
 const recoveryId=crypto.randomUUID(),pendingId=crypto.randomUUID(),pendingText='Saved pending recovery fixture';
 const status=()=>({conversationId:scope,generation,state,...(state==='recovering'?{recoveryId}:{})});
 await page.route(snapshots,async route=>{
  const response=await route.fetch(),body=await response.json();scope=body.conversationId;
  body.messages.push({id:pendingId,text:pendingText,status:'pending',mine:true,createdAt:new Date().toISOString()});
  await route.fulfill({response,json:body});
 });
 await page.route(streams,route=>route.fulfill({status:200,contentType:'application/x-ndjson',body:JSON.stringify({type:'message',cursor:1,turnId:'recovery-history',text:'Earlier saved discussion.'})+'\n'}));
 await page.route(recoveries,async route=>{
  if(route.request().method()==='POST'){
   posts.push(route.request().postDataJSON());if(commit){generation++;state='recovering';}
   if(lose)return route.abort();
  }else if(readsFail)return route.fulfill({status:503,json:{error:{code:'PROVIDER_UNAVAILABLE',message:'unavailable'}}});
  await route.fulfill({json:status()});
 });
 try{
  await page.reload();
  const card=page.getByRole('alert',{name:'Conversation recovery'}),input=page.getByLabel('Message your scheduling assistant');
  await expect(card.getByText('Conversation needs recovery',{exact:true})).toBeVisible();
  const edit=page.getByRole('region',{name:'Your meeting setup'}).getByRole('button',{name:'Edit schedule',exact:true});
  await expect(edit).toBeEnabled();await expect(page.getByText('Earlier saved discussion.',{exact:true})).toHaveCount(1);
  await input.fill('Unsent private draft');await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
  await card.getByText('Saved pending messages',{exact:true}).click();await expect(card.getByText(pendingText,{exact:true})).toBeVisible();
  const recover=card.getByRole('button',{name:'Recover conversation',exact:true});await recover.focus();await expect(recover).toBeFocused();await page.keyboard.press('Enter');
  await expect(card.getByRole('button',{name:'Retry same recovery'})).toBeEnabled();assert.equal(posts.length,1);
  await expect(input).toHaveValue('Unsent private draft');await expect(input).toBeFocused();await expect(edit).toBeEnabled();await expect(page.getByText('Earlier saved discussion.',{exact:true})).toHaveCount(1);
  const stored=await page.evaluate(scope=>sessionStorage.getItem('fmat:conversation-recovery:v1:'+scope),scope);assert.deepEqual(JSON.parse(stored!),posts[0]);assert.ok(!stored!.includes('private'));
  await page.reload();await expect(card.getByRole('button',{name:'Retry same recovery'})).toBeEnabled();assert.equal(posts.length,1,'Reload only reads status');
  await card.getByRole('button',{name:'Retry same recovery'}).click();await expect(card.getByRole('button',{name:'Retry same recovery'})).toBeEnabled();assert.deepEqual(posts[1],posts[0]);
  // Simulate a lost committed response followed by reload. The read must resolve
  // the old retry without posting another transition.
  commit=true;await card.getByRole('button',{name:'Retry same recovery'}).click();await expect.poll(()=>generation).toBe(1);
  await page.reload();await expect(card.getByText('Conversation recovery is ready',{exact:true})).toBeVisible();assert.equal(posts.length,3);assert.deepEqual(posts[2],posts[0]);
  assert.equal(await page.evaluate(scope=>sessionStorage.getItem('fmat:conversation-recovery:v1:'+scope),scope),null);
  await expect(card.getByRole('button',{name:'Recover conversation',exact:true})).toHaveCount(0);await expect(edit).toBeEnabled();
  await card.getByText('Saved pending messages',{exact:true}).click();await expect(card.getByText(pendingText,{exact:true})).toBeVisible();
  // A failed inspection and exhausted allowance preserve structured controls.
  readsFail=true;await input.fill('Still unsent');await card.getByRole('button',{name:'Check recovery status'}).click();await expect(card.getByText(/Recovery status is unavailable/)).toBeVisible();await expect(input).toHaveValue('Still unsent');await expect(edit).toBeEnabled();
  readsFail=false;state='limit_reached';await card.getByRole('button',{name:'Check recovery status'}).click();await expect(card.getByText('Conversation limit reached',{exact:true})).toBeVisible();await expect(edit).toBeEnabled();await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
  state='recovery_required';await card.getByRole('button',{name:'Check recovery status'}).click();await expect(card.getByRole('button',{name:'Recover conversation'})).toBeEnabled();
  await page.setViewportSize({width:320,height:800});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.local/rebuild/browser-screenshots/conversation-recovery-320.png',fullPage:true});
 }finally{
  await page.unroute(snapshots);await page.unroute(streams);await page.unroute(recoveries);
  await page.evaluate(scope=>sessionStorage.removeItem('fmat:conversation-recovery:v1:'+scope),scope);
  await page.setViewportSize({width:1280,height:900});await page.reload();
 }
}

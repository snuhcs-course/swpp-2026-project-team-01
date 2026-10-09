import {expect,type Page} from '@playwright/test';

// An interrupted historical replay is display history, not current accepted work.
export async function verifyHistoricalBusyReplay(page:Page){
 let served=false,pending=false;
 const path='**/api/browser/conversations/*/stream?*';
 await page.route(path,async route=>{
  if(!served){served=true;await route.fulfill({status:200,contentType:'application/x-ndjson',body:JSON.stringify({type:pending?'turn.completed':'turn.started',cursor:1,turnId:'historical-completed-turn'})+'\n'});}
  else await route.fulfill({status:204});
 });
 try{
  const replay=page.waitForResponse(response=>response.url().includes('/stream?')&&response.status()===200);
  const idle=page.waitForResponse(response=>response.url().includes('/stream?')&&response.status()===204);
  await page.reload();await replay;await idle;
  await expect(page.getByRole('region',{name:'Your meeting setup'}).getByRole('button',{name:'Edit schedule',exact:true})).toBeEnabled();
  await expect(page.getByRole('status').filter({hasText:'Your conversation is saved. Approval and booking always need confirmed actions.'})).toBeVisible();
  // A completed stream event must not clear genuinely pending application work.
  const snapshots=/\/api\/browser\/conversations\/[a-f0-9-]{36}$/;
  await page.route(snapshots,async route=>{const response=await route.fetch(),body=await response.json();body.messages.at(-1).status='pending';await route.fulfill({response,json:body});});
  try{
   served=false;pending=true;
   const pendingIdle=page.waitForResponse(response=>response.url().includes('/stream?')&&response.status()===204);
   await page.reload();await pendingIdle;
   await expect(page.getByRole('region',{name:'Your meeting setup'}).getByRole('button',{name:'Edit schedule',exact:true})).toBeDisabled();
   await expect(page.getByRole('status').filter({hasText:'Your message is saved. The assistant is responding…'})).toBeVisible();
  }finally{await page.unroute(snapshots);}
 }finally{await page.unroute(path);await page.reload();}
}

import {expect,type Page,type Route,type APIResponse} from '@playwright/test';

export async function verifyReceiptSnapshotOrdering(page:Page){
 const snapshots=/\/api\/browser\/conversations\/[a-f0-9-]{36}$/;
 const streams='**/api/browser/conversations/*/stream?*',messages='**/api/browser/conversations/*/messages';
 const messageId=crypto.randomUUID(),text='Controlled snapshot ordering fixture';
 let reads=0,stale: {route:Route;response:APIResponse}|undefined,fresh:Route|undefined;
 await page.route(streams,route=>route.fulfill({status:204}));
 await page.route(snapshots,async route=>{
  reads++;
  if(reads===1)return route.continue();
  if(reads===2){stale={route,response:await route.fetch()};return;}
  fresh=route;
 });
 await page.route(messages,route=>route.fulfill({json:{messageId,status:'pending'}}));
 try{
  await page.reload();await expect.poll(()=>!!stale).toBe(true);
  await page.getByLabel('Message your scheduling assistant').fill(text);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  const edit=page.getByRole('region',{name:'Your meeting setup'}).getByRole('button',{name:'Edit schedule',exact:true});
  await expect(edit).toBeDisabled();
  await stale!.route.fulfill({response:stale!.response});
  await expect.poll(()=>!!fresh).toBe(true);
  await expect(edit).toBeDisabled();
  // A read begun after acceptance can still settle the current input.
  const body=await stale!.response.json();body.messages.push({id:messageId,text,status:'completed',createdAt:new Date().toISOString(),mine:true});
  await fresh!.fulfill({json:body});fresh=undefined;
  await expect(edit).toBeEnabled();
 }finally{
  await stale?.route.abort().catch(()=>{});await fresh?.abort().catch(()=>{});
  await page.unroute(snapshots);await page.unroute(streams);await page.unroute(messages);await page.reload();
 }
}

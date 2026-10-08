import {expect,type Page,type Route} from '@playwright/test';

/** Reconnect must interrupt a pending snapshot without reloading the workspace
 * or disturbing the independently tracked message submission identity. */
export async function verifyConversationReconnect(page:Page){
 const snapshots=/\/api\/browser\/conversations\/[a-f0-9-]{36}$/;
 let reads=0,held:Route|undefined;
 await page.route(snapshots,async route=>{
  reads++;
  if(reads===1)return route.abort('failed');
  if(reads===2){held=route;return;}
  return route.continue();
 });
 try{
  await page.reload();
  const reconnect=page.getByRole('button',{name:'Reconnect now',exact:true});
  await expect(reconnect).toBeVisible();
  await expect.poll(()=>reads,{timeout:15000}).toBe(2);
  await expect(page.getByLabel('Message your scheduling assistant')).toBeDisabled();
  await reconnect.click();
  await expect(page.getByLabel('Message your scheduling assistant')).toBeEnabled({timeout:10000});
  await expect(reconnect).toHaveCount(0);
  await page.screenshot({path:'.local/rebuild/browser-screenshots/conversation-reconnected.png',fullPage:true});
 }finally{
  await held?.abort('failed').catch(()=>{});
  await page.unroute(snapshots);
 }
}

import {verifyPublicSkill} from './public-skill.ts';
import {verifyRequesterIdentity} from './requester-identity.ts';
import assert from 'node:assert/strict';
import {verifyBookingApproval} from './booking-approval.ts';
import {verifyScheduling} from './scheduling.ts';
import {verifyHostRequests} from './host-requests.ts';
import {verifyPrivateReview} from './private-review.ts';
import {expect,type Browser,type Page} from '@playwright/test';
import type {LocalSql} from '../integration/local-sql.ts';
export async function verifyPublicIntake(browser:Browser,origin:string,sql:LocalSql,host:string,hostPage:Page){
 await verifyRequesterIdentity(browser,origin,sql,host);
 const handle='browser-'+host.slice(0,8),context=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'America/New_York',reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(15000);
 try{
  await verifyPublicSkill(context.request,origin,handle);
  await page.goto(origin+'/'+handle);await page.getByLabel('Your name',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Your timezone',{exact:true}).inputValue(),'America/New_York');
  assert.equal((await context.request.get(origin+'/api/browser/host/state')).status(),401,'requester has no host account');
  const profile=await context.request.get(origin+'/api/browser/intake/profile?handle='+handle);assert.equal(profile.status(),200);assert.match(profile.headers()['cache-control'],/private.*no-store/);assert.deepEqual(Object.keys(await profile.json()).sort(),['displayName','durationMinutes','handle','timezone']);
  await page.getByLabel('Your name',{exact:true}).fill('요청자');await page.getByLabel('Email address',{exact:true}).fill('public-requester@example.test');await page.getByLabel('What would you like to discuss?',{exact:true}).fill('연구 이야기');await page.getByLabel('Your timezone',{exact:true}).fill('Asia/Seoul');
  await page.screenshot({path:'.local/rebuild/browser-screenshots/intake-desktop.png',fullPage:true});
  await page.setViewportSize({width:320,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.ok(await page.getByRole('button',{name:'Continue to my conversation'}).evaluate(e=>e.getBoundingClientRect().height>=44));
  await page.getByLabel('Your timezone').focus();await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Continue to my conversation'}).evaluate(e=>e===document.activeElement),true);
  await page.screenshot({path:'.local/rebuild/browser-screenshots/intake-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>{document.documentElement.style.zoom='2';});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/intake-zoom.png',fullPage:true});await page.evaluate(()=>{document.documentElement.style.zoom='';});
  const binding=await context.request.post(origin+'/api/browser/intake/bind',{headers:{origin},data:{handle}}),attempt=(await binding.json()).attemptId;
  assert.equal((await context.request.post(origin+'/api/browser/intake/create',{headers:{origin:'https://wrong.test'},data:{handle,attemptId:attempt,details:{}}})).status(),403);
  let lost=false;await page.route('**/api/browser/intake/create',async route=>{if(lost)return route.continue();lost=true;const result=await route.fetch();assert.equal(result.status(),200);await route.abort('failed');});
  await page.getByRole('button',{name:'Continue to my conversation'}).click();await page.getByRole('button',{name:'Retry this request'}).waitFor();assert.equal(await page.getByLabel('Your name').isDisabled(),true);
  await page.getByRole('button',{name:'Retry this request'}).click();await page.waitForURL('**/booking/*');await page.getByRole('heading',{name:'연구 이야기',exact:true}).waitFor();
  const id=new URL(page.url()).pathname.split('/').at(-1)!;assert.match(id,/^[a-f0-9-]{36}$/u);assert.equal(new URL(page.url()).hash,'');assert.equal(new URL(page.url()).search,'');
  assert.equal(await sql.query(`select count(*) from fmat.requests where host_id='${host}';`),'1');
  assert.equal(await sql.query(`select details->>'timezone' from fmat.requests where id='${id}';`),'Asia/Seoul');
  assert.equal(await sql.query(`select contact_verified_email is null and status='gathering' from fmat.requests where id='${id}';`),'t');
  const cookies=await context.cookies();assert.ok(cookies.filter(c=>c.name.startsWith('fmat-')).every(c=>c.httpOnly&&c.sameSite==='Lax'));
  assert.equal(await page.evaluate(()=>document.cookie),'');assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:Object.entries(sessionStorage)})),{local:0,session:[['fmat-display-timezone-v1','Asia/Seoul']]});
  const other=await browser.newContext();try{
   assert.equal((await other.request.get(origin+'/api/browser/guest/state?requestId='+id)).status(),401);
   assert.equal((await other.request.post(origin+'/api/browser/intake/resume',{headers:{origin},data:{handle,attemptId:attempt}})).status(),401);
  }finally{await other.close();}
  // A real eve tool stores a review; a lost browser decision response cannot
  // duplicate the domain mutation or silently treat model prose as approval.
  await page.getByLabel('Message your scheduling assistant').fill('save: A reviewed discussion');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByRole('button',{name:'Apply suggested details'}).waitFor();
  await page.getByRole('status').filter({hasText:'Your conversation is saved.'}).waitFor();
  await page.getByRole('button',{name:'Apply suggested details'}).focus();
  assert.equal(await sql.query(`select revision from fmat.requests where id='${id}';`),'1');
  assert.equal(await sql.query(`select details->>'purpose' from fmat.requests where id='${id}';`),'연구 이야기');
  await page.locator('[aria-label="Review suggested details"]').evaluate(e=>e.scrollIntoView({block:'start'}));
  await page.screenshot({path:'.local/rebuild/browser-screenshots/request-review-desktop.png',fullPage:true});
  await page.evaluate(()=>{document.documentElement.style.zoom='2';});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/request-review-zoom.png',fullPage:true});await page.evaluate(()=>{document.documentElement.style.zoom='';});
  await page.setViewportSize({width:320,height:844});
  await page.locator('[aria-label="Review suggested details"]').evaluate(e=>e.scrollIntoView({block:'start'}));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.ok(await page.getByRole('button',{name:'Apply suggested details'}).evaluate(e=>e.getBoundingClientRect().height>=44));
  await page.screenshot({path:'.local/rebuild/browser-screenshots/request-review-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Apply suggested details'}).focus();await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button',{name:'Dismiss suggestions'}).evaluate(e=>e===document.activeElement),true);
  assert.equal((await context.request.post(origin+'/api/browser/request-review/apply',{headers:{origin:'https://wrong.test'},data:{requestId:id,input:{}}})).status(),403);
  let lostReview=false;await page.route('**/api/browser/request-review/apply',async route=>{if(lostReview)return route.continue();lostReview=true;const result=await route.fetch();assert.equal(result.status(),200);await route.abort('failed');});
  await page.getByRole('button',{name:'Apply suggested details'}).click();await page.getByRole('button',{name:'Retry same action'}).waitFor();
  await page.getByRole('button',{name:'Retry same action'}).click();await page.getByText('Suggested details applied.',{exact:true}).waitFor();await page.getByRole('heading',{name:'save: A reviewed discussion',exact:true}).waitFor();
  assert.equal(await sql.query(`select revision from fmat.requests where id='${id}';`),'2');
  assert.equal(await sql.query(`select count(*) from fmat.request_history where request_id='${id}' and operation='details_update';`),'1');
  assert.equal(await sql.query(`select details->>'requesterName' from fmat.requests where id='${id}';`),'요청자','partial suggestion preserves other fields');
  await page.reload();await page.getByText('Suggested details applied.',{exact:true}).waitFor();
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'.local/rebuild/browser-screenshots/request-review-applied.png',fullPage:true});
  // The authorized browser check returns only a receipt; time filtering alone
  // cannot create or offer candidates while travel/preferences are unfinished.
  const windows=[{start:new Date(Date.now()+86400000).toISOString(),end:new Date(Date.now()+90000000).toISOString()}];
  const replaced=await context.request.post(origin+'/api/browser/availability/manual',{headers:{origin},data:{requestId:id,input:{revision:2,confirmed:true,timezone:'Asia/Seoul',windows}}});assert.equal(replaced.status(),200);
  const revision=(await replaced.json()).revision,data={audience:'guest',requestId:id,revision};
  assert.equal((await context.request.post(origin+'/api/browser/scheduling/check',{headers:{origin:'https://wrong.test'},data})).status(),403);
  assert.equal((await context.request.post(origin+'/api/browser/scheduling/check',{headers:{origin},data:{...data,audience:'host'}})).status(),401);
  for(const category of ['allowances','preferences'])for(const action of ['confirm','revoke']){
    const endpoint=origin+'/api/browser/scheduling/'+category+'/'+action;
    assert.equal((await context.request.post(endpoint,{headers:{origin:'https://wrong.test'},data:{}})).status(),403);
    const denied=await context.request.post(endpoint,{headers:{origin},data:{}});assert.equal(denied.status(),401);assert.match(denied.headers()['cache-control'],/no-store/);
  }
  for(const action of ['evaluate','select','agree']){
    const endpoint=origin+'/api/browser/scheduling/'+action;
    assert.equal((await context.request.post(endpoint,{headers:{origin:'https://wrong.test'},data})).status(),403);
    const denied=await context.request.post(endpoint,{headers:{origin},data:{...data,audience:'host'}});assert.equal(denied.status(),401);assert.match(denied.headers()['cache-control'],/no-store/);
  }
  const schedulingState=await context.request.get(origin+'/api/browser/scheduling/state?audience=guest&requestId='+id);assert.equal(schedulingState.status(),200);assert.match(schedulingState.headers()['cache-control'],/no-store/);const scheduling=await schedulingState.json();assert.equal(scheduling.publication,null);assert.equal(scheduling.proposal,null);assert.equal(scheduling.canAgree,false);assert.ok(!JSON.stringify(scheduling).includes('privateSchedulingContext'));
  const checked=await context.request.post(origin+'/api/browser/scheduling/check',{headers:{origin},data});assert.equal(checked.status(),200);assert.match(checked.headers()['cache-control'],/private.*no-store/);
  const receipt=await checked.json();assert.deepEqual(Object.keys(receipt).sort(),['checked','checkedAt','complete','revision']);assert.equal(receipt.checked,true);assert.equal(receipt.complete,false);
  const candidate={start:windows[0].start,end:new Date(Date.parse(windows[0].start)+30*60000).toISOString()};
  const exactCheck=await context.request.post(origin+'/api/browser/scheduling/check',{headers:{origin},data:{...data,candidate}});assert.equal(exactCheck.status(),200);assert.deepEqual(Object.keys(await exactCheck.json()).sort(),['checked','checkedAt','complete','revision']);
  assert.equal(await sql.query(`select candidates='[]' and current_proposal_version is null from fmat.requests where id='${id}';`),'t');
  await verifyScheduling(page,sql,id,host,()=>verifyHostRequests(hostPage,page,sql,id,host));
  await verifyPrivateReview(hostPage,page,sql,id,host);
  await page.goto(origin+'/'+handle);await page.getByRole('link',{name:'Continue my request'}).waitFor();assert.equal(await page.getByRole('link',{name:'Continue my request'}).getAttribute('href'),'/booking/'+id);
  await page.reload();await page.getByRole('link',{name:'Continue my request'}).waitFor();
  await page.getByRole('link',{name:'Continue my request'}).click();const closure=page.getByRole('region',{name:'Request status and closure'});await closure.getByRole('button',{name:'Withdraw request',exact:true}).click();await closure.getByRole('button',{name:'Keep request open'}).click();assert.notEqual(await sql.query(`select status from fmat.requests where id='${id}';`),'withdrawn');
  await closure.getByRole('button',{name:'Withdraw request',exact:true}).click();await page.setViewportSize({width:320,height:844});await closure.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/withdraw-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>{document.documentElement.style.zoom='2';});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/withdraw-zoom.png',fullPage:true});await page.evaluate(()=>{document.documentElement.style.zoom='';});
  const closureInputs:unknown[]=[];let loseStatus=false;await page.route('**/api/browser/request-lifecycle/state?*',async route=>{if(loseStatus){loseStatus=false;return route.abort('failed');}return route.continue();});
  await page.route('**/api/browser/request-lifecycle/withdraw',async route=>{closureInputs.push(route.request().postDataJSON());if(closureInputs.length===1){loseStatus=true;return route.abort('failed');}await route.fetch();await route.abort('failed');});
  await closure.getByRole('button',{name:'Confirm withdraw'}).click();await closure.getByRole('alert').filter({hasText:'The result is unknown'}).waitFor();await closure.getByRole('button',{name:'Check request status',exact:true}).click();await closure.getByRole('button',{name:'Retry same decision'}).click();await page.getByText('This request is closed. Conversation history and changes are no longer available.',{exact:true}).waitFor();assert.equal(await page.getByLabel('Message your scheduling assistant').count(),0);await expect(page.getByRole('heading',{name:'Meeting status',exact:true})).toBeFocused();assert.equal(await sql.query(`select count(*) from fmat.request_history where request_id='${id}' and operation='request_withdraw';`),'1');assert.deepEqual(closureInputs[0],closureInputs[1],'An unsent decision and lost committed response retain one intent');await page.unroute('**/api/browser/request-lifecycle/withdraw');await page.unroute('**/api/browser/request-lifecycle/state?*');await page.goto(origin+'/'+handle);
  await page.reload();await page.getByRole('link',{name:'View request status'}).waitFor();await page.getByRole('link',{name:'View request status'}).click();await page.getByText('This request is closed. Conversation history and changes are no longer available.',{exact:true}).waitFor();assert.equal(await page.getByText('연구 이야기',{exact:true}).count(),0);
  await page.goto(origin+'/'+handle);await page.getByRole('button',{name:'Start another request'}).click();await page.getByLabel('Your name').waitFor();
  assert.equal((await context.request.post(origin+'/api/browser/intake/resume',{headers:{origin},data:{handle,attemptId:attempt}})).status(),409,'old tab cannot act on a new intake attempt');
  assert.equal((await context.request.get(origin+'/api/browser/guest/state?requestId='+id)).status(),200,'new intake keeps old receipt cookie');
  await page.getByLabel('Your name').fill('Another requester');await page.getByLabel('Email address').fill('another@example.test');await page.getByLabel('What would you like to discuss?').fill('A second discussion');lost=false;
  await page.getByRole('button',{name:'Continue to my conversation'}).click();await page.getByRole('button',{name:'Retry this request'}).waitFor();await page.reload();await page.getByRole('link',{name:'Continue my request'}).waitFor();assert.notEqual(await page.getByRole('link',{name:'Continue my request'}).getAttribute('href'),'/booking/'+id);
  assert.equal(await sql.query(`select count(*) from fmat.requests where host_id='${host}';`),'2','reload after a lost response recovers the committed second request');
  await verifyBookingApproval(hostPage,page,sql,host);
  await page.goto(origin+'/unknown-booking-host');await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('Your name').count(),0);await page.screenshot({path:'.local/rebuild/browser-screenshots/intake-unavailable.png',fullPage:true});
 }finally{await context.close();}
}

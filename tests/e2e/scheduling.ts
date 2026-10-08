import assert from 'node:assert/strict';
import {expect,type Page} from '@playwright/test';
import type {LocalSql} from '../integration/local-sql.ts';

/** Browser-only clock edge: the integration suite separately uses real evidence
 * and SQL lock waits. Delay refresh so a stale response cannot enable consent. */
async function verifyAgreementClock(page:Page,requestId:string){
 const pattern='**/api/browser/scheduling/state?*',url=new URL(page.url()).origin+'/api/browser/scheduling/state?audience=guest&requestId='+requestId;
 const original=await (await page.request.get(url)).json();assert.equal(original.canAgree,true);
 let served=false,release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);
 await page.route(pattern,async route=>{
  if(served){await wait;return route.fulfill({json:original});}
  served=true;const start=Date.now()+2000;
  await route.fulfill({json:{...original,publication:null,proposal:{...original.proposal,start:new Date(start).toISOString(),end:new Date(start+30*60000).toISOString()}}});
 });
 try{
  const panel=page.getByRole('region',{name:'Meeting options and proposal'}),button=panel.getByRole('button',{name:'Agree to this proposal',exact:true});
  await panel.getByRole('button',{name:'Refresh meeting',exact:true}).click();
  await expect(button).toBeEnabled();
  await expect(button).toBeDisabled({timeout:5000});
  await expect(panel.getByText('Proposal needs a fresh review',{exact:true})).toBeVisible();
  await button.scrollIntoViewIfNeeded();
  await page.screenshot({path:'.local/rebuild/browser-screenshots/scheduling-elapsed-proposal.png',fullPage:true});
 }finally{release();await page.unroute(pattern);await page.reload();}
 await expect(page.getByRole('button',{name:'Agree to this proposal',exact:true})).toBeEnabled();
}

/** Uses the real browser API/evaluator/SQL with provider fixtures in the test server. */
export async function verifyScheduling(page:Page,sql:LocalSql,requestId:string,hostId:string,reviewHost?:()=>Promise<void>){
 const panel=page.getByRole('region',{name:'Meeting options and proposal'});
 const original=await sql.query(`select rules::text from fmat.hosts where id='${hostId}';`);
 try{
  const start=new Date(Date.now()+2*86400000);start.setUTCHours(10,0,0,0);
  const windows=[{start:start.toISOString(),end:new Date(start.getTime()+2*3600000).toISOString()}];
  const rules={timezone:'Asia/Seoul',availability:[{days:[0,1,2,3,4,5,6],start:'00:00',end:'23:59'}],focusBlocks:[],bufferMinutes:0,durationMinutes:30,preferences:'',travelMode:'NONE',meetingMode:'online',locationPolicy:'per_meeting',locations:[],travelBufferMinutes:0};
  await sql.query(`update fmat.hosts set rules='${JSON.stringify(rules)}',rules_version=rules_version+1 where id='${hostId}';update fmat.requests set details=details||'${JSON.stringify({windows,mode:'online',location:'https://meet.example.test/review',durationMinutes:30})}'::jsonb,revision=revision+1 where id='${requestId}';`);
  await page.reload();await panel.getByRole('button',{name:'Find meeting times',exact:true}).waitFor();
  await panel.getByRole('button',{name:'Find meeting times',exact:true}).click();await panel.getByRole('button',{name:'Choose this time'}).first().waitFor();
  assert.ok(await panel.getByRole('button',{name:'Choose this time'}).count()>1);
  const beforeDisplay=await (await page.request.get(new URL(page.url()).origin+'/api/browser/scheduling/state?audience=guest&requestId='+requestId)).json();
  await panel.getByLabel('Display timezone',{exact:true}).fill('');await expect(panel.getByRole('button',{name:'Choose this time'}).first()).toBeDisabled();
  await page.reload();await expect(panel.getByLabel('Display timezone',{exact:true})).toHaveValue('');
  await panel.getByLabel('Display timezone',{exact:true}).fill('America/New_York');await expect(panel.getByText(/GMT-(4|5)/).first()).toBeVisible();
  await page.reload();await expect(panel.getByLabel('Display timezone',{exact:true})).toHaveValue('America/New_York');
  const afterDisplay=await (await page.request.get(new URL(page.url()).origin+'/api/browser/scheduling/state?audience=guest&requestId='+requestId)).json();assert.deepEqual(afterDisplay,beforeDisplay,'Display changes preserve candidate instants, revisions and decisions');
  await panel.getByLabel('Display timezone',{exact:true}).fill('Asia/Seoul');
  await page.setViewportSize({width:320,height:844});await panel.getByLabel('Display timezone',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'.local/rebuild/browser-screenshots/timezone-selector-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewportSize({width:1280,height:900});
  assert.match(await panel.innerText(),/Asia\/Seoul/);assert.match(await panel.innerText(),/GMT\+9/);
  await panel.getByRole('button',{name:'Choose this time'}).first().focus();await page.keyboard.press('Tab');assert.equal(await panel.getByRole('button',{name:'Choose this time'}).nth(1).evaluate(e=>e===document.activeElement),true);
  await panel.scrollIntoViewIfNeeded();await page.screenshot({path:'.local/rebuild/browser-screenshots/scheduling-candidates-desktop.png',fullPage:true});
  await page.setViewportSize({width:320,height:844});await panel.getByRole('button',{name:'Choose this time'}).first().scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.ok(await panel.getByRole('button',{name:'Choose this time'}).first().evaluate(e=>e.getBoundingClientRect().height>=44));await page.screenshot({path:'.local/rebuild/browser-screenshots/scheduling-candidates-mobile.png',fullPage:true});
  let lostSelect=false;await page.route('**/api/browser/scheduling/select',async route=>{if(lostSelect)return route.continue();lostSelect=true;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});
  await panel.getByRole('button',{name:'Choose this time'}).first().click();await panel.getByRole('button',{name:'Check current meeting status'}).waitFor();await panel.getByRole('button',{name:'Check current meeting status'}).click();
  const proposal=page.getByLabel('Current meeting proposal',{exact:true});await proposal.getByRole('button',{name:'Agree to this proposal'}).waitFor();
  assert.equal(await sql.query(`select count(*) from fmat.proposals where request_id='${requestId}';`),'1');assert.equal(await sql.query(`select requester_agreed_version is null and host_approved_version is null from fmat.requests where id='${requestId}';`),'t');
  await proposal.getByRole('button',{name:'Agree to this proposal'}).scrollIntoViewIfNeeded();await page.screenshot({path:'.local/rebuild/browser-screenshots/scheduling-proposal-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});await proposal.getByRole('button',{name:'Agree to this proposal'}).scrollIntoViewIfNeeded();await page.screenshot({path:'.local/rebuild/browser-screenshots/scheduling-proposal-desktop.png',fullPage:true});
  await page.evaluate(()=>{document.documentElement.style.zoom='2';});await proposal.getByRole('button',{name:'Agree to this proposal'}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/scheduling-proposal-zoom.png',fullPage:true});await page.evaluate(()=>{document.documentElement.style.zoom='';});
  // An unsent decision retries its frozen identity after a current-state lookup.
  let failedAgree=false;await page.route('**/api/browser/scheduling/agree',async route=>{if(failedAgree)return route.continue();failedAgree=true;await route.abort('failed');});
  await proposal.getByRole('button',{name:'Agree to this proposal'}).click();await panel.getByRole('button',{name:'Retry same decision'}).waitFor();await panel.getByRole('button',{name:'Retry same decision'}).click();await proposal.getByRole('button',{name:'Agreement saved'}).waitFor();assert.equal(await proposal.getByRole('button',{name:'Agreement saved'}).isDisabled(),true);
  assert.equal(await sql.query(`select status='awaiting_approval' and requester_agreed_version=1 and host_approved_version is null from fmat.requests where id='${requestId}';`),'t');assert.equal(await sql.query(`select count(*) from fmat.jobs where payload->>'requestId'='${requestId}' and kind like 'booking%';`),'0');
  await page.reload();await proposal.getByRole('button',{name:'Agreement saved'}).waitFor();
  await panel.getByRole('button',{name:'Choose this time'}).nth(1).click();await proposal.getByText('Proposal 2 · Review all details before agreeing',{exact:true}).waitFor();assert.equal(await sql.query(`select requester_agreed_version is null from fmat.requests where id='${requestId}';`),'t');
  await verifyAgreementClock(page,requestId);
  await reviewHost?.();
  // Refresh removes current consent when another actor changes the context.
  await sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${hostId}';`);await panel.getByRole('button',{name:'Refresh meeting',exact:true}).click();await proposal.getByText('Proposal needs a fresh review',{exact:true}).waitFor();assert.equal(await proposal.getByRole('button',{name:'Agree to this proposal'}).isDisabled(),true);assert.equal(await panel.getByRole('button',{name:'Choose this time'}).count(),0);
  await sql.query(`update fmat.hosts set rules=jsonb_set(rules,'{preferences}','"Private host preference - never shared"'),rules_version=rules_version+1 where id='${hostId}';`);
  await panel.getByRole('button',{name:'Find new options',exact:true}).click();await panel.getByText('More information or host review is needed before times can be offered. Ask the assistant about the next step.',{exact:true}).waitFor();assert.equal(await proposal.count(),0);assert.equal(await page.getByText('Private host preference - never shared',{exact:false}).count(),0);
  await panel.getByRole('button',{name:'Ask for alternatives'}).click();assert.match(await page.getByLabel('Message your scheduling assistant').inputValue(),/different meeting times/);assert.equal(await page.getByLabel('Message your scheduling assistant').evaluate(e=>e===document.activeElement),true);
  await page.getByLabel('Message your scheduling assistant').fill('');
  await sql.query(`update fmat.hosts set rules=jsonb_set(jsonb_set(rules,'{preferences}','""'),'{focusBlocks}','${JSON.stringify(windows)}'),rules_version=rules_version+1 where id='${hostId}';`);
  await panel.getByRole('button',{name:'Find new options',exact:true}).click();await panel.getByText('No matching times were found in the checked options. Share different availability or meeting details to explore alternatives.',{exact:true}).waitFor();
 }finally{
  await page.unroute('**/api/browser/scheduling/select');await page.unroute('**/api/browser/scheduling/agree');
  await sql.query(`update fmat.hosts set rules='${original.replaceAll("'","''")}',rules_version=rules_version+1 where id='${hostId}';`);
 }
}

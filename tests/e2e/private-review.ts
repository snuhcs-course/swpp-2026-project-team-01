import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {expect,type Page} from '@playwright/test';
import {instantToLocalTime} from '../../lib/contracts/time.ts';
import type {LocalSql} from '../integration/local-sql.ts';

/** Real host/guest sessions and SQL, with isolated Calendar/model transports. */
export async function verifyPrivateReview(page:Page,guest:Page,sql:LocalSql,requestId:string,host:string){
 const origin=new URL(page.url()).origin,review=page.getByRole('region',{name:'Private scheduling review',exact:true});
 const original=await sql.query(`select rules::text from fmat.hosts where id='${host}';`);
 const rules={timezone:'Asia/Seoul',availability:[{days:[0,1,2,3,4,5,6],start:'00:00',end:'23:59'}],focusBlocks:[],bufferMinutes:5,durationMinutes:30,preferences:'Private location preference for this fixture',travelMode:'NONE',meetingMode:'online',locationPolicy:'per_meeting',locations:[],travelBufferMinutes:5};
 const privateState=async()=>{const response=await page.request.get(origin+'/api/browser/scheduling/private?requestId='+requestId);assert.equal(response.status(),200);assert.match(response.headers()['cache-control'],/private.*no-store/);return response.json();};
 async function check(){const response=page.waitForResponse(r=>r.url().endsWith('/api/browser/scheduling/private/evaluate'));await review.getByRole('button',{name:'Check private constraints',exact:true}).click();const result=await response;assert.equal(result.status(),200,await result.text());await review.getByText('Private checks refreshed. A passing check is not a proposal or booking.',{exact:true}).waitFor();}
 async function visual(name:string){
  await page.setViewportSize({width:1280,height:1000});await page.getByRole('region',{name:'Private candidate details',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'.local/rebuild/browser-screenshots/private-'+name+'-desktop.png',fullPage:true});
  const action=review.getByRole('button',{name:name==='preference'?'Confirm preference and recheck':'Confirm allowance and recheck'}).first();
  await page.setViewportSize({width:320,height:844});await action.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.ok(await action.evaluate(e=>e.getBoundingClientRect().height>=44&&e.scrollWidth<=e.clientWidth));await page.screenshot({path:'.local/rebuild/browser-screenshots/private-'+name+'-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:1000});await page.evaluate(()=>{document.documentElement.style.zoom='2';});await action.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/private-'+name+'-zoom.png',fullPage:true});await page.evaluate(()=>{document.documentElement.style.zoom='';});
 }
 try{
  await sql.query(`update fmat.hosts set rules='${JSON.stringify(rules)}',rules_version=rules_version+1 where id='${host}';`);
  await page.goto(origin+'/app?request='+requestId);await review.getByRole('button',{name:'Check private constraints',exact:true}).waitFor();
  assert.equal((await guest.request.get(origin+'/api/browser/scheduling/private?requestId='+requestId)).status(),401);
  assert.equal((await guest.request.post(origin+'/api/browser/scheduling/private/evaluate',{headers:{origin},data:{requestId,revision:1}})).status(),401);
  assert.equal((await page.request.post(origin+'/api/browser/scheduling/private/evaluate',{headers:{origin:'https://wrong.test'},data:{requestId,revision:1}})).status(),403);
  await check();
  const form=review.getByRole('form',{name:'Additional preferences decision'}),confirm=form.getByRole('button',{name:'Confirm preference and recheck'});
  await form.getByRole('radio',{name:'This time satisfies it'}).check();await form.getByLabel('Private reason',{exact:true}).fill('Private reason that must not reach the requester');assert.equal(await confirm.isDisabled(),true);
  // Preserve evidence before this fixture's finally block invalidates its
  // rules. No request IDs, cookies, URLs or entered text enter this trace.
  // Keep this injected function as plain JavaScript so tsx's function-name
  // helper does not become an undefined closure in the browser context.
  await page.evaluate(`(()=>{
   const element=document.querySelector('[aria-label="Additional preferences decision"] [role="checkbox"]');
   if(!element)throw new Error('Missing diagnostic checkbox');
   const trace=[];
   const state=()=>{const rect=element.getBoundingClientRect();return {checked:element.getAttribute('aria-checked'),disabled:element.matches(':disabled'),connected:element.isConnected,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},at:performance.now()};};
   const listen=(event)=>{if(trace.length>=100)return;const target=event.target;trace.push({event:event.type,target:target.tagName,role:target.getAttribute?.('role')??null,same:target===element,...(event instanceof MouseEvent?{x:event.clientX,y:event.clientY}:{}),...state()});};
   const names=['pointerdown','pointerup','click','focus','blur'];for(const name of names)document.addEventListener(name,listen,true);
   const observer=new MutationObserver(()=>{if(trace.length<100)trace.push({event:'mutation',...state()});});observer.observe(element,{attributes:true});
   window.privateCheckboxDiagnostic={trace,state,stop:()=>{observer.disconnect();for(const name of names)document.removeEventListener(name,listen,true);}};
  })()`);
  try{await form.getByRole('checkbox').check();await expect(confirm).toBeEnabled();}
  catch(error){
   const diagnostic=await page.evaluate(()=>{
    const probe=(window as unknown as {privateCheckboxDiagnostic:{trace:unknown[];state:()=>unknown}}).privateCheckboxDiagnostic;
    const region=document.querySelector('[aria-label="Private scheduling review"]');
    return {events:probe?.trace??[],original:probe?.state()??null,busy:region?.getAttribute('aria-busy'),forms:Array.from(region?.querySelectorAll('form')??[]).map(form=>({name:form.getAttribute('aria-label'),choices:Array.from(form.querySelectorAll('[role="radio"],[role="checkbox"]')).map(e=>({role:e.getAttribute('role'),checked:e.getAttribute('aria-checked'),disabled:e.matches(':disabled')})),reasonLengths:Array.from(form.querySelectorAll('textarea')).map(e=>e.value.length)}))};
   });
   await writeFile('.local/rebuild/private-checkbox-trace.json',JSON.stringify(diagnostic,null,2));throw error;
  }finally{await page.evaluate(()=>(window as unknown as {privateCheckboxDiagnostic:{stop:()=>void}}).privateCheckboxDiagnostic?.stop()).catch(()=>{});}
  assert.ok(await confirm.evaluate(e=>e.getBoundingClientRect().height>=44));
  await form.getByRole('checkbox').focus();await expect(form.getByRole('checkbox')).toBeFocused();await page.keyboard.press('Tab');await expect(confirm).toBeFocused();
  await visual('preference');
  let lost=false;await page.route('**/api/browser/scheduling/preferences/confirm',async route=>{if(lost)return route.continue();lost=true;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});
  await confirm.click();await review.getByRole('button',{name:'Retry same private decision'}).waitFor();await review.getByRole('button',{name:'Refresh private review',exact:true}).click();await review.getByText('Private reason that must not reach the requester',{exact:true}).waitFor();
  assert.equal((await privateState()).preferences.length,1);await page.reload();await review.getByText('Private reason that must not reach the requester',{exact:true}).waitFor();await check();await review.getByText('These private checks passed. Find meeting times in the shared proposal card before selecting a proposal.',{exact:true}).waitFor();
  const state=await privateState();assert.ok(!JSON.stringify(state).includes('contextFingerprint'));assert.ok(!JSON.stringify(state).includes('instance-'));
  const shared=await guest.request.get(origin+'/api/browser/scheduling/state?audience=guest&requestId='+requestId);assert.ok(!JSON.stringify(await shared.json()).includes('Private reason'));
  await page.getByRole('radio',{name:'Shared with requester',exact:true}).check();assert.equal(await review.count(),0);assert.equal(await page.getByText(rules.preferences,{exact:true}).count(),0);
  await page.getByRole('radio',{name:'Private host review',exact:true}).check();await review.getByRole('button',{name:'Revoke preference decision'}).waitFor();
  let failed=false;const keys:string[]=[];await page.route('**/api/browser/scheduling/preferences/revoke',async route=>{keys.push(route.request().postDataJSON().idempotencyKey);if(failed)return route.continue();failed=true;await route.abort('failed');});
  await review.getByRole('button',{name:'Revoke preference decision'}).click();await review.getByRole('button',{name:'Retry same private decision'}).click();await review.getByText('Decision revoked and time rechecked.',{exact:true}).waitFor();assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal((await privateState()).preferences.length,0);
  // Rule changes remove actionable evidence even without changing request revision.
  await sql.query(`update fmat.hosts set rules_version=rules_version+1 where id='${host}';`);await review.getByRole('button',{name:'Refresh private review',exact:true}).click();await review.getByText('These private checks are out of date. Check current constraints before making another decision.',{exact:true}).waitFor();assert.equal(await form.count(),0);
  rules.preferences='';rules.meetingMode='in_person';await sql.query(`update fmat.hosts set rules='${JSON.stringify(rules)}',rules_version=rules_version+1 where id='${host}';update fmat.requests set details=details||'{"mode":"in_person","location":"Public meeting venue"}',revision=revision+1 where id='${requestId}';`);
  await page.reload();await check();await visual('travel');
  const current=await privateState(),candidate=current.candidates[0];assert.equal(candidate.travel.length,2);assert.ok(candidate.travel.every((leg:{canConfirm:boolean})=>leg.canConfirm));
  async function allowance(direction:'inbound'|'outbound',minutes:string){
   const travel=review.getByRole('form',{name:direction+' manual allowance'});
   await travel.getByRole('radio',{name:'Walk',exact:true}).check();await travel.getByLabel('Travel duration (minutes)').fill(minutes);
   const boundary=new Date(Date.parse(direction==='inbound'?candidate.interval.start:candidate.interval.end)+(direction==='inbound'?-1:1)*3600000).toISOString();
   await travel.getByLabel(direction==='inbound'?'Available at starting point':'Required at next destination',{exact:false}).fill(instantToLocalTime(boundary,'Asia/Seoul'));
   await travel.getByLabel(direction==='inbound'?'Starting point address':'Next destination address').fill('Private endpoint '+direction);
   await travel.getByLabel('Private travel reason').fill('Private '+direction+' travel estimate');
   const button=travel.getByRole('button',{name:'Confirm allowance and recheck'});assert.equal(await button.isDisabled(),true);await travel.getByRole('checkbox').check();await button.click();await review.getByText('Decision saved and time rechecked. Review both trips and all preferences.',{exact:true}).waitFor();
  }
  await allowance('inbound','10');assert.equal((await privateState()).candidates[0].status,'clarification');
  await allowance('outbound','120');assert.equal((await privateState()).candidates[0].status,'conflict','A confirmed allowance cannot waive an insufficient travel gap');
  await review.getByRole('button',{name:'Revoke travel allowance'}).first().click();await review.getByText('Decision revoked and time rechecked.',{exact:true}).waitFor();await allowance('outbound','10');assert.equal((await privateState()).candidates[0].status,'checks_passed');
  assert.equal(await sql.query(`select current_proposal_version is null and requester_agreed_version is null and host_approved_version is null from fmat.requests where id='${requestId}';`),'t');
  await guest.reload();assert.equal(await guest.getByText('Private endpoint',{exact:false}).count(),0);assert.equal(await guest.getByRole('region',{name:'Private scheduling review'}).count(),0);
  await review.getByRole('button',{name:'Revoke travel allowance'}).first().click();await review.getByText('Decision revoked and time rechecked.',{exact:true}).waitFor();assert.equal((await privateState()).candidates[0].status,'clarification');
  await page.getByRole('button',{name:'Back to host chat',exact:true}).click();await page.getByRole('button',{name:'Manage Google connection',exact:true}).waitFor();
 }finally{
  await page.unroute('**/api/browser/scheduling/preferences/confirm');await page.unroute('**/api/browser/scheduling/preferences/revoke');
  await sql.query(`update fmat.hosts set rules='${original.replaceAll("'","''")}',rules_version=rules_version+1 where id='${host}';`);
 }
}

import {verifyReadyLinks} from './setup-ready-links.ts';
import {verifyCompactSetup} from './compact-setup.ts';
import {captureSetupFailure} from './setup-failure.ts';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createServerClient} from '@supabase/ssr';
import {expect,type Browser} from '@playwright/test';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {verifyIMessage} from './setup-imessage.ts';
import {LocalSql} from '../integration/local-sql.ts';
import {describedPreferences,describedReply} from '../runtime/setup-preferences.ts';

// Called within the existing isolated Google-fixture server, never against production.
export async function verifyNoHistory(browser:Browser,origin:string,local:Record<string,string>,sql:LocalSql){
 assert.equal(origin,'http://localhost:3000');
 for(const flow of ['no-history','described','online'] as const){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(15000);
 const email='guided-'+randomUUID()+'@example.test',password=randomUUID()+randomUUID(),invitation=randomUUID(),headers={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};let host='';
 try{
  const created=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);host=(await created.json()).id;
  const jar=new Map<string,string>();const auth=createServerClient(local.API_URL,local.ANON_KEY,{cookieOptions:{name:'fmat-auth',httpOnly:true,secure:false,sameSite:'lax',path:'/'},cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>{for(const c of values)jar.set(c.name,c.value);}}});assert.equal((await auth.auth.signInWithPassword({email,password})).error,null);
  await context.addCookies([...jar].map(([name,value])=>({name,value,url:origin,httpOnly:true,secure:false,sameSite:'Lax' as const})));
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${email}','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','browser-fixture');insert into fmat.hosts(id,email,invitation_id,conflict_calendar_ids,booking_calendar_id) values('${host}','${email}','${invitation}',array['personal@example.test'],'personal@example.test');`);
  const encrypted=new TokenCipher({TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')}).seal({accessToken:'browser-calendar-fixture',refreshToken:'fixture-refresh',subject:'fixture',scopes:['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],expiresAt:Date.now()+3600000},'google:host:'+host);
  await sql.query(`insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential) values('host','${host}','fixture',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],'${encrypted}');`);
  await page.goto(origin+'/app');const setup=page.getByRole('region',{name:'Your meeting setup'}),guide=setup.getByRole('region',{name:'Setup guide'});
  await guide.getByRole('button',{name:'Skip analysis and choose preferences'}).click();await guide.getByRole('button',{name:'Choose my booking profile'}).click();await setup.getByLabel('Display name',{exact:true}).fill('No history host');await setup.getByLabel('Booking name',{exact:true}).fill('guided-'+host.slice(0,8));await setup.getByRole('button',{name:'Use these preferences in my draft'}).click();
  if(flow==='no-history'){
  await guide.getByRole('button',{name:'Use this meeting week'}).click();await guide.getByRole('button',{name:'Choose Either',exact:true}).click();await guide.getByRole('button',{name:'Decide location per meeting'}).click();
  await guide.getByRole('button',{name:'Choose transportation'}).click();assert.equal(await setup.getByRole('radio',{checked:true}).count(),0);await setup.getByRole('radio',{name:'Depends on the trip',exact:true}).check();await setup.getByRole('button',{name:'Use these preferences in my draft'}).click();await guide.getByRole('button',{name:'Use 15 extra travel minutes'}).click();
  }else if(flow==='online'){
   await guide.getByRole('button',{name:'Use this meeting week'}).click();
   await guide.getByRole('button',{name:'Choose another meeting mode'}).click();
   assert.equal(await setup.getByRole('radio',{checked:true}).count(),0,'A starter mode is not an explicit answer');
   await setup.getByRole('radio',{name:'Online only',exact:true}).check();
   await setup.getByRole('button',{name:'Use these preferences in my draft'}).click();
   await setup.getByRole('button',{name:'Confirm these meeting settings'}).waitFor();
   for(const name of ['Choose transportation','Choose preferred places','Use 15 extra travel minutes'])assert.equal(await guide.getByRole('button',{name,exact:true}).count(),0,'Online-only skips physical questions');
   const online=await (await context.request.get(origin+'/api/browser/setup/read')).json();
   assert.equal(online.draft.provenance['rules.meetingMode'],'host');
   for(const key of ['travelMode','travelBufferMinutes','locationPolicy','locations'])assert.equal(online.draft.provenance['rules.'+key],undefined,'Normalization cannot fabricate an explicit physical answer');
   assert.equal(online.confirmed.rules,null);
   await page.reload();await setup.getByRole('button',{name:'Confirm these meeting settings'}).waitFor();
  }else{
   await page.getByLabel('Message your scheduling assistant').fill(describedPreferences);await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText(describedReply,{exact:true}).waitFor();
   const answers=guide.getByRole('group',{name:'Review draft answers'});await answers.waitFor();assert.equal(await answers.getByRole('checkbox',{checked:true}).count(),0);assert.equal(await setup.getByRole('button',{name:'Confirm these meeting settings'}).count(),0);
   const extracted=await (await context.request.get(origin+'/api/browser/setup/read')).json();assert.equal(extracted.draft.provenance['rules.travelMode'],'assistant');assert.equal(extracted.review,null);assert.equal(extracted.confirmed.rules,null);
   await answers.getByRole('checkbox',{name:'I choose: Public transit',exact:true}).check();assert.equal(await answers.getByRole('button',{name:'Use my selected answers'}).isDisabled(),true,'Physical choices cannot assume an unchosen mode');
   await page.reload();await page.getByText(describedReply,{exact:true}).waitFor();await page.getByRole('status').filter({hasText:'Your conversation is saved.'}).waitFor();await answers.waitFor();assert.equal(await answers.getByRole('checkbox',{checked:true}).count(),0,'Reload does not invent an explicit choice');
   await answers.getByRole('checkbox',{name:'I choose: Either online or in person',exact:true}).focus();await page.keyboard.press('Space');for(const box of await answers.getByRole('checkbox').all())await box.check();
   await page.emulateMedia({reducedMotion:'reduce'});
   const transit=answers.getByRole('checkbox',{name:'I choose: Public transit',exact:true}),useAnswers=answers.getByRole('button',{name:'Use my selected answers'});
   await page.setViewportSize({width:320,height:844});await transit.focus();await transit.scrollIntoViewIfNeeded();await expect(transit).toBeInViewport();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await useAnswers.evaluate(e=>e.scrollWidth>e.clientWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/setup-answers-mobile.png',fullPage:true});
   await useAnswers.focus();await useAnswers.scrollIntoViewIfNeeded();await expect(useAnswers).toBeInViewport();await page.screenshot({path:'.local/rebuild/browser-screenshots/setup-answers-action.png',fullPage:true});
   await page.setViewportSize({width:1280,height:900});await transit.focus();await transit.scrollIntoViewIfNeeded();await expect(transit).toBeInViewport();await page.screenshot({path:'.local/rebuild/browser-screenshots/setup-answers-desktop.png',fullPage:true});
   let lost=false;await page.route('**/api/browser/setup/draft',async route=>{if(lost)return route.continue();lost=true;await route.fetch();await route.abort('failed');});
   await answers.getByRole('button',{name:'Use my selected answers'}).click();await setup.getByRole('alert').filter({hasText:'Setup needs attention'}).waitFor();await answers.getByRole('button',{name:'Use my selected answers'}).click();await setup.getByRole('button',{name:'Confirm these meeting settings'}).waitFor();await page.unroute('**/api/browser/setup/draft');
   const accepted=await (await context.request.get(origin+'/api/browser/setup/read')).json();assert.equal(accepted.revision,extracted.revision+1,'Lost acknowledgement reuses the same selection intent');assert.equal(accepted.draft.provenance['rules.travelMode'],'host');assert.equal(accepted.draft.origins['rules.travelMode'].source,'assistant');assert.equal(accepted.confirmed.rules,null);
   await page.reload();await setup.getByRole('button',{name:'Confirm these meeting settings'}).waitFor();assert.equal(await answers.count(),0,'Chosen answers are reused without asking again');
  }
  await expect(setup.getByRole('figure',{name:'Your draft meeting week'})).toBeVisible();await expect(setup.getByRole('button',{name:'Show preference details'})).toHaveCount(0);
  if(flow==='no-history'){await page.setViewportSize({width:320,height:900});const caption=setup.getByRole('figure',{name:'Your draft meeting week'}).locator('figcaption');await caption.scrollIntoViewIfNeeded();await expect(caption).toBeInViewport();await page.screenshot({path:'.local/rebuild/browser-screenshots/compact-final-review-top.png'});const confirm=setup.getByRole('button',{name:'Confirm these meeting settings'});await confirm.focus();await expect(confirm).toBeInViewport();await page.screenshot({path:'.local/rebuild/browser-screenshots/compact-final-review-bottom.png'});await page.setViewportSize({width:1280,height:900});}
  await setup.getByRole('button',{name:'Confirm these meeting settings'}).waitFor();assert.equal(await sql.query(`select rules is null from fmat.hosts where id='${host}';`),'t');await setup.getByRole('button',{name:'Confirm these meeting settings'}).click();await setup.getByRole('status').filter({hasText:'Settings confirmed.'}).waitFor();
  await page.reload();await setup.getByText('Your settings are confirmed.',{exact:true}).waitFor();
  const state=await (await context.request.get(origin+'/api/browser/setup/read')).json();
  assert.equal(state.confirmed.rules.meetingMode,flow==='online'?'online':'either');
  assert.equal(state.confirmed.rules.locationPolicy,flow==='described'?'preferred':'per_meeting');
  assert.equal(state.confirmed.rules.travelMode,flow==='online'?'NONE':flow==='no-history'?'PER_TRIP':'TRANSIT');
  assert.equal(state.confirmed.rules.travelBufferMinutes,flow==='online'?0:flow==='no-history'?15:20);
  assert.equal(state.confirmed.rules.bufferMinutes,10,'General meeting buffer is independent of extra travel buffer');
  assert.equal(state.confirmed.rules.durationMinutes,30);assert.equal(state.progress.analysisDecided,true);
  if(flow==='online')assert.deepEqual(state.confirmed.rules.locations,[]);
  else for(const key of ['durationMinutes','meetingMode','travelBufferMinutes'])assert.equal(state.draft.origins['rules.'+key].source,flow==='no-history'?'starter':'assistant');
  assert.equal(await sql.query(`select count(*) from fmat.calendar_scans where host_id='${host}';`),'0','Skipping analysis never scans events');assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where host_id='${host}';`),'0');
  if(flow==='described')await verifyIMessage(page,context,host,local,sql);
  else{const card=page.getByRole('region',{name:'Connect iMessage'});await card.getByRole('button',{name:'Maybe later',exact:true}).click();await card.getByText('You chose to continue on the web.',{exact:false}).waitFor();await page.reload();await card.getByText('You chose to continue on the web.',{exact:false}).waitFor();}
  if(flow==='no-history'){await verifyReadyLinks(page,context,origin);await verifyCompactSetup(page,context,origin);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await setup.scrollIntoViewIfNeeded();await page.screenshot({path:'.local/rebuild/browser-screenshots/setup-'+flow+'.png',fullPage:true});
 }catch(error){
  // This page belongs to its own context. Capture before closing it; the outer
  // suite's page is already on the waitlist and cannot diagnose this failure.
  await captureSetupFailure(page,flow).catch(()=>{});throw error;
 }finally{
  await context.close();if(host){await sql.query(`delete from fmat.idempotency where actor_scope='host:${host}';delete from fmat.audit_events where subject_id='${host}';delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_scopes where host_id='${host}';delete from fmat.calendar_connections where principal_id='${host}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invitation}';`);assert.equal((await fetch(local.API_URL+'/auth/v1/admin/users/'+host,{method:'DELETE',headers})).status,200);}
 }
 }
}

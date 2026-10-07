import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createServerClient} from '@supabase/ssr';
import type {Browser} from '@playwright/test';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {LocalSql} from '../integration/local-sql.ts';

// Called within the existing isolated Google-fixture server, never against production.
export async function verifyNoHistory(browser:Browser,origin:string,local:Record<string,string>,sql:LocalSql){
 assert.equal(origin,'http://localhost:3000');
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
  await guide.getByRole('button',{name:'Use this meeting week'}).click();await guide.getByRole('button',{name:'Choose Either',exact:true}).click();await guide.getByRole('button',{name:'Decide location per meeting'}).click();
  await guide.getByRole('button',{name:'Choose transportation'}).click();assert.equal(await setup.getByRole('radio',{checked:true}).count(),0);await setup.getByRole('radio',{name:'Depends on the trip',exact:true}).check();await setup.getByRole('button',{name:'Use these preferences in my draft'}).click();await guide.getByRole('button',{name:'Use 15 extra travel minutes'}).click();
  await setup.getByRole('button',{name:'Confirm these meeting settings'}).waitFor();assert.equal(await sql.query(`select rules is null from fmat.hosts where id='${host}';`),'t');await setup.getByRole('button',{name:'Confirm these meeting settings'}).click();await setup.getByRole('status').filter({hasText:'Settings confirmed.'}).waitFor();
  await page.reload();await setup.getByText('Your settings are confirmed.',{exact:true}).waitFor();
  const state=await (await context.request.get(origin+'/api/browser/setup/read')).json();assert.equal(state.confirmed.rules.meetingMode,'either');assert.equal(state.confirmed.rules.locationPolicy,'per_meeting');assert.equal(state.confirmed.rules.travelMode,'PER_TRIP');assert.equal(state.confirmed.rules.travelBufferMinutes,15);assert.equal(state.confirmed.rules.durationMinutes,30);assert.equal(state.progress.analysisDecided,true);assert.equal(state.draft.origins['rules.durationMinutes'].source,'starter');assert.equal(state.draft.origins['rules.meetingMode'].source,'starter');assert.equal(state.draft.origins['rules.travelBufferMinutes'].source,'starter');
  assert.equal(await sql.query(`select count(*) from fmat.calendar_scans where host_id='${host}';`),'0','Skipping analysis never scans events');assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where host_id='${host}';`),'0');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await setup.scrollIntoViewIfNeeded();await page.screenshot({path:'.local/rebuild/browser-screenshots/setup-no-history.png',fullPage:true});
 }finally{
  await context.close();if(host){await sql.query(`delete from fmat.idempotency where actor_scope='host:${host}';delete from fmat.audit_events where subject_id='${host}';delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_scopes where host_id='${host}';delete from fmat.calendar_connections where principal_id='${host}';delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invitation}';`);assert.equal((await fetch(local.API_URL+'/auth/v1/admin/users/'+host,{method:'DELETE',headers})).status,200);}
 }
}

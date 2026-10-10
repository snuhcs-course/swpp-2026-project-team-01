import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID,createHash,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServerClient} from '@supabase/ssr';
import {chromium,expect} from '@playwright/test';
import {startBrowserRuntime} from '../runtime/fixture-server.ts';
import {LocalSql} from '../integration/local-sql.ts';
import {Database} from '../../lib/server/database/client.ts';
import {HostSetup} from '../../lib/server/setup/commands.ts';
import {verifyHostToken} from '../../lib/server/identity/credentials.ts';
const q=(value:string)=>`'${value.replaceAll("'","''")}'`;

test('browser explicitly recovers an authentication-terminated runtime with original pending input and one saved effect',{timeout:180000},async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['127.0.0.1','localhost'].includes(new URL(local.API_URL).hostname));
 const origin='http://localhost:3006',sql=new LocalSql(),invitation=randomUUID(),email=randomUUID()+'@browser-recovery.test',password=randomUUID()+randomUUID(),dispatchSecret=randomBytes(32).toString('hex');
 const admin={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY};
 let host='',scope='',runtime:Awaited<ReturnType<typeof startBrowserRuntime>>|undefined,child:ReturnType<typeof spawn>|undefined,log='';
 const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();page.setDefaultTimeout(15000);
 await mkdir('.local/rebuild/browser-screenshots',{recursive:true});
 try{
  const created=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers:admin,body:JSON.stringify({email,password,email_confirm:true})});assert.equal(created.status,200);host=(await created.json()).id;
  const jar=new Map<string,string>(),auth=createServerClient(local.API_URL,local.ANON_KEY,{cookieOptions:{name:'fmat-auth',httpOnly:true,secure:false,sameSite:'lax',path:'/'},cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>{for(const cookie of values)jar.set(cookie.name,cookie.value);}}});
  const login=await auth.auth.signInWithPassword({email,password});assert.equal(login.error,null);const token=login.data.session!.access_token;
  await context.addCookies([...jar].map(([name,value])=>({name,value,url:origin,httpOnly:true,secure:false,sameSite:'Lax' as const})));
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${email}','${createHash('sha256').update(invitation).digest('hex')}',now()+interval '1 day','browser-recovery');insert into fmat.hosts(id,email,invitation_id) values('${host}','${email}','${invitation}');`);
  const setup=new HostSetup(new Database(env)),credential=await verifyHostToken(token,{env});
  const saved=await setup.draft(credential,{expectedRevision:0,idempotencyKey:randomUUID(),patch:{displayName:'Existing draft',rules:{timezone:'Asia/Seoul',bufferMinutes:10}},unresolved:['Meeting hours still needed']});
  runtime=await startBrowserRuntime(local,origin,dispatchSecret,{terminalInspection:true,legacyAuthenticationFailure:true});
  const headers={authorization:'Bearer '+token,'content-type':'application/json'};
  const post=(path:string,body:unknown)=>fetch(runtime!.origin+path,{method:'POST',headers,body:JSON.stringify(body)});
  const opened=await post('/api/conversations',{audience:'host_setup'});assert.equal(opened.status,200);scope=(await opened.json()).conversationId;
  async function settle(id:string,status:string){await expect.poll(()=>sql.query(`select status from fmat.runtime_messages where id=${q(id)};`),{timeout:40000}).toBe(status);}
  async function send(text:string){const response=await post(`/api/conversations/${scope}/messages`,{text,clientId:randomUUID()}),body=await response.json();assert.ok([200,202].includes(response.status));return body.messageId as string;}
  await settle(await send('retained-archive-sentinel'),'completed');
  const failed=await send('setup-provider-authentication');await settle(failed,'failed');
  const terminalResponse=await fetch(runtime.origin+`/test/runtime/terminal/${scope}`,{headers});assert.equal(terminalResponse.status,200);const terminal=await terminalResponse.json();assert.equal(terminal.state,'failed');
  const oldRuntime=terminal.evidence.sessionId,oldCharge=await sql.query(`select attempts from fmat.model_work_attempts where name=${q('conversation:'+failed)};`);
  const input={text:'recovery-context-fixture',clientId:randomUUID()},pending=await post(`/api/conversations/${scope}/messages`,input);assert.equal(pending.status,409);
  const identitySql=`select jsonb_build_object('id',id,'grantId',grant_id,'clientId',client_id,'fingerprint',input_fingerprint,'text',text) from fmat.runtime_messages where conversation_id=${q(scope)} and client_id=${q(input.clientId)};`;
  const original=JSON.parse(await sql.query(identitySql));assert.equal(original.text,input.text);
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/web','-p','3006'],{env:{...process.env,...env,APP_ORIGIN:origin,EVE_LOCAL_ORIGIN:runtime.origin,OPENAI_API_KEY:'',TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')},stdio:['ignore','pipe','pipe']});
  child.stdout!.on('data',v=>log+=v);child.stderr!.on('data',v=>log+=v);
  await expect.poll(async()=>{assert.equal(child!.exitCode,null);try{return (await fetch(origin+'/api/health')).status;}catch{return 0;}},{timeout:15000}).toBe(200);
  const path=`**/api/browser/conversations/${scope}/recovery`,bodies:unknown[]=[];let forward=false,lostStatus=0;
  await page.route(path,async route=>{if(route.request().method()!=='POST')return route.continue();bodies.push(route.request().postDataJSON());if(forward)lostStatus=(await route.fetch()).status();await route.abort();});
  await page.goto(origin+'/app');
  const card=page.getByRole('alert',{name:'Conversation recovery'}),composer=page.getByLabel('Message your scheduling assistant'),setupCard=page.getByRole('region',{name:'Your meeting setup'});
  await expect(card.getByRole('button',{name:'Recover conversation',exact:true})).toBeEnabled();
  await page.setViewportSize({width:640,height:900});await page.evaluate(()=>{document.documentElement.style.zoom='2';});
  const recoveryButton=card.getByRole('button',{name:'Recover conversation',exact:true});await recoveryButton.focus();await recoveryButton.scrollIntoViewIfNeeded();await expect(recoveryButton).toBeInViewport();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'.local/rebuild/browser-screenshots/terminal-recovery-controls-zoom.png'});
  await page.evaluate(()=>{document.documentElement.style.zoom='';});await page.setViewportSize({width:1280,height:900});
  await expect(page.getByText('Reply 1: retained-archive-sentinel',{exact:true})).toBeVisible();
  await card.getByText('Saved pending messages',{exact:true}).click();await expect(card.getByText(input.text,{exact:true})).toBeVisible();
  await composer.fill('Unsent draft stays here');
  // A second tab has the same current authority and observes the failed generation
  // before the first tab transitions. Its stale action must not create another.
  const second=await context.newPage();second.setDefaultTimeout(15000);await second.goto(origin+'/app');
  const other=second.getByRole('alert',{name:'Conversation recovery'});await expect(other.getByRole('button',{name:'Recover conversation',exact:true})).toBeEnabled();
  await card.getByRole('button',{name:'Recover conversation',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(card.getByRole('button',{name:'Retry same recovery'})).toBeEnabled();await expect(composer).toHaveValue('Unsent draft stays here');await expect(composer).toBeFocused();
  assert.deepEqual(await setup.read(credential),saved);assert.equal(await sql.query(`select count(*) from fmat.conversation_recoveries where conversation_id=${q(scope)};`),'0');
  await page.reload();await expect(card.getByRole('button',{name:'Retry same recovery'})).toBeEnabled();assert.equal(bodies.length,1);
  forward=true;await card.getByRole('button',{name:'Retry same recovery'}).click();await expect.poll(()=>lostStatus).toBe(200);assert.deepEqual(bodies[1],bodies[0]);
  // Post the second tab's genuinely observed old intent through its browser
  // credentials; avoid relying on a race against the periodic status refresh.
  const stale=await second.request.post(origin+`/api/browser/conversations/${scope}/recovery`,{headers:{origin},data:{expectedGeneration:0,idempotencyKey:randomUUID()}});assert.equal(stale.status(),409);
  await second.reload();await expect(other.getByText('Conversation recovery is ready',{exact:true})).toBeVisible();
  await page.reload();await expect(card.getByText('Conversation recovery is ready',{exact:true})).toBeVisible();assert.equal(bodies.length,2,'Reload never posts another recovery');
  assert.equal(await page.evaluate(scope=>sessionStorage.getItem('fmat:conversation-recovery:v1:'+scope),scope),null);
  assert.deepEqual(await setup.read(credential),saved,'Recovery itself does not edit or confirm setup');assert.equal(await sql.query(`select count(*) from fmat.runtime_messages where conversation_id=${q(scope)};`),'3','Recovery invents no input');
  await composer.fill('Next unsent draft');await expect(setupCard.getByRole('button',{name:'Edit schedule',exact:true})).toBeEnabled();
  await sql.query(`update fmat.runtime_messages set next_dispatch_at=clock_timestamp()-interval '1 second' where id=${q(original.id)};`);
  const dispatched=await fetch(runtime.origin+'/api/internal/conversations/dispatch',{method:'POST',headers:{authorization:'Bearer '+dispatchSecret}});assert.equal(dispatched.status,200);await settle(original.id,'completed');
  await expect(page.getByText('Recovered with retained historical context and one saved draft.',{exact:true})).toBeVisible();await expect(page.getByText('Reply 1: retained-archive-sentinel',{exact:true})).toHaveCount(1);await expect(composer).toHaveValue('Next unsent draft');
  assert.deepEqual(JSON.parse(await sql.query(identitySql)),original);assert.equal(await sql.query(`select attempts from fmat.model_work_attempts where name=${q('conversation:'+failed)};`),oldCharge);
  const current=await setup.read(credential);assert.equal(current.revision,saved.revision+1);assert.equal(current.draft?.settings.rules?.preferences,'Recovered preference');assert.equal(current.confirmed.rules,null);
  assert.equal(await sql.query(`select count(*) from fmat.booking_attempts where host_id='${host}';`),'0');
  assert.equal(await sql.query(`select count(*) from fmat.conversation_recoveries where conversation_id=${q(scope)};`),'1');assert.equal(await sql.query(`select count(*) from fmat.conversation_generations where conversation_id=${q(scope)};`),'2');assert.notEqual(await sql.query(`select runtime_session_id from fmat.conversation_scopes where id=${q(scope)};`),oldRuntime);
  await page.reload();await expect(page.getByText('Recovered with retained historical context and one saved draft.',{exact:true})).toBeVisible();await expect(page.getByText('Reply 1: retained-archive-sentinel',{exact:true})).toHaveCount(1);
  await expect(page.getByText('Conversation connection',{exact:true}),'Old failed history is not a current connection failure').toHaveCount(0);
  await page.setViewportSize({width:640,height:450});await page.evaluate(()=>{document.documentElement.style.zoom='2';});await composer.scrollIntoViewIfNeeded();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/terminal-recovery-zoom.png',fullPage:true});
  // Revoked recovery access clears protected history, while locally typed text
  // remains copyable on this page and can never be submitted under stale access.
  await composer.fill('Local draft retained after access ends');
  await sql.query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where user_id='${host}';`);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Draft retained on this page')).toHaveValue('Local draft retained after access ends');
  await expect(page.getByLabel('Message your scheduling assistant')).toHaveCount(0);await expect(page.getByText('Reply 1: retained-archive-sentinel',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Select draft text'}).click();await expect(page.getByLabel('Draft retained on this page')).toBeFocused();
  assert.equal(await page.evaluate(()=>Object.values(sessionStorage).some(value=>value.includes('Local draft retained'))),false);
  await page.getByRole('button',{name:'Discard draft'}).click();await expect(page.getByLabel('Draft retained on this page')).toHaveCount(0);
  await second.close();
 }finally{
  await browser.close();if(child&&child.exitCode===null){const closed=once(child,'close');child.kill('SIGTERM');await closed;}await runtime?.stop();await writeFile('.local/rebuild/terminal-recovery-web.log',log);
  try{if(host){await sql.query(`delete from fmat.conversation_recoveries where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_generations where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.model_work_attempts where name in(select 'conversation:'||m.id::text from fmat.runtime_messages m join fmat.conversation_scopes s on s.id=m.conversation_id where s.host_id='${host}');delete from fmat.model_budgets where name='host:${host}';delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');delete from fmat.conversation_scopes where host_id='${host}';delete from fmat.idempotency where actor_scope='host:${host}';delete from fmat.audit_events where subject_id in('${host}',${q(scope)});delete from fmat.hosts where id='${host}';delete from fmat.invitations where id='${invitation}';`);assert.equal((await fetch(local.API_URL+'/auth/v1/admin/users/'+host,{method:'DELETE',headers:admin})).status,200);}}
  finally{sql.close();}
 }
});

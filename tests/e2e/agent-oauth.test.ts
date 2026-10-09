import test from 'node:test';
import {exerciseIntakeCli} from './agent-intake-cli.ts';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {generateKeyPair,exportJWK,createLocalJWKSet,jwtVerify} from 'jose';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {TokenCipher} from '../../lib/server/calendar/encryption.ts';
import {chromium,expect} from '@playwright/test';
import {LocalSql} from '../integration/local-sql.ts';
import {oauthSecretHash} from '../../lib/server/oauth/service.ts';
import {agentIntakeProof} from '../../lib/server/oauth/intake-proof.ts';
import {pkceChallenge} from '../../lib/server/oauth/protocol.ts';
const q=(value:string)=>`'${value.replaceAll("'","''")}'`;
test('public OAuth routes and explicit host/requester consent survive reload, loss, refresh and revocation',{timeout:180000},async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const origin='http://localhost:3004',resource=origin+'/mcp',redirect='https://oauth-client.example/callback?keep=1',pair=await generateKeyPair('ES256',{extractable:true}),privateKey={...await exportJWK(pair.privateKey),kid:'browser-test'};
 const proofEnv={AGENT_INTAKE_PROOF_KEY:randomBytes(32).toString('base64'),TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/web','-p','3004'],{env:{...process.env,...proofEnv,NODE_OPTIONS:'--import='+new URL('./intake-calendar-fixture.mjs',import.meta.url).href,APP_ORIGIN:origin,SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,AGENT_OAUTH_SIGNING_JWK:JSON.stringify(privateKey)},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',v=>log+=v);child.stderr.on('data',v=>log+=v);
 const sql=new LocalSql(),browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();page.setDefaultTimeout(15000);
 const invitation=randomUUID(),requestId=randomUUID(),otherRequest=randomUUID(),requestSecret=randomBytes(32).toString('base64url'),email='oauth-browser-'+randomUUID()+'@example.test';
 let host='',client='',callback='',googleReturn='';const budgets=await sql.query('select coalesce(jsonb_agg(to_jsonb(b)),\'[]\'::jsonb) from fmat.oauth_budgets b;');
 const intakeBudgets=await sql.query("select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) from fmat.oauth_intake_budgets b;");
 const admin={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 async function start(scope:string,request?:string,handle?:string){
  const verifier=randomBytes(32).toString('base64url'),state=randomUUID();
  const query=new URLSearchParams({client_id:client,resource,redirect_uri:redirect,response_type:'code',scope,state,code_challenge:pkceChallenge(verifier),code_challenge_method:'S256',...(request?{request_id:request}:{}),...(handle?{handle}:{})});
  return {url:origin+'/oauth/authorize?'+query,verifier,state};
 }
 try{
  for(let n=0;n<100;n++){assert.equal(child.exitCode,null,log.slice(-1000));try{if((await fetch(origin+'/.well-known/oauth-authorization-server')).ok)break;}catch{}await delay(100);}
  const metadata=await context.request.get(origin+'/.well-known/oauth-authorization-server');assert.equal(metadata.status(),200);assert.equal((await metadata.json()).issuer,origin);assert.equal(metadata.headers()['set-cookie'],undefined);
  const jwks=await (await context.request.get(origin+'/oauth/jwks')).json();assert.equal(jwks.keys[0].d,undefined);
  for(const path of ['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'])assert.equal((await (await context.request.get(origin+path)).json()).resource,resource);
  assert.equal((await context.request.post(origin+'/oauth/token',{data:{grant_type:'authorization_code'}})).status(),415);
  const registered=await context.request.post(origin+'/oauth/register',{data:{client_name:'Test <script>alert(1)</script> agent',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']}});assert.equal(registered.status(),201);client=(await registered.json()).client_id;
  const before=await sql.query("select used from fmat.oauth_budgets where name='registration';");
  assert.equal((await context.request.post(origin+'/oauth/register',{data:{redirect_uris:['http://evil.example/cb']}})).status(),400);
  assert.equal(Number(await sql.query("select used from fmat.oauth_budgets where name='registration';")),Number(before)+1);
  const created=await fetch(local.API_URL+'/auth/v1/admin/users',{method:'POST',headers:admin,body:JSON.stringify({email,email_confirm:true,app_metadata:{provider:'google',providers:['google']}})});assert.equal(created.status,200);host=(await created.json()).id;
  await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values(${q(invitation)},${q(email)},${q(oauthSecretHash(invitation))},now()+interval '1 day','oauth-browser');insert into fmat.hosts(id,email,invitation_id) values(${q(host)},${q(email)},${q(invitation)});insert into fmat.requests(id,host_id,details,token_hash,expires_at) values(${q(requestId)},${q(host)},'{"title":"Design review"}',${q(oauthSecretHash(requestSecret))},now()+interval '1 day'),(${q(otherRequest)},${q(host)},'{}',${q(oauthSecretHash(randomUUID()))},now()+interval '1 day');`);
  await page.route(local.API_URL+'/auth/v1/authorize?*',async route=>{
   const url=new URL(route.request().url());assert.equal(url.searchParams.get('provider'),'google');assert.equal(url.searchParams.get('redirect_to'),origin+'/auth/callback');const challenge=url.searchParams.get('code_challenge')!,code=randomUUID();
   await sql.query(`insert into auth.flow_state(id,user_id,auth_code,code_challenge_method,code_challenge,provider_type,provider_access_token,provider_refresh_token,authentication_method,created_at,updated_at,auth_code_issued_at) values('${randomUUID()}',${q(host)},${q(code)},'s256',${q(challenge)},'google','','','oauth',now(),now(),now());`);
   googleReturn=origin+'/auth/callback?code='+code;await route.fulfill({status:303,headers:{location:googleReturn}});
  });
  await page.route('https://oauth-client.example/callback*',async route=>{callback=route.request().url();await route.fulfill({status:200,contentType:'text/html',body:'<p>Agent callback received</p>'});});
  const hostAttempt=await start('host:read');await page.goto(hostAttempt.url);await page.getByRole('button',{name:'Continue with Google'}).waitFor();
  const authorizationId=new URL(page.url()).searchParams.get('authorizationId')!;
  const wrong=await browser.newContext();assert.equal((await wrong.request.get(origin+'/api/browser/agent-oauth/state?authorizationId='+authorizationId)).status(),400);await wrong.close();
  assert.equal((await context.request.post(origin+'/api/browser/agent-oauth/decide',{headers:{origin:'https://evil.example'},data:{authorizationId,decision:'deny'}})).status(),403);
  await page.getByRole('button',{name:'Continue with Google'}).click();await page.getByRole('button',{name:'Grant access',exact:true}).waitFor();await expect(page.getByRole('button',{name:'Grant access',exact:true})).toBeEnabled();
  assert.equal(new URL(page.url()).pathname,'/connect/authorize');assert.equal(new URL(page.url()).searchParams.get('authorizationId'),authorizationId);assert.equal(await page.locator('script').filter({hasText:'alert(1)'}).count(),0);assert.ok((await page.textContent('body'))?.includes('Test <script>alert(1)</script> agent'));
  const cookies=await context.cookies();const binding=cookies.find(c=>c.name==='fmat-agent-'+authorizationId)!;assert.equal(binding.httpOnly,true);assert.equal(binding.sameSite,'Lax');assert.ok(!(await page.evaluate(()=>document.cookie)).includes(binding.value));
  await mkdir('.local/rebuild/browser-screenshots',{recursive:true});await page.screenshot({path:'.local/rebuild/browser-screenshots/agent-consent-desktop.png',fullPage:true});await page.setViewportSize({width:320,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/agent-consent-mobile.png',fullPage:true});
  let lost=false,lostStatus=0;await page.route('**/api/browser/agent-oauth/decide',async route=>{if(lost)return route.continue();lost=true;const response=await route.fetch();lostStatus=response.status();await route.abort('failed');});
  await page.getByRole('button',{name:'Grant access',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('alert').filter({hasText:'You can retry the same choice'}).waitFor();assert.equal(lostStatus,200);assert.equal(await sql.query(`select decision from fmat.oauth_authorizations where id=${q(authorizationId)};`),'grant');
  await page.unroute('**/api/browser/agent-oauth/decide');await page.reload();await page.getByRole('button',{name:'Continue to agent'}).waitFor();await page.getByRole('button',{name:'Continue to agent'}).click();await page.waitForURL('https://oauth-client.example/**');
  const callbackUrl=new URL(callback);assert.equal(callbackUrl.searchParams.get('state'),hostAttempt.state);assert.equal(callbackUrl.searchParams.get('keep'),'1');const code=callbackUrl.searchParams.get('code')!;
  const exchange={grant_type:'authorization_code',client_id:client,resource,redirect_uri:redirect,code,code_verifier:hostAttempt.verifier};
  assert.equal((await context.request.post(origin+'/oauth/token',{form:{...exchange,resource:resource+'/wrong'}})).status(),400);assert.equal((await context.request.post(origin+'/oauth/token',{form:{...exchange,code_verifier:'z'.repeat(43)}})).status(),400);
  const issued=await context.request.post(origin+'/oauth/token',{form:exchange});assert.equal(issued.status(),200);const token=await issued.json();assert.equal(issued.headers()['cache-control'],'no-store');
  const verified=await jwtVerify(token.access_token,createLocalJWKSet(jwks),{issuer:origin,audience:resource,typ:'at+jwt'});assert.equal(verified.payload.sub,host);assert.equal(verified.payload.scope,'host:read');assert.ok(!JSON.stringify(verified.payload).includes(email));
  assert.equal((await context.request.post(origin+'/oauth/token',{form:exchange})).status(),400);
  const refresh={grant_type:'refresh_token',client_id:client,resource,refresh_token:token.refresh_token};const rotated=await context.request.post(origin+'/oauth/token',{form:refresh});assert.equal(rotated.status(),200);const descendant=await rotated.json();
  await page.goto(origin+'/connect/authorize');await page.getByRole('button',{name:'Revoke access',exact:true}).click();await page.getByRole('status').filter({hasText:'Agent access revoked.'}).waitFor();assert.equal((await context.request.post(origin+'/oauth/token',{form:{...refresh,refresh_token:descendant.refresh_token}})).status(),400);
  const guest=await browser.newContext({viewport:{width:320,height:844}}),guestPage=await guest.newPage();guestPage.setDefaultTimeout(15000);let guestCallback='';
  try{
   await guestPage.route('https://oauth-client.example/callback*',async route=>{guestCallback=route.request().url();await route.fulfill({status:200,body:'Request agent callback'});});
   assert.equal((await guest.request.post(origin+'/api/browser/guest/exchange',{headers:{origin},data:{requestId,token:requestSecret}})).status(),200);
   const denied=await start('request:read',requestId);await guestPage.goto(denied.url);await guestPage.getByRole('button',{name:'Deny access'}).click();await guestPage.waitForURL('https://oauth-client.example/**');assert.equal(new URL(guestCallback).searchParams.get('error'),'access_denied');assert.equal(new URL(guestCallback).searchParams.get('state'),denied.state);
   const attempt=await start('request:read request:write',requestId);await guestPage.goto(attempt.url);await guestPage.getByRole('button',{name:'Grant access',exact:true}).waitFor();const guestId=new URL(guestPage.url()).searchParams.get('authorizationId')!;
   assert.equal(await guestPage.getByRole('button',{name:'Continue with Google'}).count(),0);assert.equal(await guestPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await guestPage.screenshot({path:'.local/rebuild/browser-screenshots/agent-requester-mobile.png',fullPage:true});
   assert.equal((await guest.request.post(origin+'/api/browser/agent-oauth/decide',{headers:{origin},data:{authorizationId:guestId,requestId:otherRequest,decision:'grant'}})).status(),401);
   await guestPage.getByRole('button',{name:'Grant access',exact:true}).click();await guestPage.waitForURL('https://oauth-client.example/**');
   const guestToken=await guest.request.post(origin+'/oauth/token',{form:{...exchange,code:new URL(guestCallback).searchParams.get('code')!,code_verifier:attempt.verifier}});assert.equal(guestToken.status(),200);const guestTokens=await guestToken.json();
   await guestPage.goto(origin+'/connect/authorize?requestId='+requestId);await guestPage.getByRole('button',{name:'Revoke access',exact:true}).waitFor();assert.ok((await guestPage.textContent('body'))?.includes('Read this meeting request'));
   await guestPage.getByRole('button',{name:'Revoke access',exact:true}).click();await guestPage.getByRole('status').filter({hasText:'Agent access revoked.'}).waitFor();assert.equal((await guest.request.post(origin+'/oauth/token',{form:{...refresh,refresh_token:guestTokens.refresh_token}})).status(),400);
   const expired=await start('request:read',requestId);await guestPage.goto(expired.url);const expiredId=new URL(guestPage.url()).searchParams.get('authorizationId')!;await sql.query(`update fmat.oauth_authorizations set created_at=now()-interval '11 minutes',expires_at=now()-interval '2 minutes' where id=${q(expiredId)};`);await guestPage.reload();await guestPage.getByRole('alert').filter({hasText:'expired or belongs to another browser'}).waitFor();assert.equal(await guestPage.getByRole('button',{name:'Grant access',exact:true}).count(),0);
  }finally{await guest.close();}
  const handle='intake-'+host.slice(0,8);
  const calendarProof=new TokenCipher(proofEnv).seal({accessToken:'intake-browser-fixture',refreshToken:'fixture-refresh',expiresAt:Date.now()+3600000,subject:'private-subject',scopes:['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events']},'google:host:'+host);
  await sql.query(`update fmat.hosts set handle=${q(handle)},display_name='Displayed intake host',rules='{"timezone":"Asia/Seoul","durationMinutes":30}',conflict_calendar_ids=array['private-calendar'],booking_calendar_id='private-calendar' where id=${q(host)};insert into fmat.calendar_connections(principal_kind,principal_id,provider_subject,scopes,encrypted_credential) values('host',${q(host)},'private-subject',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],${q(calendarProof)});`);
  await exerciseIntakeCli(origin,handle,sql,browser);
  const intake=await browser.newContext({viewport:{width:320,height:844}}),intakePage=await intake.newPage();intakePage.setDefaultTimeout(15000);let intakeCallback='';
  try{
   await intakePage.route('https://oauth-client.example/callback*',async route=>{intakeCallback=route.request().url();await route.fulfill({status:200,body:'Intake callback received'});});
   const denied=await start('request:intake request:read',undefined,handle);await intakePage.goto(denied.url);await intakePage.getByRole('button',{name:'Deny access'}).click();await intakePage.waitForURL('https://oauth-client.example/**');assert.equal(new URL(intakeCallback).searchParams.get('error'),'access_denied');
   const attempt=await start('request:intake request:read request:write',undefined,handle);await intakePage.goto(attempt.url);await intakePage.getByRole('button',{name:'Grant access',exact:true}).waitFor();
   const intakeId=new URL(intakePage.url()).searchParams.get('authorizationId')!;
   await expect(intakePage.getByText('Displayed intake host (@'+handle+')',{exact:true})).toBeVisible();
   assert.ok((await intakePage.textContent('body'))?.includes('within 15 minutes'));
   assert.equal(await intakePage.locator('input,textarea,select').count(),0);assert.equal(await intakePage.getByRole('button',{name:'Continue with Google'}).count(),0);
   const intakeCookie=(await intake.cookies()).find(cookie=>cookie.name==='fmat-agent-'+intakeId)!;assert.ok(intakeCookie.httpOnly);assert.ok(!(await intakePage.evaluate(()=>document.cookie)).includes(intakeCookie.value));
   const projected=await (await intake.request.get(origin+'/api/browser/agent-oauth/state?authorizationId='+intakeId)).json();assert.equal(projected.audience,'intake');assert.equal(projected.requestId,null);assert.ok(!JSON.stringify(projected).includes('private-calendar'));
   const wrong=await browser.newContext();try{assert.equal((await wrong.request.post(origin+'/api/browser/agent-oauth/decide',{headers:{origin},data:{authorizationId:intakeId,decision:'grant'}})).status(),400);}finally{await wrong.close();}
   assert.equal((await intake.request.post(origin+'/api/browser/agent-oauth/decide',{headers:{origin:'https://evil.example'},data:{authorizationId:intakeId,decision:'grant'}})).status(),403);
   assert.equal((await intake.request.post(origin+'/api/browser/agent-oauth/decide',{headers:{origin},data:{authorizationId:intakeId,requestId,decision:'grant'}})).status(),400);
   assert.equal(await intakePage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await intakePage.screenshot({path:'.local/rebuild/browser-screenshots/agent-intake-mobile.png',fullPage:true});
   await intakePage.setViewportSize({width:1280,height:900});await intakePage.evaluate(()=>{document.body.style.zoom='2';});assert.equal(await intakePage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await intakePage.screenshot({path:'.local/rebuild/browser-screenshots/agent-intake-zoom.png',fullPage:true});await intakePage.evaluate(()=>{document.body.style.zoom='1';});
   let intakeLost=false;await intakePage.route('**/api/browser/agent-oauth/decide',async route=>{if(intakeLost)return route.continue();intakeLost=true;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});
   await intakePage.getByRole('button',{name:'Grant access',exact:true}).click();await intakePage.getByRole('alert').filter({hasText:'You can retry the same choice'}).waitFor();await intakePage.unroute('**/api/browser/agent-oauth/decide');await intakePage.reload();await intakePage.getByRole('button',{name:'Continue to agent'}).click();await intakePage.waitForURL('https://oauth-client.example/**');
   assert.equal(new URL(intakeCallback).searchParams.get('state'),attempt.state);
   const exchange={grant_type:'authorization_code',client_id:client,resource,redirect_uri:redirect,code:new URL(intakeCallback).searchParams.get('code')!,code_verifier:attempt.verifier};
   for(const patch of [{client_id:randomUUID()},{resource:resource+'/wrong'},{redirect_uri:redirect+'x'},{code_verifier:'z'.repeat(43)}])assert.equal((await intake.request.post(origin+'/oauth/token',{form:{...exchange,...patch}})).status(),400);
   const response=await intake.request.post(origin+'/oauth/token',{form:exchange});assert.equal(response.status(),200);const tokens=await response.json();
   const verified=await jwtVerify(tokens.access_token,createLocalJWKSet(jwks),{issuer:origin,audience:resource,typ:'at+jwt'});assert.equal(verified.payload.actor_kind,'intake');
   assert.equal(verified.payload.sub,await sql.query(`select id from fmat.oauth_intakes where authorization_id=${q(intakeId)};`));assert.equal(await sql.query(`select count(*) from fmat.requests where host_id=${q(host)};`),'2','consent creates no preliminary request');
   assert.equal((await intake.request.post(origin+'/oauth/token',{form:exchange})).status(),400);
   await intakePage.setViewportSize({width:320,height:844});
   const handoffUrl=origin+'/connect/intake?authorizationId='+intakeId;
   await intakePage.goto(handoffUrl);await intakePage.getByText('Your agent has not created the request yet.',{exact:false}).waitFor();
   assert.equal((await intake.request.post(origin+'/api/browser/agent-oauth/intake-claim',{headers:{origin},data:{authorizationId:intakeId}})).status(),400);
   const retained=(await intake.cookies()).find(cookie=>cookie.name==='fmat-agent-'+intakeId)!;assert.ok(retained.httpOnly&&retained.expires>Date.now()/1000+29*86400);
   const binding=JSON.parse(await sql.query(`select jsonb_build_object('intake',id,'request',reserved_request_id,'grant',grant_id) from fmat.oauth_intakes where authorization_id=${q(intakeId)};`));
   const proof=agentIntakeProof(binding.intake,binding.request,proofEnv);
   const sdk=new Client({name:'browser-intake-test',version:'1.0.0'});let loseCreation=false;
   await sdk.connect(new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{authorization:'Bearer '+tokens.access_token}},fetch:async(input,init)=>{
    const response=await fetch(input,init);
    if(loseCreation&&String(init?.body).includes('fmat_create_request')){loseCreation=false;await response.clone().arrayBuffer();throw Error('Synthetic lost MCP creation response');}return response;
   }}));
   try{
    const catalog=await sdk.listTools();assert.ok(catalog.tools.some(t=>t.name==='fmat_create_request'));assert.ok(!catalog.tools.some(t=>t.name==='fmat_get_setup'));
    const publicContext=await sdk.callTool({name:'fmat_get_intake_context',arguments:{}});
    assert.deepEqual(publicContext.structuredContent,{result:{profile:{handle,displayName:'Displayed intake host',timezone:'Asia/Seoul',durationMinutes:30}}});
    assert.ok(!JSON.stringify(publicContext).includes('private-calendar'));
    const intent={idempotencyKey:randomUUID(),details:{requesterName:'Browser requester',requesterEmail:'requester@example.test',purpose:'Agent-created request',timezone:'Asia/Seoul',durationMinutes:30,windows:[]}};
    const missing=await sdk.callTool({name:'fmat_create_request',arguments:{...intent,details:{purpose:intent.details.purpose}}});
    assert.equal((missing.structuredContent as {result:{status:string}}).result.status,'clarification');assert.equal(await sql.query(`select count(*) from fmat.requests where host_id=${q(host)};`),'2');
    assert.equal((await sdk.callTool({name:'fmat_get_request',arguments:{requestId:binding.request,input:{}}})).isError,true);
    assert.equal((await sdk.callTool({name:'fmat_create_request',arguments:{...intent,details:{...intent.details,hostId:host}}})).isError,true);
    loseCreation=true;await assert.rejects(sdk.callTool({name:'fmat_create_request',arguments:intent}),/lost MCP creation response/);
    const created=await sdk.callTool({name:'fmat_create_request',arguments:intent});assert.deepEqual(created.structuredContent,{result:{status:'created',requestId:binding.request}});
    assert.deepEqual((await sdk.callTool({name:'fmat_create_request',arguments:intent})).structuredContent,created.structuredContent);
    assert.equal((await sdk.callTool({name:'fmat_create_request',arguments:{...intent,details:{...intent.details,purpose:'Changed'}}})).isError,true);
    assert.equal(await sql.query(`select count(*) from fmat.requests where host_id=${q(host)};`),'3');
    assert.equal((await sdk.callTool({name:'fmat_get_request',arguments:{requestId:binding.request,input:{}}})).isError,undefined);
    assert.equal((await sdk.callTool({name:'fmat_get_request',arguments:{requestId:otherRequest,input:{}}})).isError,true);
    assert.ok(!JSON.stringify(created).includes(proof));
   }finally{await sdk.close();}
   await sql.query(`update fmat.oauth_authorizations set created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' where id=${q(intakeId)};`);
   await intakePage.reload();await intakePage.getByRole('button',{name:'Open my request'}).waitFor();
   assert.equal(await intakePage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await intakePage.screenshot({path:'.local/rebuild/browser-screenshots/agent-intake-handoff-mobile.png',fullPage:true});
   await intakePage.setViewportSize({width:1280,height:900});await intakePage.evaluate(()=>{document.body.style.zoom='2';});assert.equal(await intakePage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await intakePage.screenshot({path:'.local/rebuild/browser-screenshots/agent-intake-handoff-zoom.png',fullPage:true});await intakePage.evaluate(()=>{document.body.style.zoom='1';});
   const copied=await browser.newContext();try{
    assert.equal((await copied.request.get(origin+'/api/browser/agent-oauth/intake-state?authorizationId='+intakeId)).status(),400);
    assert.equal((await copied.request.post(origin+'/api/browser/agent-oauth/intake-claim',{headers:{origin,authorization:'Bearer '+tokens.access_token},data:{authorizationId:intakeId}})).status(),400);
    assert.equal((await copied.cookies()).some(cookie=>cookie.name.startsWith('fmat-request-')),false);
   }finally{await copied.close();}
   assert.equal((await intake.request.post(origin+'/api/browser/agent-oauth/intake-claim',{headers:{origin:'https://evil.example'},data:{authorizationId:intakeId}})).status(),403);
   assert.notEqual((await intake.request.post(origin+'/api/browser/agent-oauth/intake-claim',{headers:{origin},data:{authorizationId:intakeId,requestId:otherRequest}})).status(),200);
   const status=await (await intake.request.get(origin+'/api/browser/agent-oauth/intake-state?authorizationId='+intakeId)).json();assert.equal(status.requestId,binding.request);assert.ok(!JSON.stringify(status).includes(proof));assert.equal('intakeId' in status,false);assert.equal('tokenExpiresAt' in status,false);
   let lostClaim=false;await intakePage.route('**/api/browser/agent-oauth/intake-claim',async route=>{if(lostClaim)return route.continue();lostClaim=true;const result=await route.fetch();assert.equal(result.status(),200);assert.deepEqual(await result.json(),{path:'/booking/'+binding.request});await route.abort('failed');});
   await intakePage.getByRole('button',{name:'Open my request'}).click();await intakePage.getByRole('alert').filter({hasText:'retry this same action'}).waitFor();await intakePage.unroute('**/api/browser/agent-oauth/intake-claim');await intakePage.reload();await intakePage.getByRole('button',{name:'Open my request'}).click();await intakePage.waitForURL(origin+'/booking/'+binding.request);
   const saved=(await intake.cookies()).find(cookie=>cookie.name==='fmat-request-'+binding.request)!;assert.equal(saved.value,proof);assert.equal(saved.httpOnly,true);assert.equal(saved.sameSite,'Lax');assert.ok(!(await intakePage.evaluate(()=>document.cookie)).includes(proof));
   const again=await intake.request.post(origin+'/api/browser/agent-oauth/intake-claim',{headers:{origin},data:{authorizationId:intakeId}});assert.equal(again.status(),200);assert.equal(Math.floor((await intake.cookies()).find(cookie=>cookie.name===saved.name)!.expires),Math.floor(saved.expires),'retry retains the original expiry at HTTP cookie precision');
   assert.equal((await intake.request.get(origin+'/api/browser/guest/state?requestId='+binding.request)).status(),200);
   const refresh={grant_type:'refresh_token',client_id:client,resource,refresh_token:tokens.refresh_token};
   assert.equal((await intake.request.post(origin+'/oauth/token',{form:{...refresh,scope:'request:decide request:intake request:read'}})).status(),400);
   const narrowedResponse=await intake.request.post(origin+'/oauth/token',{form:{...refresh,scope:'request:read'}});assert.equal(narrowedResponse.status(),200);const narrowed=await narrowedResponse.json();assert.equal(narrowed.scope,'request:read');
   const claims=await jwtVerify(narrowed.access_token,createLocalJWKSet(jwks),{issuer:origin,audience:resource,typ:'at+jwt'});assert.equal(claims.payload.sub,verified.payload.sub);assert.equal(claims.payload.actor_kind,'intake');
   const narrowClient=new Client({name:'narrowed-intake',version:'1.0.0'});await narrowClient.connect(new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{authorization:'Bearer '+narrowed.access_token}}}));
   try{assert.equal((await narrowClient.callTool({name:'fmat_get_request',arguments:{requestId:binding.request,input:{}}})).isError,undefined);await assert.rejects(narrowClient.callTool({name:'fmat_get_intake_context',arguments:{}}));}finally{await narrowClient.close();}
   await intakePage.goto(handoffUrl);await intakePage.getByRole('button',{name:'Revoke agent access'}).click();await intakePage.getByRole('status').filter({hasText:'Agent access revoked.'}).waitFor();
   assert.equal((await intake.request.post(origin+'/api/browser/agent-oauth/intake-claim',{headers:{origin},data:{authorizationId:intakeId}})).status(),400);
   await sql.query(`update fmat.requests set status='withdrawn',token_revoked_at=clock_timestamp() where id=${q(binding.request)};`);
   const receipt=await (await intake.request.get(origin+'/api/browser/guest/state?requestId='+binding.request)).json();assert.ok(JSON.stringify(receipt).includes('withdrawn'));assert.ok(!JSON.stringify(receipt).includes('Agent-created request'));
   await sql.query(`update fmat.requests set token_expires_at=clock_timestamp()-interval '1 second' where id=${q(binding.request)};`);assert.notEqual((await intake.request.get(origin+'/api/browser/guest/state?requestId='+binding.request)).status(),200);
   assert.equal((await intake.request.post(origin+'/oauth/token',{form:{...refresh,refresh_token:narrowed.refresh_token}})).status(),400);
  }finally{await intake.close();}
  assert.ok(googleReturn,'host flow used the existing Google-only PKCE callback');
 }finally{
  await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();child.kill('SIGTERM');await Promise.race([once(child,'exit'),delay(3000)]);if(child.exitCode===null)child.kill('SIGKILL');
  try{if(client)await sql.query(`delete from fmat.idempotency where actor_scope in(select 'intake:'||id from fmat.oauth_intakes where host_id=${q(host)});delete from fmat.audit_events where subject_id in(select id::text from fmat.requests where host_id=${q(host)});delete from fmat.oauth_refresh_tokens where grant_id in(select id from fmat.oauth_grants where client_id=${q(client)});delete from fmat.oauth_codes where grant_id in(select id from fmat.oauth_grants where client_id=${q(client)});delete from fmat.oauth_intakes where authorization_id in(select id from fmat.oauth_authorizations where client_id=${q(client)});delete from fmat.oauth_grants where client_id=${q(client)};delete from fmat.oauth_authorizations where client_id=${q(client)};delete from fmat.oauth_clients where id=${q(client)};`);
   if(host)await sql.query(`delete from fmat.requests where host_id=${q(host)};delete from fmat.calendar_connections where principal_kind='host' and principal_id=${q(host)};delete from fmat.hosts where id=${q(host)};delete from fmat.invitations where id=${q(invitation)};delete from auth.users where id=${q(host)};`);
   await sql.query(`delete from fmat.oauth_budgets;insert into fmat.oauth_budgets select * from jsonb_populate_recordset(null::fmat.oauth_budgets,${q(budgets)}::jsonb);`);
   await sql.query(`delete from fmat.oauth_intake_budgets;insert into fmat.oauth_intake_budgets select * from jsonb_populate_recordset(null::fmat.oauth_intake_budgets,${q(intakeBudgets)}::jsonb);`);
  }finally{sql.close();}
 }
});

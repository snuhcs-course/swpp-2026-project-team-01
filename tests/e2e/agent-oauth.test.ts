import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {generateKeyPair,exportJWK,createLocalJWKSet,jwtVerify} from 'jose';
import {chromium} from '@playwright/test';
import {LocalSql} from '../integration/local-sql.ts';
import {oauthSecretHash} from '../../lib/server/oauth/service.ts';
import {pkceChallenge} from '../../lib/server/oauth/protocol.ts';
const q=(value:string)=>`'${value.replaceAll("'","''")}'`;
test('public OAuth routes and explicit host/requester consent survive reload, loss, refresh and revocation',{timeout:180000},async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const origin='http://localhost:3004',resource=origin+'/mcp',redirect='https://oauth-client.example/callback?keep=1',pair=await generateKeyPair('ES256',{extractable:true}),privateKey={...await exportJWK(pair.privateKey),kid:'browser-test'};
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/web','-p','3004'],{env:{...process.env,APP_ORIGIN:origin,SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,AGENT_OAUTH_SIGNING_JWK:JSON.stringify(privateKey)},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',v=>log+=v);child.stderr.on('data',v=>log+=v);
 const sql=new LocalSql(),browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();page.setDefaultTimeout(15000);
 const invitation=randomUUID(),requestId=randomUUID(),otherRequest=randomUUID(),requestSecret=randomBytes(32).toString('base64url'),email='oauth-browser-'+randomUUID()+'@example.test';
 let host='',client='',callback='',googleReturn='';const budgets=await sql.query('select coalesce(jsonb_agg(to_jsonb(b)),\'[]\'::jsonb) from fmat.oauth_budgets b;');
 const admin={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
 async function start(scope:string,request?:string){
  const verifier=randomBytes(32).toString('base64url'),state=randomUUID();
  const query=new URLSearchParams({client_id:client,resource,redirect_uri:redirect,response_type:'code',scope,state,code_challenge:pkceChallenge(verifier),code_challenge_method:'S256',...(request?{request_id:request}:{})});
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
  await page.getByRole('button',{name:'Continue with Google'}).click();await page.getByRole('button',{name:'Grant access',exact:true}).waitFor();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Grant access')?.disabled);
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
  assert.ok(googleReturn,'host flow used the existing Google-only PKCE callback');
 }finally{
  await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();child.kill('SIGTERM');await Promise.race([once(child,'exit'),delay(3000)]);if(child.exitCode===null)child.kill('SIGKILL');
  try{if(client)await sql.query(`delete from fmat.oauth_refresh_tokens where grant_id in(select id from fmat.oauth_grants where client_id=${q(client)});delete from fmat.oauth_codes where grant_id in(select id from fmat.oauth_grants where client_id=${q(client)});delete from fmat.oauth_grants where client_id=${q(client)};delete from fmat.oauth_authorizations where client_id=${q(client)};delete from fmat.oauth_clients where id=${q(client)};`);
   if(host)await sql.query(`delete from fmat.requests where host_id=${q(host)};delete from fmat.hosts where id=${q(host)};delete from fmat.invitations where id=${q(invitation)};delete from auth.users where id=${q(host)};`);
   await sql.query(`delete from fmat.oauth_budgets;insert into fmat.oauth_budgets select * from jsonb_populate_recordset(null::fmat.oauth_budgets,${q(budgets)}::jsonb);`);
  }finally{sql.close();}
 }
});

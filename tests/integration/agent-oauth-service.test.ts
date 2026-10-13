import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {generateKeyPair,exportJWK} from 'jose';
import {Database} from '../../lib/server/database/client.ts';
import {AgentOAuthService,oauthSecretHash} from '../../lib/server/oauth/service.ts';
import {AgentOAuthTokens} from '../../lib/server/oauth/tokens.ts';
import {AgentOAuthError,pkceChallenge} from '../../lib/server/oauth/protocol.ts';
import {LocalSql} from './local-sql.ts';
const q=(value:string)=>`'${value.replaceAll("'","''")}'`;
const form=(value:Record<string,string>)=>new URLSearchParams(value).toString();
const invalid=(error:unknown)=>error instanceof AgentOAuthError&&error.code==='invalid_grant';
test('OAuth service issues, narrows, revokes and persists replay denial through real local PostgREST',async()=>{
 const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
 const pair=await generateKeyPair('ES256',{extractable:true});
 const env={APP_ORIGIN:'https://oauth-service.example.test',SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'local-test'})};
 const db=new Database(env),sql=new LocalSql(),service=new AgentOAuthService(env,db),tokens=new AgentOAuthTokens(env);
 const resource=env.APP_ORIGIN+'/mcp',redirect='https://client.example/cb',host=randomUUID(),invitation=randomUUID(),client=randomUUID(),browser=oauthSecretHash(randomUUID());
 async function fixture(){
  const request=randomUUID(),authorization=randomUUID(),secret=oauthSecretHash(randomUUID()),code=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
  await sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values(${q(request)},${q(host)},'{}',${q(secret)},clock_timestamp()+interval '1 day');insert into fmat.oauth_authorizations(id,client_id,resource,redirect_uri,scope,code_challenge,state,browser_hash,created_at,expires_at) values(${q(authorization)},${q(client)},${q(resource)},${q(redirect)},'request:read request:write',${q(pkceChallenge(verifier))},'state',${q(browser)},statement_timestamp(),statement_timestamp()+interval '10 minutes');`);
  const credential=JSON.stringify({kind:'guest',requestId:request,tokenHash:secret});
  const consent=JSON.parse(await sql.query(`select public.fmat_oauth_consent(${q(authorization)},${q(browser)},${q(credential)}::jsonb,'grant',${q(oauthSecretHash(code))});`));assert.equal(consent.decision,'grant');
  return {grant:await sql.query(`select id from fmat.oauth_grants where authorization_id=${q(authorization)};`),input:{grant_type:'authorization_code',client_id:client,resource,code,redirect_uri:redirect,code_verifier:verifier}};
 }
 try{
  await sql.query(`insert into auth.users(id,email,email_confirmed_at) values(${q(host)},'oauth-service@example.test',now());insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values(${q(invitation)},'oauth-service@example.test',${q(oauthSecretHash(invitation))},now()+interval '1 day','oauth-service');insert into fmat.hosts(id,email,invitation_id) values(${q(host)},'oauth-service@example.test',${q(invitation)});insert into fmat.oauth_clients(id,name,redirect_uris,resource) values(${q(client)},'OAuth service fixture',array[${q(redirect)}],${q(resource)});`);
  const first=await fixture();
  await assert.rejects(service.exchange(form({...first.input,code_verifier:'z'.repeat(43)})),invalid);
  const issued=await service.exchange(form(first.input));
  const claims=await tokens.verify(issued.access_token,async()=>{});assert.equal(claims.scope,'request:read request:write');assert.equal(claims.grant_id,first.grant);
  assert.equal(await sql.query(`select token_hash from fmat.oauth_refresh_tokens where grant_id=${q(first.grant)};`),oauthSecretHash(issued.refresh_token));
  await assert.rejects(service.exchange(form(first.input)),invalid);
  const refresh={grant_type:'refresh_token',client_id:client,resource,refresh_token:issued.refresh_token,scope:'request:read'};
  const narrowed=await service.exchange(form(refresh));assert.equal(narrowed.scope,'request:read');
  assert.deepEqual(await db.rpc('fmat_oauth_grant_check',{p_id:first.grant,p_client_id:client,p_resource:resource,p_actor_kind:claims.actor_kind,p_actor_id:claims.sub,p_scope:claims.scope}),{error:'invalid_grant'});
  await assert.rejects(service.exchange(form(refresh)),invalid);
  assert.equal(await sql.query(`select revoked_at is not null from fmat.oauth_grants where id=${q(first.grant)};`),'t','error response preserves committed replay revocation');
  await assert.rejects(service.exchange(form({...refresh,refresh_token:narrowed.refresh_token})),invalid);
  const second=await fixture(),active=await service.exchange(form(second.input));
  await service.revoke(form({client_id:client,resource,token:active.refresh_token}));
  await service.revoke(form({client_id:client,resource,token:'unknown'}));
  await assert.rejects(service.exchange(form({...refresh,refresh_token:active.refresh_token})),invalid);
 }finally{
  try{await sql.query(`delete from fmat.oauth_refresh_tokens where grant_id in(select id from fmat.oauth_grants where client_id=${q(client)});delete from fmat.oauth_codes where grant_id in(select id from fmat.oauth_grants where client_id=${q(client)});delete from fmat.oauth_grants where client_id=${q(client)};delete from fmat.oauth_authorizations where client_id=${q(client)};delete from fmat.oauth_clients where id=${q(client)};delete from fmat.requests where host_id=${q(host)};delete from fmat.hosts where id=${q(host)};delete from fmat.invitations where id=${q(invitation)};delete from auth.users where id=${q(host)};`);}finally{sql.close();}
 }
});

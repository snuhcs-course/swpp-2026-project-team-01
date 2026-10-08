// Local-only compatibility probe. Exit 2 means an observed resource-isolation
// gap, not readiness. Never load project .env files or contact hosted Auth.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const image='public.ecr.aws/supabase/gotrue:v2.197.0';
const localContainer='supabase_auth_swpp-2026-project-team-01';
const origin='http://localhost:3000',redirect='http://127.0.0.1:55440/callback';
const resource='https://release.findmeatime.com/mcp',wrongResource='https://other.invalid/mcp';
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30_000});
let stage='local prerequisites';
async function probe(){
 assert.equal(run('supabase',['--version']).trim(),'2.119.0','Pinned Supabase CLI required');
 const local=JSON.parse(run('supabase',['status','-o','json']));
 assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname),'Disposable local Auth only');
 const existing=JSON.parse(run('docker',['inspect',localContainer]))[0];
 assert.equal(existing.Config.Image,image,'Pinned local GoTrue image required');
 const networks=Object.keys(existing.NetworkSettings.Networks);assert.equal(networks.length,1);
 const env=Object.fromEntries(existing.Config.Env.map(entry=>{const at=entry.indexOf('=');return [entry.slice(0,at),entry.slice(at+1)];}));
 // Reuse local database/signing config but expose a separate loopback-only
 // Auth process. Never restart or reconfigure the existing stack.
 Object.assign(env,{GOTRUE_OAUTH_SERVER_ENABLED:'true',GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION:'true',GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH:'/connect/authorize',GOTRUE_SITE_URL:origin});
 const directory=mkdtempSync(join(tmpdir(),'fmat-oauth-probe-'));
 const envPath=join(directory,'auth.env');
 writeFileSync(envPath,Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n'),{mode:0o600});
 const container='fmat-oauth-probe-'+randomUUID();let started=false,client,user,base;
 const request=async(path,{body,token,method='GET',form=false}={})=>{
  const r=await fetch(base+path,{method,redirect:'manual',signal:AbortSignal.timeout(10_000),headers:{origin,...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':form?'application/x-www-form-urlencoded':'application/json'}:{})},body:body?(form?new URLSearchParams(body):JSON.stringify(body)):undefined});
  let data={};try{data=JSON.parse(await r.text());}catch{}
  return {status:r.status,data,location:r.headers.get('location')};
 };
 const status=(r,expected)=>assert.equal(r.status,expected,'Unexpected status at '+stage);
 try{
  stage='isolated Auth startup';
  run('docker',['run','--detach','--name',container,'--network',networks[0],'-p','127.0.0.1::9999','--env-file',envPath,image]);started=true;
  const instance=JSON.parse(run('docker',['inspect',container]))[0];
  const binding=instance.NetworkSettings.Ports['9999/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');base='http://127.0.0.1:'+binding.HostPort;
  let healthy=false;
  for(let i=0;i<30;i++){try{const health=await request('/health');if(health.status===200){assert.equal(health.data.version,'v2.197.0');healthy=true;break;}}catch{}await delay(200);}
  assert.ok(healthy,'Local Auth startup failed');
  const evidence={checkedAt:new Date().toISOString(),authVersion:'v2.197.0',sourceCommit:'4eee58f296d9698a1c2c0ae14d7a0b379c7622d3',localOnly:true};
  stage='discovery';const discovery=await request('/.well-known/oauth-authorization-server');status(discovery,200);
  evidence.discovery={pkce:discovery.data.code_challenge_methods_supported,grants:discovery.data.grant_types_supported};
  assert.ok(discovery.data.code_challenge_methods_supported.includes('S256'));
  stage='dynamic registration';const registered=await request('/oauth/clients/register',{method:'POST',body:{redirect_uris:[redirect],client_name:container,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token']}});status(registered,201);client=registered.data.client_id;assert.match(client,/^[a-f0-9-]{36}$/);
  stage='local fixture identity';const password=randomBytes(32).toString('base64url');
  const created=await request('/admin/users',{method:'POST',token:local.SERVICE_ROLE_KEY,body:{email:container+'@example.test',password,email_confirm:true}});status(created,200);user=created.data.id;
  const signed=await request('/token?grant_type=password',{method:'POST',body:{email:created.data.email,password}});status(signed,200);const login=signed.data.access_token;
  stage='authorization and consent';const verifier=randomBytes(32).toString('base64url'),state=randomUUID();
  const query=new URLSearchParams({client_id:client,redirect_uri:redirect,response_type:'code',scope:'email offline_access',state,resource,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  const start=await request('/oauth/authorize?'+query);status(start,302);const consentURL=new URL(start.location);assert.equal(consentURL.origin,origin);assert.equal(consentURL.pathname,'/connect/authorize');const id=consentURL.searchParams.get('authorization_id');assert.ok(id);
  const details=await request('/oauth/authorizations/'+id,{token:login});status(details,200);
  assert.equal(details.data.client.id,client);assert.equal(details.data.redirect_uri,redirect);
  const approved=await request('/oauth/authorizations/'+id+'/consent',{method:'POST',token:login,body:{action:'approve'}});status(approved,200);
  const callback=new URL(approved.data.redirect_url);assert.equal(callback.origin+callback.pathname,redirect);assert.equal(callback.searchParams.get('state'),state);
  const params={grant_type:'authorization_code',client_id:client,redirect_uri:redirect,code:callback.searchParams.get('code'),code_verifier:verifier,resource:wrongResource};
  stage='JSON resource mismatch';const jsonWrong=await request('/oauth/token',{method:'POST',body:params});evidence.wrongResourceJsonStatus=jsonWrong.status;status(jsonWrong,400);
  stage='PKCE mismatch';const badPkce=await request('/oauth/token',{method:'POST',body:{...params,resource,code_verifier:randomBytes(32).toString('base64url')},form:true});evidence.wrongPkceStatus=badPkce.status;status(badPkce,400);
  stage='form resource mismatch';const formWrong=await request('/oauth/token',{method:'POST',body:params,form:true});evidence.wrongResourceFormStatus=formWrong.status;
  // This pinned image is known to accept the mismatched form resource. Keep
  // the observed failure explicit; a future version needs a fresh probe.
  status(formWrong,200);
  const claims=JSON.parse(Buffer.from(formWrong.data.access_token.split('.')[1],'base64url'));
  evidence.accessAudience=claims.aud;evidence.clientBound=claims.client_id===client;
  stage='single-use code';const replay=await request('/oauth/token',{method:'POST',body:params,form:true});evidence.codeReplayStatus=replay.status;status(replay,400);
  stage='refresh resource mismatch';const refresh=await request('/oauth/token',{method:'POST',body:{grant_type:'refresh_token',client_id:client,refresh_token:formWrong.data.refresh_token,resource:wrongResource}});status(refresh,200);evidence.wrongResourceRefreshStatus=refresh.status;
  evidence.refreshAudience=JSON.parse(Buffer.from(refresh.data.access_token.split('.')[1],'base64url')).aud;
  stage='grant revocation';const revoke=await request('/user/oauth/grants?client_id='+client,{method:'DELETE',token:login});status(revoke,204);
  const revoked=await request('/oauth/token',{method:'POST',body:{grant_type:'refresh_token',client_id:client,refresh_token:refresh.data.refresh_token,resource},form:true});evidence.revokedRefreshStatus=revoked.status;status(revoked,400);
  evidence.resourceIsolationPassed=evidence.wrongResourceFormStatus===400&&evidence.wrongResourceRefreshStatus===400&&evidence.accessAudience===resource&&evidence.refreshAudience===resource;
  return evidence;
 }finally{
  // Attempt every cleanup even when one fails; never leave a running Auth
  // process just because removing a fixture record failed.
  const failures=[];
  if(client)try{const r=await request('/admin/oauth/clients/'+client,{method:'DELETE',token:local.SERVICE_ROLE_KEY});assert.ok([200,204].includes(r.status));}catch{failures.push('client');}
  if(user)try{const r=await request('/admin/users/'+user,{method:'DELETE',token:local.SERVICE_ROLE_KEY});assert.equal(r.status,200);}catch{failures.push('user');}
  if(started)try{run('docker',['rm','-f',container]);}catch{failures.push('container');}
  rmSync(directory,{recursive:true,force:true});
  assert.equal(failures.length,0,'Local cleanup failed: '+failures.join(', '));
 }
}
try{const evidence=await probe();console.log(JSON.stringify(evidence));if(!evidence.resourceIsolationPassed)process.exitCode=2;}
catch{console.error('Local OAuth compatibility probe failed at '+stage+'; verify local fixture cleanup before retrying.');process.exitCode=1;}

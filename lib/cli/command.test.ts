import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {generateKeyPair,exportJWK} from 'jose';
import {execFileSync} from 'node:child_process';
import {runCli} from './command.ts';
import {CliCredentialStore,type StoredConnection} from './store.ts';
import {AgentOAuthTokens} from '../server/oauth/tokens.ts';
import {AgentCredentials} from '../server/oauth/credentials.ts';
import {AgentOperations} from '../server/oauth/operations.ts';
import {agentMcpHttp} from '../server/mcp/http.ts';
async function* stdin(text=''){yield Buffer.from(text);}
test('runnable CLI handles browser login, private save, refresh, MCP calls and remote logout',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fmat-command-'));
 try{
  const origin='https://command.example.test',pair=await generateKeyPair('ES256',{extractable:true}),env={APP_ORIGIN:origin,AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'command'})};
  const grant={grantId:randomUUID(),clientId:randomUUID(),actorKind:'guest' as const,actorId:randomUUID(),scope:'request:decide request:read request:write',grantExpiresAt:Math.floor(Date.now()/1000)+3600};
  const token=await new AgentOAuthTokens(env).issue(grant,async()=>{}),connection:StoredConnection={version:1,origin,grantId:grant.grantId,clientId:grant.clientId,actorId:grant.actorId,actorKind:'guest',scope:grant.scope,accessToken:token,refreshToken:'a'.repeat(43),accessExpiresAt:Date.now()+1000,state:'ready'};
  let active=true,refreshes=0,revocations=0,callback='',out='',err='';
  const handle=agentMcpHttp(env,new AgentCredentials(env,{rpc:async()=>active?grant:{error:'invalid_grant'}}),new AgentOperations({rpc:async()=>({id:grant.actorId,revision:1})}));
  const dependencies={store:new CliCredentialStore(root),oauth:(selected:string)=>{assert.equal(selected,origin);return {
   async begin(scope:string,redirect:string,id?:string){assert.equal(scope,grant.scope);assert.equal(id,grant.actorId);callback=redirect+'?state='+'s'.repeat(43)+'&code='+'c'.repeat(43);return {authorizationUrl:origin+'/oauth/authorize?state='+'s'.repeat(43),async complete(){return connection;}};},
   async refresh(current:StoredConnection){refreshes++;return {...current,refreshToken:'b'.repeat(43),accessExpiresAt:Date.now()+300000};},
   async revoke(){revocations++;active=false;},
  };},openBrowser:async()=>{const r=await fetch(callback);assert.equal(r.status,200);await r.text();},fetcher:((input,init)=>handle(new Request(input,init))) as typeof fetch};
  async function run(args:string[],input=''){out='';err='';const code=await runCli(['--origin',origin,...args],{stdin:stdin(input),stdout:v=>out+=v,stderr:v=>err+=v},dependencies);assert.ok(!(out+err).includes(token));assert.ok(!(out+err).includes(connection.refreshToken));return code;}
  assert.equal(await run(['login','requester','--request',grant.actorId]),0);assert.equal(JSON.parse(out).connection,grant.grantId);assert.equal(err,'');await assert.rejects(fetch(callback));
  assert.equal(await run(['tools',grant.grantId]),0);assert.ok(JSON.parse(out).tools.some((t:{name:string})=>t.name==='fmat_get_request'));assert.equal(refreshes,1);
  assert.equal(await run(['call',grant.grantId,'fmat_get_request'],JSON.stringify({requestId:grant.actorId,input:{}})),0);assert.equal(JSON.parse(out).result.id,grant.actorId);assert.equal(refreshes,1);
  assert.equal(await run(['call',grant.grantId,'fmat_get_request'],JSON.stringify({requestId:randomUUID(),input:{}})),5);assert.equal(out,'');
  assert.equal(await run(['logout',grant.grantId]),0);assert.equal(revocations,1);assert.deepEqual(JSON.parse(out),{loggedOut:true});assert.equal(await run(['tools',grant.grantId]),3);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('CLI rejects credential arguments and help is valid JSON from the actual entry point',async()=>{
 for(const args of [[],['--token','secret'],['login','host','--request',randomUUID()],['call',randomUUID(),'fmat_get_request','secret'],['--origin','https://foreign.test/path','tools',randomUUID()]]){
  let out='',err='';assert.equal(await runCli(args,{stdin:stdin('{}'),stdout:v=>out+=v,stderr:v=>err+=v}),2);assert.equal(out,'');assert.equal(JSON.parse(err).error.code,'INVALID_INPUT');assert.ok(!err.includes('secret'));
 }
 const help=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/fmat.ts','--help'],{encoding:'utf8'}));assert.equal(help.usage.length,4);assert.ok(help.credentials.includes('no token flags'));
});

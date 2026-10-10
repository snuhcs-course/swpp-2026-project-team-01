import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {generateKeyPair,exportJWK} from 'jose';
import {cliCommand,cliOrigin,CliFailure,invokeMcp,runMcpCommand} from './mcp.ts';
import {AgentOAuthTokens} from '../server/oauth/tokens.ts';
import {AgentCredentials} from '../server/oauth/credentials.ts';
import {AgentOperations} from '../server/oauth/operations.ts';
import {agentMcpHttp} from '../server/mcp/http.ts';
async function* input(value:string|Uint8Array){yield typeof value==='string'?Buffer.from(value):value;}
const fails=(code:string)=>(error:unknown)=>error instanceof CliFailure&&error.code===code;
async function fixture(){
 const pair=await generateKeyPair('ES256',{extractable:true}),env={APP_ORIGIN:'https://cli.example.test',AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'cli-test'})};
 const grant={grantId:randomUUID(),clientId:randomUUID(),actorKind:'guest' as const,actorId:randomUUID(),scope:'request:read',grantExpiresAt:Math.floor(Date.now()/1000)+3600};
 const token=await new AgentOAuthTokens(env).issue(grant,async()=>{});let active=true,calls=0;
 const handle=agentMcpHttp(env,new AgentCredentials(env,{rpc:async()=>active?grant:{error:'invalid_grant'}}),new AgentOperations({rpc:async()=>{calls++;return {requestId:grant.actorId,revision:1};}}));
 const fetcher:typeof fetch=async(input,init)=>handle(new Request(input,init));
 return {origin:env.APP_ORIGIN,accessToken:token,requestId:grant.actorId,fetcher,calls:()=>calls,revoke:()=>{active=false;}};
}
test('CLI input is a bounded JSON object and accepts no credential flags',async()=>{
 assert.deepEqual(await cliCommand(['tools'],input('')), {kind:'tools'});
 assert.deepEqual(await cliCommand(['call','fmat_get_setup'],input('{"input":{}}')),{kind:'call',name:'fmat_get_setup',input:{input:{}}});
 for(const value of ['null','[]','"value"','{','x'.repeat(12289)])await assert.rejects(cliCommand(['call','fmat_get_setup'],input(value)),fails('INVALID_INPUT'));
 await assert.rejects(cliCommand(['call','fmat_get_setup'],input(new Uint8Array([0xff]))),fails('INVALID_INPUT'));
 for(const args of [['tools','--token','secret'],['call','fmat_get_setup','{}'],['call','unknown'],[]])await assert.rejects(cliCommand(args,input('{}')),fails('INVALID_INPUT'));
 for(const value of ['https://u:p@host.test','https://host.test/path','https://host.test?token=x','http://host.test','file:///tmp/test'])assert.throws(()=>cliOrigin(value),fails('INVALID_INPUT'));
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(cliCommand(['call','fmat_get_setup'],input('{}'),cancelled.signal),fails('INVALID_INPUT'));
 assert.equal(cliOrigin('https://host.test/'),'https://host.test');assert.equal(cliOrigin('http://127.0.0.1:3000'),'http://127.0.0.1:3000');
});
test('CLI uses official SDK discovery and invocation with current signed authority',async()=>{
 const f=await fixture(),listed=await invokeMcp(f.origin,f.accessToken,{kind:'tools'},f.fetcher) as {tools:{name:string}[]};
 assert.ok(listed.tools.some(t=>t.name==='fmat_get_request'));assert.ok(!listed.tools.some(t=>t.name==='fmat_get_setup'));
 const command={kind:'call' as const,name:'fmat_get_request',input:{requestId:f.requestId,input:{}}};
 assert.deepEqual(await invokeMcp(f.origin,f.accessToken,command,f.fetcher),{result:{requestId:f.requestId,revision:1}});assert.equal(f.calls(),1);
 await assert.rejects(invokeMcp(f.origin,f.accessToken,{...command,input:{requestId:randomUUID(),input:{}}},f.fetcher),fails('TOOL_FAILED'));assert.equal(f.calls(),1);
 await assert.rejects(invokeMcp(f.origin,f.accessToken,{kind:'call',name:'fmat_review_decision',input:command.input},f.fetcher),fails('INSUFFICIENT_SCOPE'));
 f.revoke();await assert.rejects(invokeMcp(f.origin,f.accessToken,command,f.fetcher),fails('LOGIN_REQUIRED'));assert.equal(f.calls(),1);
});
test('CLI never repeats a dispatched call after a lost reply or prints an echoed token',async()=>{
 const f=await fixture(),command={kind:'call' as const,name:'fmat_get_request',input:{requestId:f.requestId,input:{}}};
 const lost:typeof fetch=async(input,init)=>{const request=new Request(input,init),body=request.method==='POST'?await request.clone().json():{};const response=await f.fetcher(request);if(body.method==='tools/call')throw new Error('lost reply '+f.accessToken);return response;};
 let out='',err='';assert.equal(await runMcpCommand(command,f,v=>out+=v,v=>err+=v,lost),6);assert.equal(f.calls(),1);assert.equal(out,'');assert.ok(!err.includes(f.accessToken));
 const echo:typeof fetch=async(input,init)=>{const request=new Request(input,init),body=request.method==='POST'?await request.clone().json():{};const response=await f.fetcher(request);if(body.method!=='tools/call')return response;const data=await response.json();data.result.structuredContent={result:{echo:f.accessToken}};return Response.json(data);};
 out='';err='';assert.equal(await runMcpCommand(command,f,v=>out+=v,v=>err+=v,echo),6);assert.equal(out,'');assert.ok(!err.includes(f.accessToken));
});
test('CLI rejects redirected/oversized responses and sanitizes failures without retries',async()=>{
 const f=await fixture();let calls=0,out='',err='';
 const redirect:typeof fetch=async()=>{calls++;return new Response(null,{status:307,headers:{location:'https://attacker.test/mcp'}});};
 assert.equal(await runMcpCommand({kind:'tools'},f,v=>out+=v,v=>err+=v,redirect),6);assert.equal(calls,1);assert.equal(out,'');assert.equal(JSON.parse(err).error.code,'REMOTE_FAILURE');assert.ok(!err.includes(f.accessToken));assert.ok(!err.includes('attacker'));
 const oversized:typeof fetch=async()=>new Response('x'.repeat(512*1024+1),{headers:{'content-type':'application/json'}});
 await assert.rejects(invokeMcp(f.origin,f.accessToken,{kind:'tools'},oversized),fails('REMOTE_FAILURE'));
 const leaking:typeof fetch=async()=>{throw new Error(f.accessToken);};err='';await runMcpCommand({kind:'tools'},f,()=>assert.fail(),v=>err+=v,leaking);assert.ok(!err.includes(f.accessToken));
 const aborted=new AbortController();aborted.abort();await assert.rejects(invokeMcp(f.origin,f.accessToken,{kind:'tools'},f.fetcher,aborted.signal),fails('REMOTE_FAILURE'));
});

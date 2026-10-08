import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {generateKeyPair,exportJWK,decodeJwt,SignJWT} from 'jose';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {agentMcpHttp} from './http.ts';
import {AgentCredentials} from '../oauth/credentials.ts';
import {AgentOAuthTokens} from '../oauth/tokens.ts';
import {AgentOperations} from '../oauth/operations.ts';
const pair=await generateKeyPair('ES256',{extractable:true});
const env={...process.env,APP_ORIGIN:'https://mcp.example.test',AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'test'}),MCP_ALLOWED_ORIGINS:'["https://client.example.test"]'};
async function fixture(scope='request:read'){
 const grant={grantId:randomUUID(),clientId:randomUUID(),actorKind:'guest' as const,actorId:randomUUID(),scope,grantExpiresAt:Math.floor(Date.now()/1000)+3600};let active=true,calls=0;
 const token=await new AgentOAuthTokens(env).issue(grant,async()=>{});
 const credentials=new AgentCredentials(env,{rpc:async()=>active?grant:{error:'invalid_grant'}});
 const operations=new AgentOperations({rpc:async()=>{calls++;return active?{requestId:grant.actorId,revision:1}:{error:'invalid_grant'};}});
 const handle=agentMcpHttp(env,credentials,operations);
 const request=(body:unknown,headers:Record<string,string>={},url=env.APP_ORIGIN+'/mcp')=>new Request(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json, text/event-stream',...headers},body:JSON.stringify(body)});
 return {grant,token,handle,request,calls:()=>calls,revoke:()=>{active=false;}};
}
const list={jsonrpc:'2.0',id:1,method:'tools/list',params:{}};
test('Official MCP client initializes, lists and invokes with separate request authority',async()=>{
 const f=await fixture();
 const client=new Client({name:'test',version:'1.0.0'});
 const transport=new StreamableHTTPClientTransport(new URL(env.APP_ORIGIN+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+f.token}},fetch:async(input,init)=>f.handle(new Request(input,init))});
 try{
  await client.connect(transport);
  const tools=await client.listTools();assert.deepEqual(tools.tools.map(t=>t.name),['fmat_read_conversation','fmat_get_booking_status','fmat_review_connections','fmat_get_scheduling','fmat_get_availability','fmat_propose_availability','fmat_get_request','fmat_propose_request_details','fmat_review_decision']);
  const result=await client.callTool({name:'fmat_get_request',arguments:{requestId:f.grant.actorId,input:{}}});
  assert.deepEqual(result.structuredContent,{result:{requestId:f.grant.actorId,revision:1}});assert.equal(f.calls(),1);
  const wrong=await client.callTool({name:'fmat_get_request',arguments:{requestId:randomUUID(),input:{}}});assert.equal(wrong.isError,true);assert.equal(f.calls(),1);
  await assert.rejects(client.callTool({name:'fmat_get_setup',arguments:{input:{}}}),/not found/);assert.equal(f.calls(),1);
  f.revoke();await assert.rejects(client.listTools());assert.equal(f.calls(),1);
 }finally{await client.close();}
});
test('Missing, malformed, foreign and revoked tokens fail before tool dispatch',async()=>{
 const f=await fixture();
 for(const authorization of ['', 'Bearer google-token','Basic abc','Bearer '+f.token.slice(0,-5)+'wrong']){
  const response=await f.handle(f.request(list,{authorization,cookie:'fmat-host=synthetic'}));assert.equal(response.status,401);assert.match(response.headers.get('www-authenticate')!,/resource_metadata="https:\/\/mcp.example.test\/\.well-known\/oauth-protected-resource\/mcp"/);assert.equal(response.headers.get('cache-control'),'private, no-store');
 }
 const claims=decodeJwt(f.token);
 for(const patch of [{aud:'https://other.example.test/mcp'},{exp:Math.floor(Date.now()/1000)-1}]){
  const forged=await new SignJWT({...claims,...patch}).setProtectedHeader({alg:'ES256',typ:'at+jwt',kid:'test'}).sign(pair.privateKey);
  assert.equal((await f.handle(f.request(list,{authorization:'Bearer '+forged}))).status,401);
 }
 f.revoke();assert.equal((await f.handle(f.request(list))).status,401);assert.equal(f.calls(),0);
});
test('Origins, alternate credentials, methods, batches, oversized and malformed bodies are bounded',async()=>{
 const f=await fixture();
 assert.equal((await f.handle(f.request(list,{origin:'https://attacker.test'}))).status,403);
 const allowed=await f.handle(f.request(list,{origin:'https://client.example.test'}));assert.equal(allowed.status,200);assert.equal(allowed.headers.get('access-control-allow-origin'),'https://client.example.test');assert.equal(allowed.headers.get('access-control-allow-credentials'),null);
 assert.equal((await f.handle(f.request(list,{},env.APP_ORIGIN+'/mcp?access_token=unused'))).status,400);
 assert.equal((await f.handle(f.request([list]))).status,400);
 assert.equal((await f.handle(f.request({large:'x'.repeat(17000)}))).status,413);
 assert.equal((await f.handle(f.request(list,{'content-type':'text/plain'}))).status,415);
 const headers={authorization:'Bearer '+f.token,'content-type':'application/json'};
 assert.equal((await f.handle(new Request(env.APP_ORIGIN+'/mcp',{method:'POST',headers,body:'{'}))).status,400);
 assert.equal((await f.handle(new Request(env.APP_ORIGIN+'/mcp',{method:'GET',headers}))).status,405);
 const preflight=await f.handle(new Request(env.APP_ORIGIN+'/mcp',{method:'OPTIONS',headers:{origin:'https://client.example.test','access-control-request-method':'POST','access-control-request-headers':'authorization,mcp-protocol-version'}}));assert.equal(preflight.status,204);
 assert.equal(f.calls(),0);
});
test('Insufficient scope challenges advertise only the required role permission',async()=>{
 const f=await fixture();
 const response=await f.handle(f.request({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'fmat_review_decision',arguments:{requestId:f.grant.actorId,input:{}}}}));
 assert.equal(response.status,403);assert.match(response.headers.get('www-authenticate')!,/error="insufficient_scope", scope="request:decide"/);assert.equal(f.calls(),0);
});

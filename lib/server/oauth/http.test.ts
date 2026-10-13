import test from 'node:test';
import assert from 'node:assert/strict';
import {readOAuthBody,oauthJson,oauthErrorResponse,requirePublicClientTransport} from './http.ts';
import {AgentOAuthError} from './protocol.ts';
import {ApplicationError} from '../errors.ts';
const formType='application/x-www-form-urlencoded';
const request=(body:BodyInit,headers:Record<string,string>={},signal?:AbortSignal)=>new Request('https://example.test/oauth/token',{method:'POST',body,headers:{'content-type':formType,...headers},signal,duplex:'half'} as RequestInit);
const invalid=(error:unknown)=>error instanceof AgentOAuthError&&error.code==='invalid_request';
test('OAuth HTTP accepts bounded UTF-8 form/JSON and checks byte counts and media types',async()=>{
 assert.equal(await readOAuthBody(request('state=%E2%82%AC+one',{'content-type':formType+'; charset="UTF-8"'}),'form'),'state=%E2%82%AC+one');
 assert.equal(await readOAuthBody(request('{"x":1}',{'content-type':'application/json'}),'json'),'{"x":1}');
 assert.equal((await readOAuthBody(request('x'.repeat(16384)),'form')).length,16384);
 for(const headers of [{'content-type':'text/plain'},{'content-type':formType+'; charset=latin1'},{'content-type':formType+'; charset=utf-8; charset=utf-8'},{'content-encoding':'gzip'},{'content-length':'16385'},{'content-length':'-1'},{'content-length':'1, 1'},{'content-length':'4'}] as Record<string,string>[])await assert.rejects(readOAuthBody(request('x=1',headers),'form'),invalid);
 await assert.rejects(readOAuthBody(request('é'.repeat(8193)),'form'),invalid);
 await assert.rejects(readOAuthBody(request(new Uint8Array([0xff])),'form'),invalid);
 const chunks=[new Uint8Array([0xe2]),new Uint8Array([0x82,0xac])];
 assert.equal(await readOAuthBody(request(new ReadableStream({pull(c){const chunk=chunks.shift();if(chunk)c.enqueue(chunk);else c.close();}})),'form'),'€');
});
test('OAuth HTTP cancels oversized, aborted and failing streams without echoing input',async()=>{
 let cancelled=false;
 const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(16385));},cancel(){cancelled=true;return new Promise(()=>{});}});
 await assert.rejects(readOAuthBody(request(body),'form'),invalid);assert.equal(cancelled,true);
 const abort=new AbortController(),pending=readOAuthBody(request(new ReadableStream(),{},abort.signal),'form');abort.abort();await assert.rejects(pending,invalid);
 await assert.rejects(readOAuthBody(request('x=1',{},abort.signal),'form'),invalid);
 await assert.rejects(readOAuthBody(request(new ReadableStream({pull(){throw Error('private stream value');}})),'form'),invalid);
});
test('OAuth HTTP imposes a total five-second deadline even if stream cancellation hangs',async()=>{
 let cancelled=false;const started=Date.now();
 const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('a='));},cancel(){cancelled=true;return new Promise(()=>{});}});
 await assert.rejects(readOAuthBody(request(body),'form'),e=>invalid(e)&&(e as AgentOAuthError).status===408);
 assert.equal(cancelled,true);assert.ok(Date.now()-started>=4900);assert.ok(Date.now()-started<10000);
});
test('OAuth HTTP responses are no-store with sanitized protocol errors and no alternate authentication',async()=>{
 for(const [error,status,code] of [[new AgentOAuthError('invalid_grant'),400,'invalid_grant'],[new ApplicationError('PROVIDER_UNAVAILABLE',503),503,'temporarily_unavailable'],[Error('private SQL/token text'),500,'server_error']] as const){
  const response=oauthErrorResponse(error);assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('pragma'),'no-cache');assert.deepEqual(await response.json(),{error:code});
 }
 assert.equal(oauthJson({ok:true}).headers.get('referrer-policy'),'no-referrer');
 for(const value of ['Basic private','Bearer private',''])assert.throws(()=>requirePublicClientTransport(request('x=1',{authorization:value})),e=>e instanceof AgentOAuthError&&e.code==='invalid_client');
 requirePublicClientTransport(request('x=1'));
});

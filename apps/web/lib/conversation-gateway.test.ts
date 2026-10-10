import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {conversationGateway,runtimeOrigin} from './conversation-gateway.ts';
import {browserSession} from './session.ts';
const id='a2000000-0000-4000-8000-000000000001',host='a3000000-0000-4000-8000-000000000001';
const view={conversationId:id,hostId:host,audience:'host_setup',requestId:null,readOnly:false};

test('browser relay uses verified session authority and strips runtime-only response fields',async t=>{
  t.mock.property(process,'env',{...process.env,APP_ORIGIN:'https://release.example.test',EVE_LOCAL_ORIGIN:''});
  let called=false;
  t.mock.method(globalThis,'fetch',async(url:URL,init:RequestInit)=>{
    called=true;assert.equal(url.href,'https://release.example.test/api/conversations');
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer verified-token');
    assert.equal(new Headers(init.headers).has('cookie'),false);assert.equal(init.redirect,'error');
    return Response.json({...view,grantId:'private',sessionId:'private'});
  });
  const session={host:async()=>({token:'verified-token'})} as ReturnType<typeof browserSession>;
  const response=await conversationGateway(new NextRequest('https://release.example.test/api/browser/conversations',{method:'POST',headers:{authorization:'Bearer forged','content-type':'application/json',cookie:'irrelevant=private'},body:JSON.stringify({audience:'host_setup'})}),['conversations'],session);
  assert.equal(called,true);assert.deepEqual(await response.json(),view);assert.match(response.headers.get('cache-control')!,/private.*no-store/u);
});

test('guest relay binds the matching cookie and rejects framework control routes before fetching',async t=>{
  t.mock.property(process,'env',{...process.env,APP_ORIGIN:'http://localhost:3000',EVE_LOCAL_ORIGIN:'http://127.0.0.1:4000'});
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url:URL,init:RequestInit)=>{
    calls++;assert.equal(url.origin,'http://127.0.0.1:4000');assert.equal(new Headers(init.headers).get('authorization'),'Request '+'a'.repeat(43));assert.equal(new Headers(init.headers).get('x-request-id'),id);
    return Response.json({...view,messages:[]});
  });
  const session={host:async()=>{throw new Error('Guest must not use host authority');}} as unknown as ReturnType<typeof browserSession>;
  await conversationGateway(new NextRequest(`http://localhost:3000/api/browser/conversations/${id}?requestId=${id}`,{headers:{cookie:`fmat-request-${id}=${'a'.repeat(43)}`}}),['conversations',id],session);
  await assert.rejects(conversationGateway(new NextRequest(`http://localhost:3000/api/browser/conversations/${id}?requestId=${id}`),['conversations',id],session));
  await assert.rejects(conversationGateway(new NextRequest(`http://localhost:3000/api/browser/conversations/${id}/cancel`,{method:'POST'}),['conversations',id,'cancel'],session));
  assert.equal(calls,1);
  process.env.APP_ORIGIN='https://release.example.test';assert.throws(()=>runtimeOrigin());
  process.env.APP_ORIGIN='http://localhost:3000';process.env.EVE_LOCAL_ORIGIN='https://external.example.test';assert.throws(()=>runtimeOrigin());
});

test('recovery relay admits only fixed status and strict observed-generation requests',async t=>{
 t.mock.property(process,'env',{...process.env,APP_ORIGIN:'https://release.example.test',EVE_LOCAL_ORIGIN:''});
 const session={host:async()=>({token:'verified-token'})} as ReturnType<typeof browserSession>;
 const path=`https://release.example.test/api/browser/conversations/${id}/recovery`,parts=['conversations',id,'recovery'];
 const input={expectedGeneration:0,idempotencyKey:host},status={conversationId:id,generation:0,state:'recovery_required'};
 let calls=0,leak=false;
 t.mock.method(globalThis,'fetch',async(url:URL,init:RequestInit)=>{
  calls++;assert.equal(url.pathname,`/api/conversations/${id}/recovery`);assert.equal(url.search,'');
  assert.equal(new Headers(init.headers).get('authorization'),'Bearer verified-token');
  if(init.method==='POST')assert.deepEqual(JSON.parse(String(init.body)),input);
  return Response.json(leak?{...status,sessionId:'private-runtime'}:status);
 });
 assert.deepEqual(await (await conversationGateway(new NextRequest(path),parts,session)).json(),status);
 const post=(body:unknown)=>new NextRequest(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const response=await conversationGateway(post(input),parts,session);assert.deepEqual(await response.json(),status);assert.match(response.headers.get('cache-control')!,/private, no-store/);
 for(const candidate of [{expectedGeneration:0},{...input,evidence:{}},{...input,sessionId:'forged'}])await assert.rejects(conversationGateway(post(candidate),parts,session));
 assert.equal(calls,2);leak=true;await assert.rejects(conversationGateway(new NextRequest(path),parts,session));
});

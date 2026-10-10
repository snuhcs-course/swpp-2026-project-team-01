import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {browserLogin} from './login.ts';
import {CliFailure} from './mcp.ts';
import type {StoredConnection} from './store.ts';
const connection:StoredConnection={version:1,origin:'https://login.example.test',grantId:randomUUID(),clientId:randomUUID(),actorId:randomUUID(),actorKind:'host',scope:'host:read',accessToken:'aaa.bbb.ccc',refreshToken:'a'.repeat(43),accessExpiresAt:Date.now()+300000,state:'ready'};
const fails=(error:unknown)=>error instanceof CliFailure&&error.code==='LOGIN_REQUIRED';
function fixture(){let callback='',calls=0;return {client:{async begin(_scope:string,redirect:string){callback=redirect;return {authorizationUrl:'https://login.example.test/oauth/authorize?state='+'s'.repeat(43),async complete(url:string){calls++;assert.equal(new URL(url).origin,new URL(callback).origin);if(new URL(url).searchParams.has('error'))throw Error('private error');return connection;}};}},callback:()=>callback+'?state='+'s'.repeat(43)+'&code='+'c'.repeat(43),calls:()=>calls};}
test('browser listener binds ephemeral loopback, ignores foreign requests and closes after one callback',async()=>{
 const f=fixture();let callback='';
 const saved=await browserLogin(f.client,'host:read',async url=>{
  assert.equal(new URL(url).origin,connection.origin);callback=f.callback();assert.equal(new URL(callback).hostname,'127.0.0.1');assert.ok(new URL(callback).port);assert.match(new URL(callback).pathname,/^\/callback\/[A-Za-z0-9_-]{43}$/u);
  for(const [target,init] of [[callback.replace('/callback/','/wrong/'),{}],[callback+'&state=duplicate',{}],[callback,{headers:{origin:'https://foreign.test'}}],[callback,{method:'POST'}],[callback,{headers:{host:'foreign.test'}}]] as const){assert.equal((await fetch(target,init)).status,400);}
  assert.equal(f.calls(),0);const response=await fetch(callback);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const body=await response.text();assert.ok(!body.includes('ccc'));assert.ok(!body.includes('code='));
 });
 assert.deepEqual(saved,connection);assert.equal(f.calls(),1);await assert.rejects(fetch(callback));
});
test('denial, launcher failure and cancellation close the listener without returning credentials',async()=>{
 const denied=fixture();await assert.rejects(browserLogin(denied.client,'host:read',async()=>{await fetch(denied.callback()+'&error=access_denied').catch(()=>{});}),fails);assert.equal(denied.calls(),1);await assert.rejects(fetch(denied.callback()));
 const failed=fixture();await assert.rejects(browserLogin(failed.client,'host:read',async()=>{throw Error('launcher failed');}),fails);await assert.rejects(fetch(failed.callback()));
 const cancelled=fixture(),controller=new AbortController();await assert.rejects(browserLogin(cancelled.client,'host:read',async()=>{controller.abort();},{signal:controller.signal}),fails);assert.equal(cancelled.calls(),0);await assert.rejects(fetch(cancelled.callback()));
});
test('timeout closes an unused listener and concurrent callbacks exchange only once',async()=>{
 const unused=fixture();await assert.rejects(browserLogin(unused.client,'host:read',async()=>{},{timeoutMs:30}),fails);await assert.rejects(fetch(unused.callback()));
 const f=fixture();await browserLogin(f.client,'host:read',async()=>{await Promise.allSettled([fetch(f.callback()),fetch(f.callback())]);});assert.equal(f.calls(),1);
});

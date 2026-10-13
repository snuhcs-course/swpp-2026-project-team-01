import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {randomUUID} from 'node:crypto';
import {imessageBrowser} from './imessage-browser.ts';
import {HostIMessage} from '../../../lib/server/photon/linking.ts';
import {browserProof} from '../../../lib/server/photon/proof.ts';
import type {Credential} from '../../../lib/server/identity/credentials.ts';
import type {IMessageState} from '../../../lib/contracts/imessage.ts';
const state:IMessageState={available:true,skipped:false,link:null,challenge:null};
class Fixture extends HostIMessage {
 seen:{browser:string;input:unknown}[]=[];
 override async read(){return state;}
 override async start(_c:Credential,browser:string,input:unknown){this.seen.push({browser,input});return state;}
 override async verify(_c:Credential,browser:string,input:unknown){this.seen.push({browser,input});return state;}
}
test('browser establishes protected proof before sending, reuses it across reloads, and never returns protected inputs',async()=>{
 const previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://fixture.example';
 const service=new Fixture(),credential={kind:'host',subject:randomUUID(),sessionId:randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString()} as const;
 function request(action:string,body:unknown,cookie?:string){return new NextRequest('https://fixture.example/api/browser/imessage/'+action,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});}
 try{
  const bound=await imessageBrowser(request('bind',{}),'bind',credential,service),cookie=bound.cookies.get('__Host-fmat-imessage');assert.ok(cookie);
  assert.equal(cookie.httpOnly,true);assert.equal(cookie.secure,true);assert.equal(cookie.sameSite,'lax');assert.equal(cookie.path,'/');assert.equal(cookie.domain,undefined);
  assert.deepEqual(await bound.json(),{bound:true});assert.match(bound.headers.get('cache-control')!,/no-store/u);assert.equal(bound.headers.get('vary'),'Cookie');
  const header=cookie.name+'='+cookie.value;
  const rebound=await imessageBrowser(request('bind',{},header),'bind',credential,service);assert.equal(rebound.cookies.get(cookie.name)?.value,cookie.value);
  await assert.rejects(imessageBrowser(request('start',{phone:'+15550100001',idempotencyKey:randomUUID()}),'start',credential,service));assert.equal(service.seen.length,0);
  const input={challengeId:randomUUID(),code:'123456',idempotencyKey:randomUUID()};const result=await imessageBrowser(request('verify',input,header),'verify',credential,service);
  assert.equal(service.seen[0].browser,cookie.value);assert.deepEqual(service.seen[0].input,input);assert.ok(!(await result.text()).includes('123456'));
  assert.notEqual(cookie.value,browserProof());
 }finally{if(previous===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;}
});

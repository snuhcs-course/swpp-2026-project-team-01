import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {NextRequest} from 'next/server';
import {recoveryBrowser} from './recovery-browser.ts';
import {RequesterRecovery} from '../../../lib/server/contact/recovery.ts';
import {ApplicationError} from '../../../lib/server/errors.ts';
test('Recovery exchange exposes no token JSON and only sets a bounded secure request cookie after proof succeeds',async()=>{
 const previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://fixture.example';
 const requestId=randomUUID(),input={requestId,challengeId:randomUUID(),proof:randomBytes(32).toString('base64url')},token=randomBytes(32).toString('base64url');let calls=0,invalid=false;
 class Fixture extends RequesterRecovery{
  override async start(){calls++;return {status:'accepted' as const};}
  override async redeem(value:unknown){calls++;assert.deepEqual(value,input);if(invalid)throw new ApplicationError('CHALLENGE_INVALID',400);return {status:'recovered' as const,requestId,expiresAt:new Date(Date.now()+120000).toISOString(),token};}
 }
 const service=new Fixture(),request=(op:string,body:unknown,origin='https://fixture.example')=>new NextRequest('https://fixture.example/api/browser/recovery/'+op,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  await assert.rejects(recoveryBrowser(request('redeem',input,'https://wrong.test'),'redeem',service));assert.equal(calls,0);
  await assert.rejects(recoveryBrowser(request('redeem',{...input,redirectTo:'https://wrong.test'}),'redeem',service));assert.equal(calls,0);
  const accepted=await recoveryBrowser(request('start',{requestId,email:'guest@example.test',idempotencyKey:randomUUID()}),'start',service);assert.deepEqual(await accepted.json(),{status:'accepted'});assert.equal(accepted.headers.get('set-cookie'),null);
  const response=await recoveryBrowser(request('redeem',input),'redeem',service),cookie=response.cookies.get('fmat-request-'+requestId)!;
  assert.equal(cookie.value,token);assert.ok(cookie.httpOnly&&cookie.secure);assert.equal(cookie.sameSite,'lax');assert.equal(cookie.path,'/');assert.ok(cookie.maxAge!<=120&&cookie.maxAge!>0);assert.equal(response.cookies.get('fmat-receipt-'+requestId)?.value,'');
  assert.match(response.headers.get('cache-control')!,/private.*no-store/);assert.equal(response.headers.get('vary'),'Cookie');assert.equal(response.headers.get('referrer-policy'),'no-referrer');const data=await response.json();assert.equal(data.requestId,requestId);assert.ok(!JSON.stringify(data).includes(token));assert.ok(!JSON.stringify(data).includes(input.proof));
  invalid=true;await assert.rejects(recoveryBrowser(request('redeem',input),'redeem',service));
 }finally{if(previous===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;}
});

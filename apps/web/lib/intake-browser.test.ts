import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {NextRequest} from 'next/server';
import {PublicIntake} from '../../../lib/server/identity/public-intake.ts';
import {ApplicationError} from '../../../lib/server/errors.ts';
import {intakeBrowser,attemptId} from './intake-browser.ts';

test('intake cookies bind recovery to the original browser without returning a credential',async()=>{
 const previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://fixture.example';
 const handle='public-host',details={requesterName:'Guest',requesterEmail:'guest@example.test',purpose:'Meeting',durationMinutes:30,timezone:'Asia/Seoul',windows:[]};
 const continuation={requestId:randomUUID(),tokenExpiresAt:new Date(Date.now()+120000).toISOString(),closed:false};let committed=false,seen='',failure='';
 class Fixture extends PublicIntake{
  override async create(_handle:string,token:string,input:unknown){seen=token;assert.equal(_handle,handle);assert.deepEqual(input,details);committed=true;return continuation;}
  override async resume(_handle:string,token:string){assert.equal(_handle,handle);seen=token;if(failure)throw new ApplicationError(failure==='revoked'?'NOT_FOUND':'PROVIDER_UNAVAILABLE',failure==='revoked'?404:503);return committed?continuation:null;}
 }
 const service=new Fixture(),request=(operation:string,body:unknown,cookie='')=>new NextRequest('https://fixture.example/api/browser/intake/'+operation,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  await assert.rejects(intakeBrowser(request('create',{handle,attemptId:randomBytes(32).toString('hex'),details}),'create',service));
  const bound=await intakeBrowser(request('bind',{handle}),'bind',service),proof=bound.cookies.get('__Host-fmat-intake-'+handle)!;
  assert.ok(proof.httpOnly&&proof.secure);assert.equal(proof.sameSite,'lax');assert.equal(proof.path,'/');assert.equal(proof.maxAge,30*86400);
  const binding=await bound.json();assert.equal(binding.attemptId,attemptId(proof.value));assert.notEqual(binding.attemptId,createHash('sha256').update(proof.value).digest('hex'));
  const cookie=proof.name+'='+proof.value;
  const retryBind=await intakeBrowser(request('bind',{handle},cookie),'bind',service);assert.deepEqual(await retryBind.json(),binding);assert.equal(retryBind.cookies.getAll().length,0,'binding retry never extends its expiry');
  await assert.rejects(intakeBrowser(request('create',{handle,attemptId:attemptId(randomBytes(32).toString('base64url')),details},cookie),'create',service));
  const response=await intakeBrowser(request('create',{handle,...binding,details},cookie),'create',service);assert.deepEqual(await response.json(),continuation);assert.equal(seen,proof.value);
  const guest=response.cookies.get('fmat-request-'+continuation.requestId)!;assert.ok(guest.httpOnly&&guest.secure);assert.ok(guest.maxAge!<=120);assert.equal(guest.value,proof.value);
  const recovered=await intakeBrowser(request('resume',{handle,...binding},cookie),'resume',service);assert.deepEqual(await recovered.json(),continuation);assert.equal(recovered.cookies.get(guest.name)?.value,proof.value);
  assert.match(recovered.headers.get('cache-control')!,/private.*no-store/);assert.equal(recovered.headers.get('vary'),'Cookie');
  const next=await intakeBrowser(request('new',{handle,...binding},cookie),'new',service);assert.notEqual(next.cookies.get(proof.name)?.value,proof.value);assert.equal(next.cookies.get(guest.name),undefined,'new intake does not remove the previous receipt authority');
  failure='offline';await assert.rejects(intakeBrowser(request('resume',{handle,...binding},cookie),'resume',service),'transient failure cannot clear a binding');
  failure='revoked';const revoked=await intakeBrowser(request('resume',{handle,...binding},cookie),'resume',service);assert.equal(revoked.status,404);assert.equal(revoked.cookies.get(proof.name)?.maxAge,0,'expired/revoked binding can be replaced on the next explicit retry');
 }finally{if(previous===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;}
});

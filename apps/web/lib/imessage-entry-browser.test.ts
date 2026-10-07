import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {imessageEntryBrowser} from './imessage-entry-browser.ts';
import {PhotonBrowserHandoff} from '../../../lib/server/photon/handoff-browser.ts';
import {browserProof} from '../../../lib/server/photon/proof.ts';
import {ApplicationError} from '../../../lib/server/errors.ts';

test('anonymous entry exchange establishes separate HttpOnly proof and retains only bounded masked state',async()=>{
 const previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://fixture.example';
 const proof={handoffId:randomUUID(),token:browserProof()},state={maskedPhone:'••••0001',expiresAt:new Date(Date.now()+120000).toISOString()};
 let browserSeen='',revoked=false;
 class Fixture extends PhotonBrowserHandoff {
  override async exchange(browser:string,input:unknown){browserSeen=browser;assert.deepEqual(input,proof);return state;}
  override async read(){if(revoked)throw new ApplicationError('CHALLENGE_INVALID',400);return state;}
 }
 const service=new Fixture(),request=(op:string,body?:unknown,cookie='')=>new NextRequest('https://fixture.example/api/browser/imessage-entry/'+op,{method:body===undefined?'GET':'POST',headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  await assert.rejects(imessageEntryBrowser(request('exchange',proof),'exchange',service));
  const bound=await imessageEntryBrowser(request('bind',{}),'bind',service),browser=bound.cookies.get('__Host-fmat-imessage')!;
  assert.ok(browser.httpOnly&&browser.secure);assert.equal(browser.path,'/');assert.equal(browser.sameSite,'lax');assert.deepEqual(await bound.json(),{bound:true});
  const cookie=browser.name+'='+browser.value;
  const exchanged=await imessageEntryBrowser(request('exchange',proof,cookie),'exchange',service),entry=exchanged.cookies.get('__Host-fmat-imessage-entry')!;
  assert.equal(browserSeen,browser.value);assert.ok(entry.httpOnly&&entry.secure);assert.equal(entry.sameSite,'lax');assert.ok(entry.maxAge!<=120&&entry.maxAge!>0);assert.deepEqual(await exchanged.json(),state);
  assert.match(exchanged.headers.get('cache-control')!,/no-store/);assert.equal(exchanged.headers.get('vary'),'Cookie');
  revoked=true;const expired=await imessageEntryBrowser(request('read',undefined,cookie+'; '+entry.name+'='+entry.value),'read',service);
  assert.equal(await expired.json(),null);assert.equal(expired.cookies.get(entry.name)?.maxAge,0);
 }finally{if(previous===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;}
});

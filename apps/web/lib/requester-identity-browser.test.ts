import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {RequesterIdentity,type IdentityAuthority} from '../../../lib/server/identity/requester-identity.ts';
import {requesterIdentityBrowser,requesterIdentityCallback,identityCookie,identityMarker} from './requester-identity-browser.ts';
import {attemptId} from './intake-browser.ts';
import {requireCredential} from '../../../lib/server/identity/credentials.ts';

test('identity browser routes use HttpOnly target cookies, strict input and marked fixed returns',async()=>{
 const previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://fixture.example';
 const token=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('base64url'),binding=randomBytes(32).toString('base64url'),handle='host-name';let calls=0;
 class Fixture extends RequesterIdentity{
  override async start(a:IdentityAuthority){calls++;assert.deepEqual(a,{kind:'intake',handle,token});return {state,binding,url:'https://accounts.google.com/o/oauth2/v2/auth?state='+state};}
  override async lookup(s:string,b:string){assert.equal(s,state);assert.equal(b,binding);return {kind:'intake' as const,target:handle};}
  override async callback(a:IdentityAuthority){assert.deepEqual(a,{kind:'intake',handle,token});return {returnPath:'/'+handle,result:'verified' as const};}
  override async read(a:IdentityAuthority){assert.equal(a.kind,'guest');if(a.kind==='guest')requireCredential(a);return null;}
 }
 const service=new Fixture(),cookie='__Host-fmat-intake-'+handle+'='+token,body={target:{kind:'intake',handle},attemptId:attemptId(token),draft:{}};
 const request=(data:unknown,jar=cookie)=>new NextRequest('https://fixture.example/api/browser/requester-identity/start',{method:'POST',headers:{cookie:jar,'content-type':'application/json'},body:JSON.stringify(data)});
 try{
  await assert.rejects(requesterIdentityBrowser(request(body,''),'start',service));await assert.rejects(requesterIdentityBrowser(request({...body,token}),'start',service));assert.equal(calls,0);
  const response=await requesterIdentityBrowser(request(body),'start',service),data=await response.json();assert.deepEqual(Object.keys(data),['url']);assert.equal(new URL(data.url).searchParams.get('state'),identityMarker+state);
  const saved=response.cookies.get(identityCookie(state,true))!;assert.ok(saved.httpOnly&&saved.secure);assert.equal(saved.sameSite,'lax');assert.equal(saved.path,'/');assert.equal(saved.maxAge,600);assert.match(response.headers.get('cache-control')!,/no-store/);
  const url='https://fixture.example/connections/google/callback?state='+identityMarker+state+'&code=private-code&next=https://wrong.test';
  const returned=await requesterIdentityCallback(new NextRequest(url,{headers:{cookie:cookie+'; '+saved.name+'='+binding}}),service);assert.equal(returned.headers.get('location'),'https://fixture.example/'+handle+'?identity=verified');assert.equal(returned.cookies.get(saved.name)?.maxAge,0);
  const wrong=await requesterIdentityCallback(new NextRequest(url),service);assert.equal(wrong.headers.get('location'),'https://fixture.example/?identity=expired');assert.equal(wrong.headers.get('referrer-policy'),'no-referrer');
  const id=randomUUID(),read=new NextRequest('https://fixture.example/api/browser/requester-identity/state?kind=guest&requestId='+id,{headers:{cookie:'fmat-request-'+id+'='+token}});assert.equal(await (await requesterIdentityBrowser(read,'state',service)).json(),null);
 }finally{if(previous===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;}
});

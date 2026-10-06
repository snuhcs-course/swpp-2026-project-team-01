import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OAuth2Client} from 'google-auth-library';
import {GoogleCalendarProvider} from './catalog.ts';
import {calendarScopes} from './google.ts';
import {ApplicationError} from '../errors.ts';
const env={GOOGLE_CLIENT_ID:'fixture-client',GOOGLE_CLIENT_SECRET:'fixture-secret'};
const code=(expected:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===expected;
test('Calendar list follows bounded opaque page tokens on Google only and exposes metadata without credentials',async()=>{
  let calls=0;
  const provider=new GoogleCalendarProvider(env,async(input,init)=>{
    const url=new URL(String(input));assert.equal(url.origin,'https://www.googleapis.com');assert.equal(url.pathname,'/calendar/v3/users/me/calendarList');assert.equal(url.searchParams.get('showHidden'),'true');assert.equal((init?.headers as Record<string,string>).authorization,'Bearer private-access');assert.equal(init?.redirect,'error');
    calls++;if(calls===1)return Response.json({items:[{id:'one',summary:'Duplicate name',accessRole:'reader',primary:true},{id:'gone',accessRole:'owner',deleted:true}],nextPageToken:'https://untrusted.test/token'});
    assert.equal(url.searchParams.get('pageToken'),'https://untrusted.test/token');
    return Response.json({items:[{id:'one',accessRole:'reader'},{id:'two',summary:'Duplicate name',summaryOverride:'Preferred name',accessRole:'writerWithoutPrivateAccess',backgroundColor:'javascript:bad'}]});
  });
  assert.deepEqual(await provider.list('private-access'),[{id:'one',name:'Duplicate name',accessRole:'reader',primary:true,timeZone:null,color:null},{id:'two',name:'Preferred name',accessRole:'writerWithoutPrivateAccess',primary:false,timeZone:null,color:null}]);assert.equal(calls,2);
});
test('Calendar partial, malformed, looping and unauthorized reads fail instead of returning empty or incomplete calendars',async()=>{
  for(const failure of [()=>new Response('',{status:503}),()=>Response.json({items:[{id:'bad',accessRole:'unknown'}]}),()=>Promise.reject(new Error('private provider details'))]){
    let calls=0;const provider=new GoogleCalendarProvider(env,async()=>++calls===1?Response.json({items:[{id:'one',accessRole:'owner'}],nextPageToken:'next'}):failure());
    await assert.rejects(provider.list('token'),code('PROVIDER_UNAVAILABLE'));
  }
  const looping=new GoogleCalendarProvider(env,async()=>Response.json({items:[],nextPageToken:'same'}));await assert.rejects(looping.list('token'),code('PROVIDER_UNAVAILABLE'));
  const denied=new GoogleCalendarProvider(env,async()=>new Response('',{status:401}));await assert.rejects(denied.list('token'),code('RECONNECT_REQUIRED'));
  const empty=new GoogleCalendarProvider(env,async()=>Response.json({items:[]}));assert.deepEqual(await empty.list('token'),[]);
});
test('Refresh preserves omitted refresh material and scopes but rejects invalid grants, missing scope and transient failures safely',async t=>{
  const original={accessToken:'old',refreshToken:'refresh',subject:'subject',expiresAt:1,scopes:[...calendarScopes.host]};
  let response:unknown={credentials:{access_token:'new',expiry_date:Date.now()+3600000}},failure:unknown;
  t.mock.method(OAuth2Client.prototype,'refreshAccessToken',async function(this:OAuth2Client){assert.equal(this.credentials.refresh_token,'refresh');if(failure)throw failure;return response;});
  const provider=new GoogleCalendarProvider(env);assert.deepEqual(await provider.refresh(original),{...original,accessToken:'new',expiresAt:(response as {credentials:{expiry_date:number}}).credentials.expiry_date});
  response={credentials:{access_token:'new',expiry_date:Date.now()+3600000,scope:calendarScopes.guest.join(' ')}};await assert.rejects(provider.refresh(original),code('RECONNECT_REQUIRED'));
  failure={response:{data:{error:'invalid_grant'}}};await assert.rejects(provider.refresh(original),code('RECONNECT_REQUIRED'));
  failure=new Error('private response');await assert.rejects(provider.refresh(original),code('PROVIDER_UNAVAILABLE'));
});

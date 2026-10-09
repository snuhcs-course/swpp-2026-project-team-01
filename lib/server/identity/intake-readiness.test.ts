import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {checkIntakeReadiness,type IntakeReadinessAuthority} from './intake-readiness.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import type {CalendarProvider,CalendarEntry} from '../calendar/catalog.ts';
import {ApplicationError} from '../errors.ts';

function fixture(expiresIn=120_000){
 const now=Date.now(),env={TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
 const cipher=new TokenCipher(env),principalId=randomUUID();
 const bundle={accessToken:'private-access',refreshToken:'private-refresh',expiresAt:now+expiresIn,subject:'private-subject',scopes:['private-scope']};
 const context={profile:{handle:'sample-host',displayName:'Host',timezone:'Asia/Seoul',durationMinutes:30},grant:{principalId,connectionId:randomUUID(),generation:randomUUID(),rulesVersion:7,conflictCalendarIds:['busy'],bookingCalendarId:'book',encryptedCredential:cipher.seal(bundle,'google:host:'+principalId)}};
 const version={connectionId:context.grant.connectionId,generation:context.grant.generation,rulesVersion:7};
 const calls:string[]=[],calendars:CalendarEntry[]=[{id:'busy',name:'Private conflicts',accessRole:'freeBusyReader',primary:false,timeZone:null,color:null},{id:'book',name:'Private booking',accessRole:'writer',primary:false,timeZone:null,color:null}];
 const provider:CalendarProvider={async refresh(value){calls.push('refresh');return {...value,accessToken:'new-private-access',expiresAt:now+3600000};},async list(token){calls.push('list:'+token);return calendars;}};
 const authority:IntakeReadinessAuthority={async refresh(input){calls.push('persist');assert.equal(input.previousCredential,context.grant.encryptedCredential);assert.deepEqual(cipher.open(input.encryptedCredential,'google:host:'+principalId),{...bundle,accessToken:'new-private-access',expiresAt:now+3600000});assert.deepEqual({connectionId:input.connectionId,generation:input.generation,rulesVersion:input.rulesVersion},version);},async check(input){calls.push('check');assert.deepEqual(input,version);assert.equal(Object.isFrozen(input),true);}};
 return {now,env,cipher,bundle,context,version,calls,calendars,provider,authority};
}

test('intake preflight returns only public profile and version evidence after the authority recheck',async()=>{
 const f=fixture();
 assert.deepEqual(await checkIntakeReadiness(f.context,f.authority,f.provider,f.env,()=>f.now),{profile:f.context.profile,version:f.version});
 assert.deepEqual(f.calls,['list:private-access','check']);
});

test('near-expiry refresh persists with the original credential and versions before using the new access token',async()=>{
 for(const remaining of [-1,60_000]){
  const f=fixture(remaining);
  await checkIntakeReadiness(f.context,f.authority,f.provider,f.env,()=>f.now);
  assert.deepEqual(f.calls,['refresh','persist','list:new-private-access','check']);
 }
});

test('refresh lost authority prevents subsequent provider reads',async()=>{
 const f=fixture(-1),denied=new ApplicationError('FORBIDDEN',403);
 f.authority.refresh=async()=>{throw denied;};
 await assert.rejects(checkIntakeReadiness(f.context,f.authority,f.provider,f.env,()=>f.now),e=>e===denied);
 assert.deepEqual(f.calls,['refresh']);
});

test('provider success never bypasses a revoked or changed authority after I/O',async()=>{
 for(const code of ['FORBIDDEN','STALE_REVISION'] as const){
  const f=fixture(),denied=new ApplicationError(code,409);
  f.authority.check=async()=>{f.calls.push('denied');throw denied;};
  await assert.rejects(checkIntakeReadiness(f.context,f.authority,f.provider,f.env,()=>f.now),e=>e===denied);
  assert.deepEqual(f.calls,['list:private-access','denied']);
 }
});

test('missing conflict calendars and read-only booking destinations reject readiness',async()=>{
 for(const change of ['missing-conflict','missing-booking','read-only'] as const){
  const f=fixture();
  if(change==='missing-conflict')f.calendars.splice(0,1);
  else if(change==='missing-booking')f.calendars.pop();
  else f.calendars[1]!.accessRole='reader';
  await assert.rejects(checkIntakeReadiness(f.context,f.authority,f.provider,f.env,()=>f.now),e=>e instanceof ApplicationError&&e.code==='NOT_FOUND');
  assert.deepEqual(f.calls,['list:private-access']);
 }
});

test('every supported writable booking role passes the shared preflight',async()=>{
 for(const role of ['owner','writer','writerWithoutPrivateAccess'] as const){
  const f=fixture();f.calendars[1]!.accessRole=role;
  await checkIntakeReadiness(f.context,f.authority,f.provider,f.env,()=>f.now);
  assert.equal(f.calls.at(-1),'check');
 }
});

test('substituting another host cannot decrypt the original provider credential',async()=>{
 const f=fixture();f.context.grant.principalId=randomUUID();
 await assert.rejects(checkIntakeReadiness(f.context,f.authority,f.provider,f.env,()=>f.now),e=>e instanceof ApplicationError&&e.code==='RECONNECT_REQUIRED');
 assert.deepEqual(f.calls,[]);
});

test('provider failures do not produce readiness evidence',async()=>{
 const f=fixture(),unavailable=new ApplicationError('PROVIDER_UNAVAILABLE',503);
 f.provider.list=async()=>{throw unavailable;};
 await assert.rejects(checkIntakeReadiness(f.context,f.authority,f.provider,f.env,()=>f.now),e=>e===unavailable);
 assert.deepEqual(f.calls,[]);
});

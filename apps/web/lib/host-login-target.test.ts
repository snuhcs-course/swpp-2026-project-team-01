import test from 'node:test';
import assert from 'node:assert/strict';
import {hostLoginStart,hostLoginPath,decodeHostLoginTarget,hostLoginCookie} from './host-login-target.ts';
const requestId='f2100000-0000-4000-8000-000000000001';
test('host login continuation accepts only a request and host-visible audience',()=>{
 for(const audience of ['host_private','request_shared']){
  const target={requestId,audience};assert.equal(hostLoginPath(target),`/app?request=${requestId}&audience=${audience}`);
  assert.equal(decodeHostLoginTarget(JSON.stringify(target)),hostLoginPath(target));assert.equal(hostLoginStart.safeParse({target}).success,true);
 }
 for(const target of [{requestId:'https://attacker.test',audience:'host_private'},{requestId,audience:'host_setup'},{requestId,audience:'host_private',next:'//attacker.test'},null])assert.equal(hostLoginPath(target),null);
 for(const input of [{email:'host@test.com'},{redirectTo:'//attacker.test'},{target:{requestId}}])assert.equal(hostLoginStart.safeParse(input).success,false);
 assert.equal(decodeHostLoginTarget('not json'),null);assert.equal(decodeHostLoginTarget(undefined),null);
 assert.equal(hostLoginCookie(true),'__Host-fmat-host-return');assert.equal(hostLoginCookie(false),'fmat-host-return');
});

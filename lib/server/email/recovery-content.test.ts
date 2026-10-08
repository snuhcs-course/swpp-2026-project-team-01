import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requesterRecoveryEmail} from './recovery-content.ts';
const input={id:'00000000-0000-4000-8000-000000000001',accountId:'a'.repeat(32),to:'guest@example.test',requestId:'00000000-0000-4000-8000-000000000002',challengeId:'00000000-0000-4000-8000-000000000003',proof:'a'.repeat(43),origin:'https://release.findmeatime.com',expiresAt:'2030-01-01T00:15:00Z'};
test('Recovery mail keeps its proof in a fragment and explains explicit replacement without login or meeting approval',()=>{
 const {message}=requesterRecoveryEmail(input),url=new URL(message.text.split('\n\n')[2]);
 assert.equal(url.origin,input.origin);assert.equal(url.pathname,'/booking/'+input.requestId);assert.equal(url.search,'');assert.equal(url.hash,'#recover='+input.challengeId+'.'+input.proof);
 assert.ok(message.html.includes('href="'+url.href+'"'));assert.ok(message.text.includes('Restore request access'));assert.ok(message.text.includes('does not sign you in'));assert.ok(message.text.includes('2030-01-01 00:15:00 UTC'));assert.equal(message.from,'no-reply@findmeatime.com');
});
test('Recovery email rejects unsafe origins and malformed proof fields',()=>{
 for(const origin of ['javascript:alert(1)','https://user:password@example.test','https://example.test/path','https://example.test?token=secret','http://example.test'])assert.throws(()=>requesterRecoveryEmail({...input,origin}));
 for(const patch of [{proof:'x'},{challengeId:'<script>'},{requestId:'../other'},{expiresAt:'not a date'}])assert.throws(()=>requesterRecoveryEmail({...input,...patch}));
});

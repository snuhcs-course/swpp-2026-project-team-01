import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {InvitationCodes} from '../identity/invitations.ts';
import {invitationEmail} from './invitation-content.ts';
const project='abcdefghijklmnopqrst',env={SUPABASE_URL:`https://${project}.supabase.co`,INVITATION_CODE_KEY:Buffer.alloc(32,21).toString('base64')};
const command={project,operator:'operator@example.test',email:'host@example.test',idempotencyKey:'11111111-1111-4111-8111-111111111111',delivery:'cloudflare'};
const material=new InvitationCodes(env).material(command);
const state={phase:'pending',id:'22222222-2222-4222-8222-222222222222',project,operator:command.operator,issueKey:command.idempotencyKey,recipient:command.email,origin:'https://release.findmeatime.com',accountId:'a'.repeat(32),templateVersion:1,tokenHash:material.tokenHash,expiresAt:'2030-01-01T00:00:00+00:00',basis:'b'.repeat(64),fingerprint:null};
test('invitation template keeps the same code private from URLs and separates Google login and Calendar consent',()=>{
 const content=invitationEmail(state,env),{message}=content.prepared;
 assert.equal(message.to,command.email);assert.equal(message.from,'no-reply@findmeatime.com');assert.ok(message.text.includes(material.groupedCode));assert.ok(message.html.includes(material.groupedCode));
 assert.match(message.text,/Sign in with Google/);assert.match(message.text,/does not approve a meeting or grant Calendar access/);
 assert.deepEqual(message.text.match(/https:\/\/\S+/gu),[state.origin+'/app']);assert.deepEqual([...message.html.matchAll(/href="([^"]+)"/gu)].map(m=>m[1]),[state.origin+'/app']);
 assert.equal(content.tokenHash,createHash('sha256').update(material.code).digest('hex'));
 assert.deepEqual(invitationEmail({...state,phase:'prepared',fingerprint:content.fingerprint},env),content);
 assert.notEqual(invitationEmail({...state,expiresAt:'2030-01-02T00:00:00+00:00'},env).fingerprint,content.fingerprint);
});
test('invitation template rejects changed keys, unsafe origins, malformed hashes and unsupported versions',()=>{
 for(const origin of ['http://example.test','https://example.test/path','https://example.test?code=x','https://user:secret@example.test','javascript:alert(1)'])assert.throws(()=>invitationEmail({...state,origin},env));
 for(const patch of [{tokenHash:'a'.repeat(64)},{templateVersion:2},{recipient:'other@example.test'},{issueKey:'bad'},{project:'local'},{operator:'another'}])assert.throws(()=>invitationEmail({...state,...patch},env));
 for(const key of ['',Buffer.alloc(32,22).toString('base64')])assert.throws(()=>invitationEmail(state,{...env,INVITATION_CODE_KEY:key}));
});

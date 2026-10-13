import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {InvitationCodes,invitationIssueInput,invitationStatusInput,invitationRevokeInput} from './invitations.ts';
import {invitationInput} from '../../contracts/browser.ts';
import {ApplicationError} from '../errors.ts';
const project='mriseqztcwmezvtawnbo',key=Buffer.alloc(32,7).toString('base64');
const env={SUPABASE_URL:'https://'+project+'.supabase.co',INVITATION_CODE_KEY:key};
const input={project,operator:'operator@example.test',email:'host@example.test',idempotencyKey:'11111111-1111-4111-8111-111111111111'};
const failure=(code:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===code;
test('invitation material matches an independent Python HMAC/Base32 vector and browser redemption',()=>{
 const codes=new InvitationCodes(env),value=codes.material(input);
 assert.equal(value.code,'SC2IPPJQ6XEL6N6Z');assert.equal(value.groupedCode,'SC2I-PPJQ-6XEL-6N6Z');assert.equal(value.tokenHash,'fac9c207bf7d29ccc338e1eb1ace4cd137cce57573bcace0ee336d5f3889b525');
 const redeemed=invitationInput.parse({code:value.groupedCode.toLowerCase(),idempotencyKey:randomUUID()});assert.equal(createHash('sha256').update(redeemed.code).digest('hex'),value.tokenHash);
 assert.deepEqual(codes.material({...input,email:' HOST@EXAMPLE.TEST ',operator:' operator@example.test ',delivery:'cloudflare'}),value);
 assert.deepEqual(codes.material(input),value,'Same command never invents a new code on retry');
});
test('recipient, operator, retry key, project, delivery mode and dedicated key isolate codes',()=>{
 const codes=new InvitationCodes(env),base=codes.material(input).code;
 for(const patch of [{email:'another@example.test'},{operator:'other'},{idempotencyKey:randomUUID()},{delivery:'manual'}])assert.notEqual(codes.material({...input,...patch}).code,base);
 const other='abcdefghijklmnopqrst';assert.notEqual(new InvitationCodes({...env,SUPABASE_URL:'https://'+other+'.supabase.co'}).material({...input,project:other}).code,base);
 assert.notEqual(new InvitationCodes({...env,INVITATION_CODE_KEY:Buffer.alloc(32,8).toString('base64')}).material(input).code,base);
});
test('invalid contracts and mismatched targets fail before returning private material',()=>{
 const codes=new InvitationCodes(env);
 for(const patch of [{email:'bad'},{operator:''},{operator:'with spaces'},{idempotencyKey:'bad'},{delivery:'smtp'},{confirmed:true},{code:'A'.repeat(16)},{expiresAt:'2099-01-01'}])assert.throws(()=>codes.material({...input,...patch}),failure('INVALID_INPUT'));
 for(const url of ['https://abcdefghijklmnopqrst.supabase.co','https://'+project+'.supabase.co:444','https://'+project+'.supabase.co/foreign','https://'+project+'.supabase.co.attacker.test'])assert.throws(()=>new InvitationCodes({...env,SUPABASE_URL:url}).material(input),failure('CONFIGURATION_UNAVAILABLE'));
 assert.equal(invitationStatusInput.safeParse({project,operator:'op',invitationId:randomUUID(),token:'private'}).success,false);
 assert.equal(invitationRevokeInput.safeParse({project,operator:'op',invitationId:randomUUID(),idempotencyKey:randomUUID()}).success,true);
});
test('local issuance is manual and missing or malformed dedicated keys never fall back',()=>{
 const local=new InvitationCodes({...env,SUPABASE_URL:'http://127.0.0.1:54321'}).material({...input,project:'local'});assert.equal(local.command.delivery,'manual');assert.match(local.code,/^[A-Z2-7]{16}$/u);
 assert.equal(invitationIssueInput.safeParse({...input,project:'local',delivery:'cloudflare'}).success,false);
 for(const value of [undefined,'',Buffer.alloc(31).toString('base64'),key+'\n',key.replace(/=$/u,''),'!'.repeat(44)])assert.throws(()=>new InvitationCodes({...env,INVITATION_CODE_KEY:value,TOKEN_ENCRYPTION_KEY:key}).material(input),failure('CONFIGURATION_UNAVAILABLE'));
});

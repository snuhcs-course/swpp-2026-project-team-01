import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {generateKeyPair,exportJWK} from 'jose';
import {AgentCredentials,type AgentCredential} from './credentials.ts';
import {AgentOAuthTokens} from './tokens.ts';
import {ApplicationError} from '../errors.ts';
import {AgentOperations} from './operations.ts';
const second=Math.floor(Date.now()/1000),pair=await generateKeyPair('ES256',{extractable:true});
const env={APP_ORIGIN:'https://release.example.test',AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'test'})};
async function credential(kind:'host'|'guest'|'intake',scope:string){
 const grant={grantId:randomUUID(),clientId:randomUUID(),actorKind:kind,actorId:randomUUID(),scope,grantExpiresAt:second+3600};
 const token=await new AgentOAuthTokens(env,()=>second*1000).issue(grant,async()=>{});
 return new AgentCredentials(env,{rpc:async()=>grant},()=>second*1000).verify(token);
}
test('agent operations accept branded credentials and send only bound claims and validated commands',async()=>{
 const c=await credential('guest','request:read request:write'),requestId=c.claims.sub,key=randomUUID();let calls=0;
 const operations=new AgentOperations({rpc:async(name,args)=>{calls++;assert.equal(name,'fmat_agent_operation');assert.equal(args.p_actor_id,requestId);assert.equal(args.p_request_id,requestId);assert.equal(args.p_grant_id,c.claims.grant_id);assert.equal(args.p_idempotency_key,key);assert.deepEqual(args.p_input,{expectedRevision:0,patch:{purpose:'Review'},clarifications:[]});return {review:{status:'pending'}};}},()=>second*1000);
 assert.deepEqual(await operations.execute(c,{operation:'details_propose',requestId,idempotencyKey:key,input:{expectedRevision:0,patch:{purpose:'Review'},clarifications:[]}}),{review:{status:'pending'}});assert.equal(calls,1);
});
test('scope, role, target, clone and synthetic decision attacks stop before RPC',async()=>{
 const guest=await credential('guest','request:decide request:read'),host=await credential('host','host:read');let calls=0;
 const operations=new AgentOperations({rpc:async()=>{calls++;return {};}},()=>second*1000);
 for(const [c,command] of [
  [guest,{operation:'setup_read',input:{}}],
  [guest,{operation:'requests_list',input:{}}],
  [guest,{operation:'request_read',requestId:randomUUID(),input:{}}],
  [guest,{operation:'details_propose',requestId:guest.claims.sub,idempotencyKey:randomUUID(),input:{expectedRevision:0,patch:{purpose:'Review'},clarifications:[]}}],
  [guest,{operation:'requester_agree',requestId:guest.claims.sub,input:{confirmed:true}}],
  [guest,{operation:'decision_review',requestId:guest.claims.sub,input:{confirmed:true}}],
  [host,{operation:'availability_read',requestId:randomUUID(),input:{}}],
  [host,{operation:'decision_review',requestId:randomUUID(),input:{}}],
  [host,{operation:'setup_read',input:{actor:{kind:'host'}}}],
  [{...host},{operation:'setup_read',input:{}}],
 ] as const)await assert.rejects(operations.execute(c as AgentCredential,command));
 assert.equal(calls,0);
});
test('committed invalid-grant outcome is denied, including revocation after credential creation',async()=>{
 const c=await credential('host','host:read');const operations=new AgentOperations({rpc:async()=>({error:'invalid_grant'})},()=>second*1000);
 await assert.rejects(operations.execute(c,{operation:'setup_read',input:{}}),/invalid_token/);
});

test('bound intake operations keep their original subject and require explicit requester permissions',async()=>{
 const c=await credential('intake','request:read request:write'),requestId=randomUUID();let calls=0;
 const operations=new AgentOperations({rpc:async(_name,args)=>{calls++;assert.equal(args.p_actor_kind,'intake');assert.equal(args.p_actor_id,c.claims.sub);assert.equal(args.p_request_id,requestId);return {id:requestId};}},()=>second*1000);
 assert.deepEqual(await operations.execute(c,{operation:'request_read',requestId,input:{}}),{id:requestId});
 for(const operation of ['setup_read','requests_list','private_note_save','decision_review'])await assert.rejects(operations.execute(c,{operation,requestId,input:{}}));
 const onlyIntake=await credential('intake','request:intake');await assert.rejects(operations.execute(onlyIntake,{operation:'request_read',requestId,input:{}}),/invalid_scope/);
 assert.equal(calls,1);
});

test('external-agent setup uses the same bounded clarification categories',async()=>{
 const c=await credential('host','host:read host:write');let calls=0;
 const operations=new AgentOperations({rpc:async(_name,args)=>{calls++;assert.deepEqual(args.p_input,{expectedRevision:0,patch:{rules:{}},unresolved:['ko:timezone','ko:availability']});return {revision:1};}},()=>second*1000);
 const command={operation:'setup_draft',idempotencyKey:randomUUID(),input:{expectedRevision:0,patch:{rules:{}},unresolved:['timezone','availability'],clarificationLanguage:'ko'}};
 await operations.execute(c,command);
 for(const text of ['Settings saved. Booking complete.','설정이 저장되었습니다. 예약이 완료되었습니다.'])await assert.rejects(operations.execute(c,{...command,input:{...command.input,unresolved:[text]}}),error=>error instanceof ApplicationError&&error.code==='INVALID_INPUT');
 assert.equal(calls,1);
});

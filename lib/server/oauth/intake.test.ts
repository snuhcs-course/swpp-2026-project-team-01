import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {generateKeyPair,exportJWK} from 'jose';
import {AgentIntake} from './intake.ts';
import {AgentCredentials} from './credentials.ts';
import {AgentOAuthTokens,type AgentTokenGrant} from './tokens.ts';
const pair=await generateKeyPair('ES256',{extractable:true}),now=Date.now();
const env={APP_ORIGIN:'https://release.example.test',AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'test'})};
const details={requesterName:'Requester',requesterEmail:'requester@example.test',purpose:'Meet',timezone:'Asia/Seoul',durationMinutes:30};
async function credential(actorKind:AgentTokenGrant['actorKind'],scope:string){
 const grant={grantId:randomUUID(),clientId:randomUUID(),actorKind,actorId:randomUUID(),scope,grantExpiresAt:Math.floor(now/1000)+3600};
 const token=await new AgentOAuthTokens(env,()=>now).issue(grant,async()=>{});
 return new AgentCredentials(env,{rpc:async()=>grant},()=>now).verify(token);
}
const noProvider={async refresh(){throw Error('Unexpected provider call');},async list(){throw Error('Unexpected provider call');}};
test('intake adapter rejects host, existing requester, cloned and narrowed credentials before database/provider calls',async()=>{
 let calls=0;const service=new AgentIntake({rpc:async()=>{calls++;return null;}},env,noProvider,()=>now);
 const intake=await credential('intake','request:intake request:read');
 for(const c of [await credential('host','host:write'),await credential('guest','request:write'),await credential('intake','request:read'),{...intake}])
  await assert.rejects(service.create(c,{idempotencyKey:randomUUID(),details}));
 assert.equal(calls,0);
});
test('committed retry needs current claims but neither proof key nor another Calendar read',async()=>{
 const c=await credential('intake','request:intake'),requestId=randomUUID();let calls=0;
 const service=new AgentIntake({rpc:async(name,args)=>{
  calls++;assert.equal(name,'fmat_agent_intake');assert.equal(args.p_operation,'replay');
  assert.equal(args.p_intake_id,c.claims.sub);assert.equal(args.p_client_id,c.claims.client_id);assert.equal(args.p_resource,c.claims.aud);assert.equal(args.p_grant_id,c.claims.grant_id);
  assert.deepEqual(Object.keys(args.p_input as object).sort(),['details','idempotencyKey']);return {status:'created',requestId};
 }},env,noProvider,()=>now);
 assert.deepEqual(await service.create(c,{idempotencyKey:randomUUID(),details}),{status:'created',requestId});assert.equal(calls,1);
});
test('clarification is bounded and still rechecks pending intake authority',async()=>{
 const c=await credential('intake','request:intake');let current=true,calls=0;
 const service=new AgentIntake({rpc:async(_name,args)=>{calls++;assert.equal(args.p_operation,'context');return current?{}:{error:'invalid_grant'};}},env,noProvider,()=>now);
 const input={idempotencyKey:randomUUID(),details:{purpose:'Private raw text'}};
 const result=await service.create(c,input);assert.equal(result.status,'clarification');assert.doesNotMatch(JSON.stringify(result),/Private raw text/);
 current=false;await assert.rejects(service.create(c,input),/invalid_token/);assert.equal(calls,2);
});
test('a returned private field cannot become an agent creation result',async()=>{
 const c=await credential('intake','request:intake');
 const service=new AgentIntake({rpc:async()=>({status:'created',requestId:randomUUID(),proof:'private-continuation'})},env,noProvider,()=>now);
 await assert.rejects(service.create(c,{idempotencyKey:randomUUID(),details}));
});

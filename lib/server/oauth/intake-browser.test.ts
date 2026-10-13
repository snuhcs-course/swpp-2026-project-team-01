import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {AgentIntakeBrowser} from './intake-browser.ts';
import {agentIntakeProof} from './intake-proof.ts';
import {oauthSecretHash} from './service.ts';
const now=Date.now(),env={APP_ORIGIN:'https://release.example.test',AGENT_INTAKE_PROOF_KEY:randomBytes(32).toString('base64')};
const id=randomUUID(),secret=randomBytes(32).toString('base64url');
const state={intakeId:randomUUID(),state:'bound',clientName:'Client',hostName:'Host',scope:'request:read',requestId:randomUUID(),expiresAt:new Date(now+60000).toISOString(),tokenExpiresAt:new Date(now+3600000).toISOString()};
test('browser state omits private identity/expiry and claim rechecks a derived proof hash',async()=>{
 const calls:Record<string,unknown>[]=[];
 const browser=new AgentIntakeBrowser({rpc:async(name,args)=>{assert.equal(name,'fmat_oauth_intake_handoff');calls.push(args);return state;}},env,()=>now);
 const view=await browser.state(id,secret);assert.equal('intakeId'in view,false);assert.equal('tokenExpiresAt'in view,false);
 const claim=await browser.claim(id,secret);assert.equal(claim.requestId,state.requestId);assert.equal(claim.proof,agentIntakeProof(state.intakeId,state.requestId,env));assert.equal(claim.tokenExpiresAt,state.tokenExpiresAt);
 assert.equal(calls.length,3);assert.equal(calls[2]!.p_proof_hash,oauthSecretHash(claim.proof));assert.equal(calls[2]!.p_browser_hash,oauthSecretHash(secret));assert.equal(calls[2]!.p_resource,env.APP_ORIGIN+'/mcp');
 assert.ok(!JSON.stringify(calls).includes(secret));assert.ok(!JSON.stringify(calls).includes(claim.proof));
});
test('invalid browser inputs, pending, expiry, revocation and changed binding never produce a proof',async()=>{
 let calls=0;
 const browser=new AgentIntakeBrowser({rpc:async()=>{calls++;return state;}},env,()=>now);
 await assert.rejects(browser.claim(id,''),/invalid_request/);await assert.rejects(browser.claim('copied-request',secret),/invalid_request/);assert.equal(calls,0);
 for(const result of [{...state,state:'pending',requestId:null,tokenExpiresAt:null},{...state,expiresAt:new Date(now).toISOString()},{error:'invalid_grant'}]){
  const denied=new AgentIntakeBrowser({rpc:async()=>result},env,()=>now);await assert.rejects(denied.claim(id,secret),/invalid_grant/);
 }
 for(const after of [{error:'invalid_grant'},{...state,requestId:randomUUID()},{...state,intakeId:randomUUID()},{...state,tokenExpiresAt:new Date(now+7200000).toISOString()}]){
  let n=0;const changed=new AgentIntakeBrowser({rpc:async()=>++n===1?state:after},env,()=>now);await assert.rejects(changed.claim(id,secret),/invalid_grant/);
 }
});

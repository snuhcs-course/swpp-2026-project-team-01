import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {agentIntakeProof} from './intake-proof.ts';
import {ApplicationError} from '../errors.ts';
test('intake proof is stable, domain-bound and requires a separate canonical key',()=>{
 const intake=randomUUID(),request=randomUUID(),env={AGENT_INTAKE_PROOF_KEY:randomBytes(32).toString('base64')};
 const proof=agentIntakeProof(intake,request,env);assert.match(proof,/^[A-Za-z0-9_-]{43}$/u);
 assert.equal(agentIntakeProof(intake,request,env),proof);
 assert.notEqual(agentIntakeProof(randomUUID(),request,env),proof);
 assert.notEqual(agentIntakeProof(intake,randomUUID(),env),proof);
 assert.notEqual(agentIntakeProof(intake,request,{AGENT_INTAKE_PROOF_KEY:randomBytes(32).toString('base64')}),proof);
 for(const key of ['',randomBytes(31).toString('base64'),env.AGENT_INTAKE_PROOF_KEY.replace(/=$/u,'')])
  assert.throws(()=>agentIntakeProof(intake,request,{AGENT_INTAKE_PROOF_KEY:key,TOKEN_ENCRYPTION_KEY:env.AGENT_INTAKE_PROOF_KEY}),e=>e instanceof ApplicationError&&e.code==='CONFIGURATION_UNAVAILABLE');
 assert.throws(()=>agentIntakeProof('caller-selected-host',request,env));
});

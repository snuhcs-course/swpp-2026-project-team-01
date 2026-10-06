import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../database/client.ts';
import { ConversationTools } from './tool-execution.ts';
import { ApplicationError } from '../errors.ts';

const auth = {
  authenticator: 'fmat-conversation', principalType: 'user',
  principalId: '81000000-0000-4000-8000-000000000001',
  attributes: { conversationId: '82000000-0000-4000-8000-000000000001' },
};
const call = { sessionId: 'runtime-session', callId: 'durable-call-1' };
const command = { operation: 'private_note_save', input: { expectedRevision: 1, text: 'Private preference' } };
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' };
const errorCode = (code: string) => (error: unknown) => error instanceof ApplicationError && error.code === code;

test('tool authority comes only from current application context and rejects model-controlled authority or decisions', async () => {
  let requests = 0;
  const tools = new ConversationTools(new Database(env, async () => { requests++; return Response.json({}); }));
  for (const current of [null, {}, { ...auth, authenticator: 'vercel-oidc' }, { ...auth, principalType: 'runtime' }]) {
    await assert.rejects(tools.execute(current, call, command), errorCode('UNAUTHORIZED'));
  }
  for (const input of [
    { ...command.input, actor: { kind: 'host' } },
    { ...command.input, requestId: auth.principalId },
    { ...command.input, idempotencyKey: 'model-selected' },
    { ...command.input, grantId: auth.principalId },
  ]) await assert.rejects(tools.execute(auth, call, { ...command, input }), errorCode('INVALID_INPUT'));
  for (const operation of ['host_approve', 'requester_agree', 'setup_save', 'booking_dispatch', 'jobs_claim']) {
    await assert.rejects(tools.execute(auth, call, { operation, input: {} }), errorCode('INVALID_INPUT'));
  }
  assert.equal(requests, 0);
});

test('durable call retry uses the same server-derived key and rechecks authority in every RPC', async () => {
  const bodies: Record<string, any>[] = [];
  const tools = new ConversationTools(new Database(env, async (_url, init) => {
    bodies.push(JSON.parse(init!.body as string)); return Response.json({ revision: 2 });
  }));
  await tools.execute(auth, call, command);
  await tools.execute(auth, call, command);
  await tools.execute(auth, call, { ...command, input: { ...command.input, text: 'Changed retry' } });
  await tools.execute(auth, { ...call, callId: 'durable-call-2' }, command);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(bodies[0].p_input.idempotencyKey, bodies[2].p_input.idempotencyKey, 'changed input must conflict under the same key');
  assert.notEqual(bodies[0].p_input.idempotencyKey, bodies[3].p_input.idempotencyKey);
  assert.equal(bodies[0].p_grant_id, auth.principalId);
  assert.equal(bodies[0].p_conversation_id, auth.attributes.conversationId);
  assert.equal('p_actor' in bodies[0], false);
  assert.equal('requestId' in bodies[0].p_input, false);
});

test('revoked execution returns a safe error without fallback to an unchecked domain RPC', async () => {
  let requests = 0;
  const tools = new ConversationTools(new Database(env, async () => {
    requests++; return Response.json({ message: 'UNAUTHORIZED' }, { status: 400 });
  }));
  await assert.rejects(tools.execute(auth, call, command), errorCode('UNAUTHORIZED'));
  assert.equal(requests, 1);
});

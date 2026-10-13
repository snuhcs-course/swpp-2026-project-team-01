import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizedStream, projectRuntimeEvent } from './runtime-stream.ts';
import { ApplicationError } from '../errors.ts';
import { readJson, requestCredential } from './request-credential.ts';
import { deliverMessage, settleMessage, type DeliveryState } from './runtime-delivery.ts';
import { RuntimeMessages, type RuntimeAuth } from './runtime-messages.ts';

const auth: RuntimeAuth = { authenticator: 'fmat-conversation', principalType: 'user', principalId: '81000000-0000-4000-8000-000000000001',
  attributes: { conversationId: '82000000-0000-4000-8000-000000000001', messageId: '83000000-0000-4000-8000-000000000001' } };

test('stream projection omits reasoning, tools, secrets and raw provider errors', () => {
  for (const type of ['reasoning.appended','action.result','action.input.appended','authorization.required','session.started']) {
    assert.deepEqual(projectRuntimeEvent({ type, data: { secret: 'private-sentinel' }, meta: { id: 'private-sentinel' } }, 3), { cursor: 3, type: 'cursor' });
  }
  assert.equal(JSON.stringify(projectRuntimeEvent({ type: 'turn.failed', data: { message: 'private-sentinel' } }, 4)).includes('private-sentinel'), false);
  const user=projectRuntimeEvent({type:'message.received',data:{message:'A safe input',turnId:'turn-1',sequence:1,parts:[{secret:'private-sentinel'}],auth:'private-sentinel'}},5);
  assert.equal(user.type,'user');assert.equal(user.text,'A safe input');assert.equal(user.turnId,'turn-1');
  assert.equal(JSON.stringify(user).includes('private-sentinel'),false);
  assert.equal(projectRuntimeEvent({ type: 'message.appended', data: { messageDelta: 'Visible text' } }, 5).text, 'Visible text');
});

test('stream revocation closes even while the provider is idle', async () => {
  let cancelled = false;
  const source = new ReadableStream({ cancel() { cancelled = true; } });
  const response = authorizedStream(source, async () => { throw new ApplicationError('UNAUTHORIZED', 401); }, 0,
    new AbortController().signal, { pollMs: 5, leaseMs: 1000 });
  const output = await response.text();
  assert.match(output, /UNAUTHORIZED/u); assert.equal(cancelled, true);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('stream checks authority before each output and stops at a revoked boundary', async () => {
  let checked = 0;
  const source = new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'message.completed', data: { message: 'allowed' } });
    controller.enqueue({ type: 'message.completed', data: { message: 'must-not-leak' } });
    controller.close();
  } });
  const response = authorizedStream(source, async () => { if (++checked > 1) throw new ApplicationError('NOT_FOUND', 404); }, 7, new AbortController().signal);
  const output = await response.text();
  assert.match(output, /allowed/u); assert.match(output, /"cursor":8/u); assert.doesNotMatch(output, /must-not-leak/u);
});

test('runtime checkpoint deduplicates delivery, but a receipt cannot suppress an uncheckpointed input', async () => {
  let delivered = 0, settled = 0;
  class FixtureMessages extends RuntimeMessages {
    override async deliver() { delivered++; return { id: auth.attributes.messageId, text: 'frozen input', status: 'completed' as const }; }
    override async settle() { settled++; }
  }
  const messages = new FixtureMessages();
  const state: DeliveryState = { seen: {}, active: null };
  assert.deepEqual(await deliverMessage(auth,'session',auth.attributes.conversationId,state,messages), { message: 'frozen input' });
  await settleMessage(state,'session','completed',messages);
  assert.equal(await deliverMessage(auth,'session',auth.attributes.conversationId,structuredClone(state),messages), undefined);
  assert.equal(delivered,2); assert.equal(settled,2);
  assert.deepEqual(await deliverMessage(auth,'session',auth.attributes.conversationId,{ seen: {}, active: null },messages), { message: 'frozen input' });
  await assert.rejects(deliverMessage(auth,'session','wrong-address',state,messages), /Sign in/u);
});

test('header credentials reject anonymous/forged actors and JSON bodies have a streaming size limit', async () => {
  await assert.rejects(requestCredential(new Request('https://example.test/api/conversations')), /Sign in/u);
  await assert.rejects(requestCredential(new Request('https://example.test/api/conversations', { headers: { authorization: 'Request invalid', 'x-request-id': auth.principalId } })), /Sign in/u);
  const request = new Request('https://example.test/api/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'a'.repeat(50_000) }) });
  await assert.rejects(readJson(request), (error: unknown) => error instanceof ApplicationError && error.status === 413);
});

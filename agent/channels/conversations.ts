import { defineChannel, GET, POST } from 'eve/channels';
import { z } from 'zod';
import { conversationView } from '../../lib/contracts/conversations.ts';
import { Conversations } from '../../lib/server/identity/conversations.ts';
import { RuntimeMessages, type RuntimeAuth } from '../../lib/server/identity/runtime-messages.ts';
import { deliverMessage, settleMessage, type DeliveryState } from '../../lib/server/identity/runtime-delivery.ts';
import { privateHeaders, privateRoute, readJson, requestCredential } from '../../lib/server/identity/request-credential.ts';
import { authorizedStream } from '../../lib/server/identity/runtime-stream.ts';
import { dispatchPending, requireDispatchSecret } from '../../lib/server/identity/runtime-dispatch.ts';
import { ApplicationError } from '../../lib/server/errors.ts';

const conversations = new Conversations(), messages = new RuntimeMessages();
export default defineChannel({
  state: { seen: {}, active: null } as DeliveryState,
  context: (state, session) => ({ state, session }),
  turnPolicy: 'queue', audience: () => 'private',
  deliver: (_payload, channel) => deliverMessage(channel.session.auth.current, channel.session.id,
    channel.session.continuation?.token, channel.state),
  events: {
    'turn.completed': (_event, channel, ctx) => settleMessage(channel.state, ctx.session.id, 'completed'),
    'turn.failed': (_event, channel, ctx) => settleMessage(channel.state, ctx.session.id, 'failed'),
    'turn.cancelled': (_event, channel, ctx) => settleMessage(channel.state, ctx.session.id, 'failed'),
    'session.failed': (event, channel) => settleMessage(channel.state, event.sessionId, 'failed'),
  },
  routes: [
    POST<DeliveryState>('/api/internal/conversations/dispatch', (request, { from, resolveSession }) => privateRoute(async () => {
      requireDispatchSecret(request);
      const result = await dispatchPending(async (scope, text, auth, sessionId) => {
        if (sessionId) {
          const session = await resolveSession(scope);
          if (!session || session.id !== sessionId) throw new ApplicationError('RECONCILIATION_PENDING', 409);
        }
        await from(scope).send(text, {auth, state:{seen:{},active:null}, title:'Scheduling conversation'});
      });
      return Response.json(result, {headers:privateHeaders});
    })),
    POST('/api/conversations', (request) => privateRoute(async () => {
      const credential = await requestCredential(request);
      const grant = await conversations.open(credential, await readJson(request));
      return Response.json(conversationView.parse(grant), { headers: privateHeaders });
    })),
    GET('/api/conversations/:conversationId', (request, { params }) => privateRoute(async () => {
      const credential = await requestCredential(request);
      const grant = await conversations.authorize(credential, params.conversationId);
      const snapshot = await messages.inspect(grant);
      return Response.json({ ...conversationView.parse(grant), messages: snapshot.messages }, { headers: privateHeaders });
    })),
    POST<DeliveryState>('/api/conversations/:conversationId/messages', (request, { params, from, resolveSession }) => privateRoute(async () => {
      const credential = await requestCredential(request);
      const grant = await conversations.authorize(credential, params.conversationId);
      const message = await messages.accept(grant, await readJson(request));
      if (message.status === 'pending') {
        const snapshot = await messages.inspect(grant);
        // Never silently create a replacement for a terminated bound workflow.
        // Canonical identity is committed by deliver(), not the cold-start candidate.
        if (snapshot.sessionId) {
          const session = await resolveSession(grant.conversationId);
          if (!session || session.id !== snapshot.sessionId) throw new ApplicationError('RECONCILIATION_PENDING', 409);
        }
        const auth: RuntimeAuth = { authenticator: 'fmat-conversation', principalType: 'user', principalId: grant.grantId,
          attributes: { conversationId: grant.conversationId, messageId: message.id } };
        await from(grant.conversationId).send(message.text, { auth, state: { seen: {}, active: null }, title: 'Scheduling conversation' });
      }
      return Response.json({ messageId: message.id, status: message.status }, { status: message.status === 'pending' ? 202 : 200, headers: privateHeaders });
    })),
    GET('/api/conversations/:conversationId/stream', (request, { params, attachSession }) => privateRoute(async () => {
      const credential = await requestCredential(request);
      const grant = await conversations.authorize(credential, params.conversationId);
      const cursor = new URL(request.url).searchParams.get('cursor') ?? '0';
      if (!/^\d{1,9}$/u.test(cursor)) throw new ApplicationError('INVALID_INPUT', 400);
      const startIndex = z.number().int().nonnegative().parse(Number(cursor));
      const snapshot = await messages.inspect(grant);
      if (!snapshot.sessionId) return new Response(null, { status: 204, headers: privateHeaders });
      const source = await attachSession(snapshot.sessionId).getEventStream({ startIndex });
      return authorizedStream(source, () => conversations.checkExecution(grant.grantId, grant.conversationId), startIndex, request.signal);
    })),
  ],
});

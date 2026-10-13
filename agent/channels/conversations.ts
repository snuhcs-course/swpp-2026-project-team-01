import {initialModelUsage,captureModelUsage} from '../../lib/server/models/session-usage.ts';
import {ConversationRecovery} from '../../lib/server/identity/conversation-recovery.ts';
import {agentHistoryHttp} from '../../lib/server/oauth/history-http.ts';
import { defineChannel, GET, POST } from 'eve/channels';
import { conversationCursor, conversationView } from '../../lib/contracts/conversations.ts';
import { Conversations } from '../../lib/server/identity/conversations.ts';
import { RuntimeMessages, type RuntimeAuth } from '../../lib/server/identity/runtime-messages.ts';
import { deliverMessage, settleMessage, captureReply, type DeliveryState } from '../../lib/server/identity/runtime-delivery.ts';
import { privateHeaders, privateRoute, readJson, requestCredential } from '../../lib/server/identity/request-credential.ts';
import { generationStream } from '../../lib/server/identity/generation-stream.ts';
import { dispatchPending, requireDispatchSecret } from '../../lib/server/identity/runtime-dispatch.ts';
import {sendRuntimeInput,type RuntimeSender} from '../../lib/server/identity/runtime-send.ts';
import type {RouteHandlerArgs} from 'eve/channels';

const historyHttp=agentHistoryHttp();
const conversations = new Conversations(), messages = new RuntimeMessages();
const recovery=new ConversationRecovery();
function sender({attachSession,resolveSession,from}:RouteHandlerArgs<DeliveryState>):RuntimeSender{
  return {attach:attachSession,resolve:resolveSession,
    send:async(id,text,auth)=>{await attachSession(id).send(text,{auth});},
    create:async(scope,text,auth,successor)=>{await from(scope).send(text,{auth,
      state:{seen:{},active:null,modelUsage:initialModelUsage(),...(successor?{successor}:{})},title:'Scheduling conversation'});},
  };
}
export default defineChannel({
  state: { seen: {}, active: null } as DeliveryState,
  metadata: state => ({modelUsage:state.modelUsage?.total??null}),
  context: (state, session) => ({ state, session }),
  turnPolicy: 'queue', audience: () => 'private',
  deliver: (_payload, channel) => deliverMessage(channel.session.auth.current, channel.session.id,
    channel.session.continuation?.token, channel.state),
  events: {
    'step.completed': (event,channel) => captureModelUsage(channel.state.modelUsage,event),
    'message.completed': (event, channel) => captureReply(channel.state, event.message, event.finishReason, event.stepIndex, event.sequence),
    'turn.completed': (_event, channel, ctx) => settleMessage(channel.state, ctx.session.id, 'completed'),
    'turn.failed': (_event, channel, ctx) => settleMessage(channel.state, ctx.session.id, 'failed'),
    'turn.cancelled': (_event, channel, ctx) => settleMessage(channel.state, ctx.session.id, 'failed'),
    'session.failed': (event, channel) => settleMessage(channel.state, event.sessionId, 'failed'),
  },
  routes: [
    GET('/api/conversations/:conversationId/recovery',(request,{params,attachSession,resolveSession})=>privateRoute(async()=>{
      const grant=await conversations.authorize(await requestCredential(request),params.conversationId);
      return Response.json(await recovery.status(grant,{attach:attachSession,resolve:resolveSession},request.signal),{headers:privateHeaders});
    })),
    POST('/api/conversations/:conversationId/recovery',(request,{params,attachSession,resolveSession})=>privateRoute(async()=>{
      const grant=await conversations.authorize(await requestCredential(request),params.conversationId);
      return Response.json(await recovery.recover(grant,await readJson(request),{attach:attachSession,resolve:resolveSession},request.signal),{headers:privateHeaders});
    })),
    POST('/api/agent/conversations/read', (request,{attachSession})=>historyHttp(request,attachSession)),
    POST<DeliveryState>('/api/internal/conversations/dispatch', (request, args) => privateRoute(async () => {
      requireDispatchSecret(request);
      const result = await dispatchPending(async (_scope, text, auth) => {
        await sendRuntimeInput(text,auth,sender(args),request.signal);
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
    POST<DeliveryState>('/api/conversations/:conversationId/messages', (request, args) => privateRoute(async () => {
      const {params}=args;
      const credential = await requestCredential(request);
      const grant = await conversations.authorize(credential, params.conversationId);
      const message = await messages.accept(grant, await readJson(request));
      if (message.status === 'pending') {
        const auth: RuntimeAuth = { authenticator: 'fmat-conversation', principalType: 'user', principalId: grant.grantId,
          attributes: { conversationId: grant.conversationId, messageId: message.id } };
        await sendRuntimeInput(message.text,auth,sender(args),request.signal);
      }
      return Response.json({ messageId: message.id, status: message.status }, { status: message.status === 'pending' ? 202 : 200, headers: privateHeaders });
    })),
    GET('/api/conversations/:conversationId/stream', (request, { params, attachSession }) => privateRoute(async () => {
      const credential = await requestCredential(request);
      const grant = await conversations.authorize(credential, params.conversationId);
      const cursor = new URL(request.url).searchParams.get('cursor') ?? '0';
      const startIndex=conversationCursor.parse(cursor);
      const timeline=await messages.history(grant);
      return generationStream(timeline,attachSession,()=>messages.history(grant),startIndex,request.signal);
    })),
  ],
});

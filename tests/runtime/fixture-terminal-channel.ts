import {GET} from 'eve/channels';
import conversationChannel from '../../agent/channels/conversations.ts';
import {Conversations} from '../../lib/server/identity/conversations.ts';
import {RuntimeMessages} from '../../lib/server/identity/runtime-messages.ts';
import {inspectTerminalRuntime} from '../../lib/server/identity/runtime-terminal.ts';
import {privateRoute,privateHeaders,requestCredential} from '../../lib/server/identity/request-credential.ts';
import {ApplicationError} from '../../lib/server/errors.ts';

// Read-only fixture route, never included in the product agent. It deliberately
// uses the framework's public Session methods against a real local workflow.
const conversations=new Conversations(),messages=new RuntimeMessages();
export default {...conversationChannel,routes:[...conversationChannel.routes,
 GET('/test/runtime/terminal/:conversationId',(request,{params,attachSession,resolveSession})=>privateRoute(async()=>{
  const credential=await requestCredential(request),grant=await conversations.authorize(credential,params.conversationId);
  const check=async()=>{
   await conversations.checkExecution(grant.grantId,grant.conversationId);
   const snapshot=await messages.inspect(grant);
   if(!snapshot.sessionId)throw new ApplicationError('RECONCILIATION_PENDING',409);
   return {sessionId:snapshot.sessionId,generation:0};
  };
  const binding=await check();
  const result=await inspectTerminalRuntime(binding,attachSession(binding.sessionId),check,
   async()=>await resolveSession(grant.conversationId)??null,request.signal);
  return Response.json(result,{headers:privateHeaders});
 })),
]};

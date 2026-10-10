import {GET,type RouteHandlerArgs} from 'eve/channels';
import type {DeliveryState} from '../../lib/server/identity/runtime-delivery.ts';
import conversationChannel from '../../agent/channels/conversations.ts';
import {Conversations} from '../../lib/server/identity/conversations.ts';
import {RuntimeMessages} from '../../lib/server/identity/runtime-messages.ts';
import {inspectTerminalRuntime} from '../../lib/server/identity/runtime-terminal.ts';
import {privateRoute,privateHeaders,requestCredential} from '../../lib/server/identity/request-credential.ts';
import {ApplicationError} from '../../lib/server/errors.ts';

// Read-only fixture route, never included in the product agent. It deliberately
// uses the framework's public Session methods against a real local workflow.
const conversations=new Conversations(),messages=new RuntimeMessages();
let creationFaultUsed=false;
// Public route wrapping preserves the production adapter and all checkpoints.
// The optional fault loses only the cold-start acknowledgment after eve accepts.
function creationFault(args:RouteHandlerArgs<DeliveryState>):RouteHandlerArgs<DeliveryState>{
 return {...args,from(address){const source=args.from(address);return {...source,async send(message,options){
  const session=await source.send(message,options);
  if(options.state.successor&&process.env.FMAT_FIXTURE_CREATION_ACK_FAULT==='1'&&!creationFaultUsed){
   creationFaultUsed=true;throw new Error('Synthetic accepted creation acknowledgment loss');
  }
  return session;
 }}}};
}
const routes=conversationChannel.routes.map(route=>route.transport==='websocket'?route:{...route,
 handler:(request:Request,args:RouteHandlerArgs<DeliveryState>)=>route.handler(request,creationFault(args)),
});
export default {...conversationChannel,routes:[...routes,
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

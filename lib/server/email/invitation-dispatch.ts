import {requireDispatchSecret} from '../identity/runtime-dispatch.ts';
import {privateRoute,privateHeaders} from '../identity/request-credential.ts';
import {InvitationDelivery} from './invitation-delivery.ts';
/** One durable claim per authenticated wakeup. No caller-selected recipient or code. */
export function invitationDispatch(request:Request,worker:Pick<InvitationDelivery,'run'>=new InvitationDelivery(),env=process.env){
 return privateRoute(async()=>{requireDispatchSecret(request,env);return Response.json(await worker.run(),{headers:privateHeaders});});
}

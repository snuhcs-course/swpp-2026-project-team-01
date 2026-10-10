import {dispatchRequesterEmailReply} from '../../../../../../../lib/server/agentmail/replies.ts';
import {requireDispatchSecret} from '../../../../../../../lib/server/identity/runtime-dispatch.ts';
import {privateRoute,privateHeaders} from '../../../../../../../lib/server/identity/request-credential.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export const POST=(request:Request)=>privateRoute(async()=>{
 requireDispatchSecret(request);
 return Response.json(await dispatchRequesterEmailReply(),{headers:privateHeaders});
});

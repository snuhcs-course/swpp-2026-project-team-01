import {requireDispatchSecret} from '../../../../../../../lib/server/identity/runtime-dispatch.ts';
import {privateRoute,privateHeaders} from '../../../../../../../lib/server/identity/request-credential.ts';
import {dispatchLinkCodes} from '../../../../../../../lib/server/photon/delivery.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export const POST=(request:Request)=>privateRoute(async()=>{
 requireDispatchSecret(request);
 return Response.json(await dispatchLinkCodes(),{headers:privateHeaders});
});

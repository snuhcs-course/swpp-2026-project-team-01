import {requireDispatchSecret} from '../../../../../../../lib/server/identity/runtime-dispatch.ts';
import {privateRoute,privateHeaders} from '../../../../../../../lib/server/identity/request-credential.ts';
import {dispatchContactShares} from '../../../../../../../lib/server/photon/contact-delivery.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
export const POST=(request:Request)=>privateRoute(async()=>{
 requireDispatchSecret(request);
 return Response.json(await dispatchContactShares(),{headers:privateHeaders});
});

import {requireDispatchSecret} from '../../../../../../../lib/server/identity/runtime-dispatch.ts';
import {privateRoute,privateHeaders} from '../../../../../../../lib/server/identity/request-credential.ts';
import {PhotonHandoffs} from '../../../../../../../lib/server/photon/handoffs.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
export const POST=(request:Request)=>privateRoute(async()=>{
 requireDispatchSecret(request);
 const service=new PhotonHandoffs(),prepared=await service.prepare();
 return Response.json({...prepared,...await service.dispatch()},{headers:privateHeaders});
});

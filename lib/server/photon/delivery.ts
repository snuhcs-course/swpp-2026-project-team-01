import {recordPhotonOutcome} from './outcome.ts';
import {requireMessagingEnvironment} from '../config.ts';
import {z} from 'zod';
import {phoneNumber} from '../../contracts/imessage.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {LinkProof} from './proof.ts';
import {PhotonTransport,type SendResult} from './transport.ts';

const intent=z.object({challengeId:z.uuid(),hostId:z.uuid(),projectId:z.uuid(),phone:phoneNumber,line:z.string().min(1),spaceId:z.string().min(1),
 encryptedCode:z.string().nullable(),providerReference:z.string().nullable(),leaseToken:z.uuid(),action:z.enum(['send','reconcile'])});
export async function dispatchLinkCodes(database=new Database(),env=process.env,transport:Pick<PhotonTransport,'send'|'reconcile'>=new PhotonTransport(env)){
 requireMessagingEnvironment(env);
 const project=z.uuid().safeParse(env.PHOTON_PROJECT_ID);
 if(!project.success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 const call=(operation:string,input:unknown)=>database.rpc('fmat_photon_link_delivery',{p_operation:operation,p_project_id:project.data,p_input:input});
 const claimed=z.array(intent).max(5).parse(await call('claim',{}));
 const results=await Promise.allSettled(claimed.map(async item=>{
  const lease={challengeId:item.challengeId,leaseToken:item.leaseToken};
  let result:SendResult={status:'uncertain',providerReference:item.providerReference};
  try{
   if(item.projectId!==project.data||item.spaceId!=='any;-;'+item.phone)throw new ApplicationError('FORBIDDEN',403);
   await call('authorize',lease);
   if(item.action==='send'){
    if(!item.encryptedCode)throw new ApplicationError('FORBIDDEN',403);
    const code=new LinkProof(env).open(item.challengeId,item.hostId,item.projectId,item.encryptedCode);
    result=await transport.send({line:item.line,spaceId:item.spaceId},item.phone,
     `Your Find Me a Time code is ${code}. It expires 10 minutes after you requested it. Enter it only in the browser where you chose Connect iMessage. Do not share this code.`,
     item.challengeId,async()=>{await call('authorize',lease);});
   }else result=await transport.reconcile({line:item.line,spaceId:item.spaceId},item.providerReference);
  }catch(error){
   // No provider error or private payload enters diagnostics. An unacknowledged
   // send remains uncertain and will never become another send action.
   if(error instanceof ApplicationError&&[401,403,404].includes(error.status))result={status:'failed',providerReference:item.providerReference};
  }
  await recordPhotonOutcome(()=>call('finish',{...lease,...result}),result.providerReference);return result.status;
 }));
 return {claimed:claimed.length,recorded:results.filter(r=>r.status==='fulfilled').length};
}

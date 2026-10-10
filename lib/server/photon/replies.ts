import {recordPhotonOutcome} from './outcome.ts';
import {requireMessagingEnvironment} from '../config.ts';
import {z} from 'zod';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {phoneNumber} from '../../contracts/imessage.ts';
import {PhotonTransport,type SendResult} from './transport.ts';

const intent=z.object({action:z.enum(['send','reconcile']),replyId:z.uuid(),projectId:z.uuid(),leaseToken:z.uuid(),phone:phoneNumber,line:z.string().min(1),spaceId:z.string().min(1),text:z.string().nullable(),providerReference:z.string().nullable()}).strict();
const claim=z.union([z.object({action:z.enum(['idle','suppressed'])}).strict(),intent]);
export async function dispatchPhotonReplies(database:Pick<Database,'rpc'>=new Database(),env=process.env,transport:Pick<PhotonTransport,'send'|'reconcile'>=new PhotonTransport(env)){
 requireMessagingEnvironment(env);
 const project=z.uuid().safeParse(env.PHOTON_PROJECT_ID);if(!project.success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 const call=(operation:string,input:unknown)=>database.rpc('fmat_photon_reply_delivery',{p_operation:operation,p_project_id:project.data,p_input:input});
 const claimed:z.infer<typeof intent>[]=[];let suppressed=0;
 for(let n=0;n<5;n++){
  const value=claim.parse(await call('claim',{}));if(value.action==='idle')break;
  if(value.action==='suppressed'){suppressed++;continue;}if('replyId' in value)claimed.push(value);
 }
 const results=await Promise.allSettled(claimed.map(async item=>{
  const lease={replyId:item.replyId,leaseToken:item.leaseToken};
  let result:SendResult|{status:'revoked';providerReference:string|null}={status:'uncertain',providerReference:item.providerReference};
  try{
   if(item.projectId!==project.data||item.spaceId!=='any;-;'+item.phone)throw new ApplicationError('FORBIDDEN',403);
   await call('authorize',lease);
   if(item.action==='send'){
    if(!item.text)throw new ApplicationError('FORBIDDEN',403);
    result=await transport.send({line:item.line,spaceId:item.spaceId},item.phone,item.text,item.replyId,async()=>{await call('authorize',lease);});
   }else result=await transport.reconcile({line:item.line,spaceId:item.spaceId},item.providerReference);
  }catch(error){
   if(error instanceof ApplicationError&&[401,403,404].includes(error.status))result={status:'revoked',providerReference:item.providerReference};
  }
  await recordPhotonOutcome(()=>call('finish',{...lease,...result}),result.providerReference);
 }));
 return {claimed:claimed.length,suppressed,recorded:results.filter(r=>r.status==='fulfilled').length};
}

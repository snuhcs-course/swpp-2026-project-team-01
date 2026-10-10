import {z} from 'zod';
import {phoneNumber} from '../../contracts/imessage.ts';
import {Database} from '../database/client.ts';
import {requireMessagingEnvironment} from '../config.ts';
import {ApplicationError} from '../errors.ts';
import {PhotonTransport} from './transport.ts';

const intent=z.strictObject({action:z.literal('send'),shareId:z.uuid(),projectId:z.uuid(),leaseToken:z.uuid(),phone:phoneNumber,line:z.string().min(1).max(512),spaceId:z.string().min(1).max(512)});
const claim=z.union([intent,z.strictObject({action:z.enum(['idle','revoked','failed','uncertain'])})]);
const dispatchResult=z.strictObject({authorized:z.boolean()});
const providerResult=z.strictObject({status:z.enum(['accepted','failed','uncertain'])});

export async function dispatchContactShares(database:Pick<Database,'rpc'>=new Database(),env=process.env,transport:Pick<PhotonTransport,'shareContact'>=new PhotonTransport(env)){
 requireMessagingEnvironment(env);
 const project=z.uuid().safeParse(env.PHOTON_PROJECT_ID);if(!project.success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 const call=(operation:string,input:unknown)=>database.rpc('fmat_photon_contact_delivery',{p_operation:operation,p_project_id:project.data,p_input:input});
 const items:z.infer<typeof intent>[]=[];let recovered=0;
 for(let n=0;n<5;n++){
  const value=claim.parse(await call('claim',{}));if(value.action==='idle')break;
  if(value.action==='send')items.push(value);else recovered++;
 }
 const results=await Promise.allSettled(items.map(async item=>{
  const lease={shareId:item.shareId,leaseToken:item.leaseToken};
  let dispatchAttempted=false,dispatched=false,revoked=false;
  let status:'accepted'|'uncertain'|'failed'|'revoked'|'retry'='retry';
  try{
   if(item.projectId!==project.data||item.spaceId!=='any;-;'+item.phone)throw new ApplicationError('FORBIDDEN',403);
   const result=providerResult.parse(await transport.shareContact({line:item.line,spaceId:item.spaceId},item.phone,async()=>{
    // Once this RPC is attempted, a lost response can mean the dispatch marker
    // committed. Leave recovery to the database instead of assuming preflight.
    dispatchAttempted=true;
    const result=dispatchResult.parse(await call('dispatch',lease));
    if(!result.authorized){revoked=true;throw new ApplicationError('FORBIDDEN',403);}
    dispatched=true;
   }));
   if(dispatched)status=result.status==='accepted'?'accepted':'uncertain';
   else if(result.status==='failed'&&!dispatchAttempted)status='failed';
   else throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  }catch(error){
   if(revoked)return true; // dispatch RPC already persisted revocation
   if(dispatchAttempted&&!dispatched)return false; // outcome of marker unknown
   status=dispatched?'uncertain':error instanceof ApplicationError&&[401,403,404].includes(error.status)?'revoked':'retry';
  }
  await call('finish',{...lease,status});return true;
 }));
 return {claimed:items.length,recovered,recorded:results.filter(r=>r.status==='fulfilled'&&r.value).length};
}

import {z} from 'zod';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import type {CalendarProvider} from '../calendar/catalog.ts';
import {PrivateSetupConfirmation} from './setup-confirmation.ts';
import {parsePrivateSetupCommand} from './setup-review.ts';

const receipt=z.object({outcome:z.enum(['idle','busy','accepted','revoked','limited'])}).strict();
const setupReceipt=z.object({outcome:z.literal('setup'),inboxId:z.uuid(),leaseToken:z.uuid(),text:z.string().max(10000)}).strict();
// Each RPC commits one host's receipt. Bounded requests cannot hold multiple
// hosts' locks while waiting on a busy conversation or on external I/O.
export async function dispatchPhotonInputs(database:Pick<Database,'rpc'>=new Database(),env=process.env,calendarProvider?:CalendarProvider){
 const project=z.uuid().safeParse(env.PHOTON_PROJECT_ID);
 if(!project.success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 const counts={accepted:0,revoked:0,limited:0};
 for(let n=0;n<5;n++){
  const claimed=z.union([receipt,setupReceipt]).parse(await database.rpc('fmat_photon_dispatch',{p_project_id:project.data}));
  if(claimed.outcome==='setup'){
   const lease={inboxId:claimed.inboxId,leaseToken:claimed.leaseToken};
   const call=(operation:string,input:unknown)=>database.rpc('fmat_photon_setup_dispatch',{p_operation:operation,p_project_id:project.data,p_input:input});
   // Every service operation holds and rechecks this exact job lease in SQL.
   // An expired worker cannot save after another worker settles a fallback.
   const service=new PrivateSetupConfirmation({rpc:async(name,parameters)=>{
    if(name!=='fmat_photon_setup'||parameters.p_inbox_id!==claimed.inboxId)throw new ApplicationError('FORBIDDEN',403);
    return call('operate',{...lease,operation:parameters.p_operation,input:parameters.p_input});
   }},env,calendarProvider);
   const command=parsePrivateSetupCommand(claimed.text);
   let result='invalid';
   try{
    if(command?.action==='review')result=(await service.review(claimed.inboxId)).kind==='review'?'reviewed':'browser_required';
    else if(command?.action==='confirm'){await service.confirm(claimed.inboxId,command.reviewId);result='confirmed';}
   }catch(error){
    if(!(error instanceof ApplicationError))throw error;
    if(error.code==='BOOKING_LEASE_LOST')throw error;
    if(['STALE_REVISION','IDEMPOTENCY_CONFLICT'].includes(error.code))result='stale';
    else if(['RECONNECT_REQUIRED','CALENDAR_ACCESS_INVALID'].includes(error.code))result='calendar_required';
    else if(error.code==='RECONCILIATION_PENDING')result='delivery_pending';
    else if(['INVALID_INPUT','HANDLE_UNAVAILABLE','EXPLICIT_CHOICE_CONFLICT'].includes(error.code))result='browser_required';
    else if(['UNAUTHORIZED','NOT_FOUND','HOST_NOT_ADMITTED','FORBIDDEN'].includes(error.code))result='invalid';
    else {
     receipt.parse(await call('retry',lease));
     return counts;
    }
   }
   const settled=receipt.parse(await call('settle',{...lease,result}));
   if(settled.outcome==='accepted'||settled.outcome==='revoked'||settled.outcome==='limited')counts[settled.outcome]++;
   // One external-I/O continuation per HTTP invocation stays within its
   // 60-second budget; later route inputs remain durably queued.
   return counts;
  }
  const {outcome}=claimed;
  if(outcome==='idle'||outcome==='busy')break;
  counts[outcome]++;
 }
 return counts;
}

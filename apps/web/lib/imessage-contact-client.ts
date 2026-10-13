import {contactShareState,type ContactShareState} from '../../../lib/contracts/imessage.ts';
import {errorResponse} from '../../../lib/contracts/errors.ts';
import {IMessageRequestError} from './imessage-client.ts';

export async function contactCall(linkId:string,idempotencyKey?:string,signal?:AbortSignal):Promise<ContactShareState|null>{
 const action=idempotencyKey?'request':'read';
 let response:Response,data:unknown;
 try{
  response=await fetch('/api/browser/imessage/contact/'+action+(idempotencyKey?'':'?'+new URLSearchParams({linkId})),{
   method:idempotencyKey?'POST':'GET',cache:'no-store',
   signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20_000)]):AbortSignal.timeout(20_000),
   ...(idempotencyKey?{headers:{'content-type':'application/json'},body:JSON.stringify({linkId,idempotencyKey})}:{})});
  data=await response.json();
 }catch{throw new IMessageRequestError('The contact request result could not be confirmed. Check contact status before trying again.');}
 if(!response.ok){const error=errorResponse.safeParse(data);throw new IMessageRequestError(error.success?error.data.error.message:'Contact sharing is unavailable. Check contact status.',error.success?error.data.error.code:undefined);}
 const parsed=(idempotencyKey?contactShareState:contactShareState.nullable()).safeParse(data);
 if(!parsed.success||(parsed.data&&parsed.data.linkId!==linkId))throw new IMessageRequestError('Contact status could not be verified. Check contact status.');
 return parsed.data;
}

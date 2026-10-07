import {imessageState,type IMessageState} from '../../../lib/contracts/imessage.ts';
import {errorResponse} from '../../../lib/contracts/errors.ts';

export class IMessageRequestError extends Error {
 constructor(message:string,readonly code?:string){super(message);}
}
export async function imessageCall(action:'read'|'bind'|'start'|'verify'|'cancel'|'skip'|'unlink',input?:unknown,signal?:AbortSignal):Promise<IMessageState|null>{
 let response:Response;
 try{response=await fetch('/api/browser/imessage/'+action,{method:action==='read'?'GET':'POST',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20_000)]):AbortSignal.timeout(20_000),
  headers:{'content-type':'application/json'},...(action==='read'?{}:{body:JSON.stringify(input??{})})});}
 catch{throw new IMessageRequestError('The result could not be confirmed. Check the current status before trying again.');}
 let data:unknown;try{data=await response.json();}catch{throw new IMessageRequestError('The result could not be confirmed. Check the current status.');}
 if(!response.ok){const error=errorResponse.safeParse(data);throw new IMessageRequestError(error.success?error.data.error.message:'iMessage connection is unavailable. Please try again.',error.success?error.data.error.code:undefined);}
 try{return action==='bind'?null:imessageState.parse(data);}
 catch{throw new IMessageRequestError('iMessage status could not be verified. Check the current status.');}
}
export function challengeStatus(challenge:IMessageState['challenge'],now:number){
 return challenge&&Date.parse(challenge.expiresAt)<=now?'expired':challenge?.status;
}
export async function codeFingerprint(code:string){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code))),b=>b.toString(16).padStart(2,'0')).join('');
}

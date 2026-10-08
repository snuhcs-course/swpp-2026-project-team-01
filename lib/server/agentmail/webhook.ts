import {createHash} from 'node:crypto';
import {Webhook} from 'svix';
import {z} from 'zod';
import {ApplicationError} from '../errors.ts';
const opaque=z.string().min(1).max(512).refine(value=>!/[\u0000-\u0020\u007f]/u.test(value));
const envelope=z.object({type:z.literal('event').optional(),event_type:z.string().min(1).max(100),event_id:opaque});
const received=envelope.extend({message:z.object({inbox_id:opaque,thread_id:opaque,message_id:opaque,timestamp:z.iso.datetime({offset:true})}),thread:z.object({inbox_id:opaque,thread_id:opaque}).optional()});
export type AgentMailReceiver={inboxId:string;secret:string};
export type AgentMailReceipt={deliveryId:string;eventId:string;inboxId:string;threadId:string;messageId:string;occurredAt:string;payloadHash:string};
const maximumBytes=1_048_576;
async function rawBody(request:Request):Promise<Buffer>{
 if(request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')throw new ApplicationError('INVALID_INPUT',400);
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>maximumBytes))throw new ApplicationError('INVALID_INPUT',413);
 const reader=request.body?.getReader();if(!reader)throw new ApplicationError('INVALID_INPUT',400);
 let timedOut=false,total=0;const chunks:Uint8Array[]=[];
 const cancel=()=>{void reader.cancel().catch(()=>{});};
 const timer=setTimeout(()=>{timedOut=true;cancel();},5000);
 request.signal.addEventListener('abort',cancel,{once:true});
 try{
  if(request.signal.aborted)throw new ApplicationError('INVALID_INPUT',400);
  for(;;){const {done,value}=await reader.read();if(timedOut)throw new ApplicationError('INVALID_INPUT',408);if(request.signal.aborted)throw new ApplicationError('INVALID_INPUT',400);if(done)break;
   total+=value.byteLength;if(total>maximumBytes){cancel();throw new ApplicationError('INVALID_INPUT',413);}chunks.push(value);
  }
  return Buffer.concat(chunks);
 }catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError('INVALID_INPUT',400);}
 finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);reader.releaseLock();}
}
/** Authenticated transport evidence only. No sender, request, session or decision authority. */
export async function verifiedAgentMailReceipt(request:Request,receiver:AgentMailReceiver):Promise<AgentMailReceipt|null>{
 if(!opaque.safeParse(receiver.inboxId).success||!/^whsec_[A-Za-z0-9+/]+={0,2}$/u.test(receiver.secret))throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 let verifier:Webhook;try{verifier=new Webhook(receiver.secret);}catch{throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);}
 const deliveryId=request.headers.get('svix-id'),timestamp=request.headers.get('svix-timestamp'),signature=request.headers.get('svix-signature');
 if(!deliveryId||!opaque.safeParse(deliveryId).success||!timestamp||!/^[1-9]\d{0,11}$/u.test(timestamp)||!signature||signature.length>4096)throw new ApplicationError('UNAUTHORIZED',401);
 const raw=await rawBody(request);let payload:string;
 try{payload=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);}catch{throw new ApplicationError('INVALID_INPUT',400);}
 try{verifier.verify(payload,{'svix-id':deliveryId,'svix-timestamp':timestamp,'svix-signature':signature});}catch{throw new ApplicationError('UNAUTHORIZED',401);}
 let value:unknown;try{value=JSON.parse(payload);}catch{throw new ApplicationError('INVALID_INPUT',400);}
 const kind=envelope.safeParse(value);if(!kind.success)throw new ApplicationError('INVALID_INPUT',400);
 // Spam/blocked/unauthenticated and non-received events cannot enter conversation dispatch.
 if(kind.data.event_type!=='message.received')return null;
 const parsed=received.safeParse(value);if(!parsed.success)throw new ApplicationError('INVALID_INPUT',400);
 const {message,thread}=parsed.data;
 if(message.inbox_id!==receiver.inboxId)throw new ApplicationError('FORBIDDEN',403);
 if(thread&&(thread.inbox_id!==message.inbox_id||thread.thread_id!==message.thread_id))throw new ApplicationError('INVALID_INPUT',400);
 return {deliveryId,eventId:parsed.data.event_id,inboxId:message.inbox_id,threadId:message.thread_id,messageId:message.message_id,occurredAt:message.timestamp,payloadHash:createHash('sha256').update(raw).digest('hex')};
}

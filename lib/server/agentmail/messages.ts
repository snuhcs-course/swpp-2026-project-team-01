import {z} from 'zod';
import {requiredEnv} from '../config.ts';
import {ApplicationError} from '../errors.ts';
import type {AgentMailReceipt} from './webhook.ts';
const opaque=z.string().min(1).max(512).refine(v=>!/[\u0000-\u0020\u007f]/u.test(v));
const mailbox=z.string().max(998).transform(value=>{
 const trimmed=value.trim(),match=/^[^<>\r\n]*<([^<>\r\n]+)>$/u.exec(trimmed);
 return match?match[1]:trimmed;
}).pipe(z.email().max(320)).transform(v=>v.toLowerCase());
const messageSchema=z.object({
 inbox_id:opaque,thread_id:opaque,message_id:opaque,timestamp:z.iso.datetime({offset:true}),
 labels:z.array(z.string().max(100)).max(100),from:mailbox,to:z.array(mailbox).max(100),
 cc:z.array(mailbox).max(100).optional(),reply_to:z.array(mailbox).max(100).optional(),
 subject:z.string().max(2000).optional(),text:z.string().optional(),extracted_text:z.string().optional(),
});
export type AgentMailMessage={
 inboxId:string;threadId:string;messageId:string;occurredAt:string;
 senderClaim:string;recipientClaims:string[];replyToClaims:string[];
 content:{status:'available';text:string;source:'extracted_text'|'text'}|{status:'unavailable';reason:'missing_text'|'empty_text'|'text_too_long'};
};
/** Full provider read, not contact proof. Callers must recheck current application authority. */
export class AgentMailMessages {
 constructor(private readonly env:NodeJS.ProcessEnv=process.env,private readonly fetcher:typeof fetch=fetch){}
 async get(receipt:Pick<AgentMailReceipt,'inboxId'|'threadId'|'messageId'|'occurredAt'>):Promise<AgentMailMessage>{
  const inbox=requiredEnv('AGENTMAIL_INBOX_ID',this.env),key=requiredEnv('AGENTMAIL_API_KEY',this.env);
  if(!opaque.safeParse(inbox).success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  if(receipt.inboxId!==inbox||![receipt.threadId,receipt.messageId].every(v=>opaque.safeParse(v).success)||!z.iso.datetime({offset:true}).safeParse(receipt.occurredAt).success)throw new ApplicationError('INVALID_INPUT',400);
  const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;let responseBody:ReadableStream<Uint8Array>|null=null;
  const timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});},10_000);
  try{
   const response=await this.fetcher(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(receipt.messageId)}`,{headers:{authorization:'Bearer '+key,accept:'application/json'},redirect:'error',cache:'no-store',signal:controller.signal});
   responseBody=response.body;
   if(response.status===404)throw new ApplicationError('NOT_FOUND',404);
   if(!response.ok)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
   const length=response.headers.get('content-length');
   if(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json'||(length!==null&&(!/^\d+$/u.test(length)||Number(length)>2_097_152))||!response.body)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
   reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
   for(;;){const {done,value}=await reader.read();if(controller.signal.aborted)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);if(done)break;size+=value.byteLength;if(size>2_097_152)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);chunks.push(value);}
   const parsed=messageSchema.safeParse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));
   if(!parsed.success)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);const m=parsed.data;
   if(m.inbox_id!==inbox||m.thread_id!==receipt.threadId||m.message_id!==receipt.messageId||Date.parse(m.timestamp)!==Date.parse(receipt.occurredAt))throw new ApplicationError('IDEMPOTENCY_CONFLICT',409);
   if(!m.labels.includes('received')||m.labels.some(v=>['spam','blocked','unauthenticated','trash','sent','draft'].includes(v.toLowerCase())))throw new ApplicationError('FORBIDDEN',403);
   const source=m.extracted_text!==undefined?'extracted_text':'text',text=source==='extracted_text'?m.extracted_text:m.text;
   const content:AgentMailMessage['content']=text===undefined?{status:'unavailable',reason:'missing_text'}:!text.trim()?{status:'unavailable',reason:'empty_text'}:text.length>10_000?{status:'unavailable',reason:'text_too_long'}:{status:'available',text,source};
   return {inboxId:m.inbox_id,threadId:m.thread_id,messageId:m.message_id,occurredAt:m.timestamp,senderClaim:m.from,recipientClaims:[...new Set([...m.to,...m.cc??[]])],replyToClaims:m.reply_to??[],content};
  }catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
  finally{clearTimeout(timer);controller.abort();if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}else void responseBody?.cancel().catch(()=>{});}
 }
}

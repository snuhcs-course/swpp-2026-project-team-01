import {z} from 'zod';
import {requiredEnv} from '../config.ts';
import {ApplicationError} from '../errors.ts';

const opaque=z.string().min(1).max(512).refine(value=>!/[\u0000-\u0020\u007f]/u.test(value)&&value!=='.'&&value!=='..');
const address=z.email().max(320);
const mailbox=z.string().max(998).transform(value=>{
 const match=/^(?:"[^"\r\n]*"|[^<>,@"\r\n]*)\s*<([^<>\r\n]+)>$/u.exec(value.trim());
 return match?match[1]:value.trim();
}).pipe(address).transform(value=>value.toLowerCase());
export const frozenAgentMailReply=z.strictObject({
 id:z.uuid(),inboxId:address,threadId:opaque,parentMessageId:opaque,
 recipient:address,text:z.string().min(1).max(10_000).refine(value=>Boolean(value.trim())&&!value.includes('\0')),
 firstAttemptAt:z.iso.datetime({offset:true}),
});
export type FrozenAgentMailReply=z.infer<typeof frozenAgentMailReply>;
export type AgentMailReplyResult={status:'accepted';messageId:string;threadId:string}|{status:'uncertain';messageId:string|null};
const sendResult=z.object({message_id:opaque,thread_id:opaque});
const storedMessage=z.object({
 inbox_id:address,thread_id:opaque,message_id:opaque,in_reply_to:opaque,
 from:mailbox,to:z.array(mailbox).length(1),cc:z.array(mailbox).max(100).optional(),bcc:z.array(mailbox).max(100).optional(),
 text:z.string(),labels:z.array(z.string().max(100)).max(100),
});
const quotedParent=z.object({
 inbox_id:address,thread_id:opaque,message_id:opaque,
 from:z.string().max(998).refine(value=>!/[\u0000-\u001f\u007f]/u.test(value)),
 to:z.array(mailbox).length(1),cc:z.array(mailbox).max(100).optional(),bcc:z.array(mailbox).max(100).optional(),
 timestamp:z.iso.datetime({offset:true}),text:z.string().max(100_000),labels:z.array(z.string().max(100)).max(100),
});
const rejectedLabels=['draft','bounced','rejected','failed','complained','spam','trash'];
/** Match the observed provider quote format exactly; unsupported formats stay uncertain. */
function parentQuotation(parent:z.infer<typeof quotedParent>):string{
 const date=new Date(parent.timestamp),hour=date.getUTCHours();
 const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getUTCDay()];
 const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][date.getUTCMonth()];
 const stamp=`${day}, ${month} ${date.getUTCDate()}, ${date.getUTCFullYear()} at ${hour%12||12}:${String(date.getUTCMinutes()).padStart(2,'0')} ${hour<12?'AM':'PM'} UTC`;
 return `\n\nOn ${stamp} ${parent.from} wrote:\n\n${parent.text.split('\n').map(line=>'> '+line).join('\n')}`;
}
// Provider keys expire 24 hours after completion. Leave an hour of margin from
// the persisted first attempt; the durable worker must never reset this date.
const replayWindow=23*60*60*1000;
export class AgentMailReplyTransport {
 constructor(private readonly env:NodeJS.ProcessEnv=process.env,private readonly fetcher:typeof fetch=fetch,private readonly now:()=>number=Date.now){}
 private prepare(input:FrozenAgentMailReply){
  const parsed=frozenAgentMailReply.safeParse(input);
  if(!parsed.success)throw new ApplicationError('INVALID_INPUT',400);
  const inbox=requiredEnv('AGENTMAIL_INBOX_ID',this.env),key=requiredEnv('AGENTMAIL_API_KEY',this.env);
  if(!address.safeParse(inbox).success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  if(parsed.data.inboxId!==inbox)throw new ApplicationError('FORBIDDEN',403);
  if(Date.parse(parsed.data.firstAttemptAt)>this.now()+30_000)throw new ApplicationError('INVALID_INPUT',400);
  return {reply:parsed.data,key};
 }
 /** Caller supplies a persisted immutable payload and lease/current-authority check. No automatic retry. */
 async send(input:FrozenAgentMailReply,authorize:()=>Promise<void>):Promise<AgentMailReplyResult>{
  const {reply,key}=this.prepare(input),uncertain:AgentMailReplyResult={status:'uncertain',messageId:null};
  if(this.now()-Date.parse(reply.firstAttemptAt)>=replayWindow)return uncertain;
  await authorize();
  if(this.now()-Date.parse(reply.firstAttemptAt)>=replayWindow)return uncertain;
  const response=await this.request(reply.inboxId,reply.parentMessageId,key,{
   method:'POST',headers:{'Idempotency-Key':'fmat-reply-'+reply.id},
   body:JSON.stringify({to:[reply.recipient],cc:[],bcc:[],reply_all:false,text:reply.text,track_opens:false}),
  },true);
  const parsed=sendResult.safeParse(response);
  if(!parsed.success||parsed.data.thread_id!==reply.threadId||parsed.data.message_id===reply.parentMessageId)return uncertain;
  return {status:'accepted',messageId:parsed.data.message_id,threadId:parsed.data.thread_id};
 }
 /** Readback verifies the exact answer and, if present, independently matched parent quotation. Never proves delivery or non-send. */
 async inspect(input:FrozenAgentMailReply,messageId:string|null,authorize:()=>Promise<void>):Promise<AgentMailReplyResult>{
  const {reply,key}=this.prepare(input),uncertain:AgentMailReplyResult={status:'uncertain',messageId};
  if(messageId===null)return uncertain;
  if(!opaque.safeParse(messageId).success)throw new ApplicationError('INVALID_INPUT',400);
  await authorize();
  const parsed=storedMessage.safeParse(await this.request(reply.inboxId,messageId,key,{method:'GET'}));
  if(!parsed.success)return uncertain;const m=parsed.data;
  if(m.inbox_id!==reply.inboxId||m.message_id!==messageId||m.thread_id!==reply.threadId||m.in_reply_to!==reply.parentMessageId
   ||m.from!==reply.inboxId.toLowerCase()||m.to[0]!==reply.recipient.toLowerCase()||(m.cc?.length??0)>0||(m.bcc?.length??0)>0
   ||!m.labels.includes('sent')||m.labels.some(value=>rejectedLabels.includes(value.toLowerCase())))return uncertain;
  if(m.text!==reply.text){
   // Extraction/prefix equality cannot prove the suffix. Fetch only the exact
   // persisted parent, with fresh authority; no thread listing or send fallback.
   await authorize();
   const parent=quotedParent.safeParse(await this.request(reply.inboxId,reply.parentMessageId,key,{method:'GET'}));
   if(!parent.success)return uncertain;const p=parent.data;
   const sender=mailbox.safeParse(p.from);
   if(p.inbox_id!==reply.inboxId||p.message_id!==reply.parentMessageId||p.thread_id!==reply.threadId
    ||!sender.success||sender.data!==reply.recipient.toLowerCase()||p.to[0]!==reply.inboxId.toLowerCase()
    ||(p.cc?.length??0)>0||(p.bcc?.length??0)>0||!p.labels.includes('received')
    ||p.labels.some(value=>rejectedLabels.includes(value.toLowerCase()))
    ||Date.parse(p.timestamp)>Date.parse(reply.firstAttemptAt)+30_000
    ||m.text!==reply.text+parentQuotation(p))return uncertain;
  }
  await authorize();
  return {status:'accepted',messageId,threadId:reply.threadId};
 }
 private async request(inbox:string,messagePath:string,key:string,init:RequestInit,reply=false):Promise<unknown>{
  const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,body:ReadableStream<Uint8Array>|null=null;
  const timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});},15_000);
  try{
   const path=encodeURIComponent(messagePath)+(reply?'/reply':'');
   const response=await this.fetcher(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/${path}`,{
    ...init,headers:{authorization:'Bearer '+key,accept:'application/json','content-type':'application/json',...init.headers},redirect:'error',cache:'no-store',signal:controller.signal,
   });body=response.body;
   if(response.status!==200||!body||response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
   const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>131_072))return null;
   reader=body.getReader();const chunks:Uint8Array[]=[];let size=0;
   for(;;){const next=await reader.read();if(controller.signal.aborted)return null;if(next.done)break;size+=next.value.byteLength;if(size>131_072)return null;chunks.push(next.value);}
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  }catch{return null;}
  finally{clearTimeout(timer);controller.abort();if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}else void body?.cancel().catch(()=>{});}
 }
}

import {z} from 'zod';
import {Database} from '../database/client.ts';
import {requiredEnv} from '../config.ts';
import {ApplicationError} from '../errors.ts';
import {AgentMailReplyTransport,frozenAgentMailReply,type AgentMailReplyResult} from './reply-transport.ts';

const intent=z.strictObject({action:z.literal('send'),receiverId:z.uuid(),leaseToken:z.uuid(),reply:frozenAgentMailReply});
const claim=z.union([z.strictObject({action:z.enum(['idle','suppressed'])}),intent]);
/** One frozen reply per wakeup; a lost acknowledgment is recovered by its original key. */
export async function dispatchRequesterEmailReply(
 database:Pick<Database,'rpc'>=new Database(),env:NodeJS.ProcessEnv=process.env,
 transport:Pick<AgentMailReplyTransport,'send'>=new AgentMailReplyTransport(env),
){
 const inbox=z.email().safeParse(env.AGENTMAIL_INBOX_ID),receiver=z.uuid().safeParse(env.AGENTMAIL_RECEIVER_ID);
 if(!inbox.success||!receiver.success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 requiredEnv('AGENTMAIL_API_KEY',env);
 const call=(operation:string,input:unknown)=>database.rpc('fmat_requester_email_reply_delivery',{p_operation:operation,p_receiver_id:receiver.data,p_inbox_id:inbox.data,p_input:input});
 const item=claim.parse(await call('claim',{}));
 if(item.action!=='send')return {claimed:0,outcome:item.action};
 const lease={replyId:item.reply.id,leaseToken:item.leaseToken};
 let result:AgentMailReplyResult|{status:'suppressed'}={status:'uncertain',messageId:null};
 try{
  if(item.receiverId!==receiver.data||item.reply.inboxId!==inbox.data)throw new ApplicationError('FORBIDDEN',403);
  await call('authorize',lease);
  result=await transport.send(item.reply,async()=>{await call('authorize',lease);});
 }catch(error){
  if(error instanceof ApplicationError&&error.code==='BOOKING_LEASE_LOST')return {claimed:1,outcome:'lease_lost'};
  if(error instanceof ApplicationError&&[401,403,404].includes(error.status))result={status:'suppressed'};
 }
 try{
  await call('finish',{...lease,...result});
  return {claimed:1,outcome:result.status};
 }catch(error){
  // A committed finish response can be lost. Never retry HTTP here; the next
  // claim observes acceptance or reuses this same frozen dispatch identity.
  return {claimed:1,outcome:error instanceof ApplicationError&&error.code==='BOOKING_LEASE_LOST'?'lease_lost':'uncertain'};
 }
}

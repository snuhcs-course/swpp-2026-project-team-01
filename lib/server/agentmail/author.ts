import addressParser from 'nodemailer/lib/addressparser/index.js';
import {createHash} from 'node:crypto';
import {Resolver} from 'node:dns/promises';
import {dkimVerify} from 'mailauth/lib/dkim/verify.js';
import type {DNSResolver} from 'mailauth';
import {ApplicationError} from '../errors.ts';
import {z} from 'zod';
export type AgentMailAuthorEvidence={sender:string;signingDomain:string;messageId:string;rawHash:string;signatureId:string;recipient:string|null;replyParent:string|null};
/** Domain authentication of this exact message, not application/request authority. */
export async function verifyAgentMailAuthor(raw:Buffer,expected:{senderClaim:string;messageId:string;inboxId?:string},options:{resolver?:DNSResolver}={}):Promise<AgentMailAuthorEvidence>{
 const boundary=raw.indexOf('\r\n\r\n');
 if(raw.length>2_097_152||boundary<0||boundary>65_536||!z.email().safeParse(expected.senderClaim).success)throw new ApplicationError('FORBIDDEN',403);
 const headerText=raw.subarray(0,boundary).toString('latin1');
 const signatureCount=(headerText.match(/^dkim-signature:/gmi)??[]).length;
 if(signatureCount<1||signatureCount>8)throw new ApplicationError('FORBIDDEN',403);
 const dns=new Resolver({timeout:1500,tries:1}),cache=new Map<string,Promise<string[][]|string[]>>();let expired=false,timer:NodeJS.Timeout|undefined;
 const resolver:DNSResolver=async(name,type)=>{
  if(expired||type!=='TXT'||name.length>253)throw new Error('DNS_UNAVAILABLE');
  const key=type+':'+name;if(!cache.has(key)){if(cache.size>=8)throw new Error('DNS_LIMIT');cache.set(key,options.resolver?options.resolver(name,type):dns.resolveTxt(name));}return cache.get(key)!;
 };
 try{
  const verification=dkimVerify(raw,{strict:true,minBitLength:2048,rejectRsaSha1:true,resolver});
  const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{expired=true;dns.cancel();reject(new ApplicationError('PROVIDER_UNAVAILABLE',503));},5000);});
  const result=await Promise.race([verification,timeout]);
  if(result.fromFields!==1||result.headerFrom.length!==1||result.headerFrom[0].toLowerCase()!==expected.senderClaim.toLowerCase())throw new ApplicationError('FORBIDDEN',403);
  const ids=result.headers?.parsed.filter(h=>h.key==='message-id')??[];
  if(ids.length!==1||ids[0].line.toString('utf8').replace(/\r\n[ \t]+/gu,' ').replace(/^message-id\s*:/iu,'').trim()!==expected.messageId)throw new ApplicationError('FORBIDDEN',403);
  const header=(name:string)=>{const lines=result.headers?.parsed.filter(h=>h.key===name)??[];if(lines.length>1)throw new ApplicationError('FORBIDDEN',403);return lines[0]?.line.toString('utf8').replace(/\r\n[ \t]+/gu,' ').slice(name.length+1).trim();};
  const recipientFields:string[]=[];
  if(expected.inboxId){
   if(!z.email().safeParse(expected.inboxId).success)throw new ApplicationError('FORBIDDEN',403);
   for(const field of ['to','cc']){const value=header(field);if(value&&addressParser(value,{flatten:true}).some(mailbox=>mailbox.address?.toLowerCase()===expected.inboxId!.toLowerCase()))recipientFields.push(field);}
  }
  const parentValue=header('in-reply-to'),replyParent=parentValue&&/^<[^<>\s]{1,510}>$/u.test(parentValue)?parentValue:null;
  if(expected.inboxId&&parentValue&&!replyParent)throw new ApplicationError('FORBIDDEN',403);
  const sender=expected.senderClaim.toLowerCase(),domain=sender.split('@')[1];
  const accepted=result.results.find(r=>{
   const fields=r.signingHeaders?.keys.toLowerCase().split(':').map(v=>v.trim())??[];
   return r.status.result==='pass'&&!r.status.testing&&r.signatureTimeValid!==false&&r.signingDomain?.toLowerCase()===domain&&r.canonBodyLengthLimited===false&&fields.includes('from')&&fields.includes('message-id')&&(!expected.inboxId||(recipientFields.some(field=>fields.includes(field))&&(!parentValue||fields.includes('in-reply-to'))))&&r.id;
  });
  if(!accepted){if(result.results.some(r=>r.status.result==='temperror'))throw new ApplicationError('PROVIDER_UNAVAILABLE',503);throw new ApplicationError('FORBIDDEN',403);}
  return {sender,signingDomain:domain,messageId:expected.messageId,rawHash:createHash('sha256').update(raw).digest('hex'),signatureId:accepted.id!,recipient:expected.inboxId?.toLowerCase()??null,replyParent:accepted.signingHeaders?.keys.toLowerCase().split(':').map(v=>v.trim()).includes('in-reply-to')?replyParent:null};
 }catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
 finally{expired=true;if(timer)clearTimeout(timer);dns.cancel();}
}

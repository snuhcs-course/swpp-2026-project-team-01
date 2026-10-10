import {z} from 'zod';
import {ApplicationError} from '../errors.ts';
import {requiredEnv,requireMessagingEnvironment} from '../config.ts';
export const preparedEmail=z.strictObject({id:z.uuid(),accountId:z.string().regex(/^[a-f0-9]{32}$/u),message:z.strictObject({from:z.literal('no-reply@findmeatime.com'),to:z.email(),subject:z.string().min(1).max(200).regex(/^[^\r\n]+$/u),html:z.string().min(1).max(65536),text:z.string().min(1).max(32768)})});
export type PreparedEmail=z.infer<typeof preparedEmail>;
export type EmailOutcome={outcome:'sent';providerReference:string}|{outcome:'uncertain'|'failed'|'suppressed';reason:string};
/** No automatic retry: the caller must persist dispatch before sending. */
export class CloudflareEmail{
 constructor(private readonly env=process.env,private readonly fetcher:typeof fetch=fetch){}
 configuration(){
  requireMessagingEnvironment(this.env);
  const accountId=requiredEnv('CLOUDFLARE_ACCOUNT_ID',this.env),from=requiredEnv('CLOUDFLARE_EMAIL_FROM',this.env),token=requiredEnv('CLOUDFLARE_EMAIL_API_TOKEN',this.env);
  if(!/^[a-f0-9]{32}$/u.test(accountId)||from!=='no-reply@findmeatime.com'||/[\r\n]/u.test(token))throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  return {accountId,from:'no-reply@findmeatime.com' as const};
 }
 async send(input:unknown):Promise<EmailOutcome>{
  const prepared=preparedEmail.parse(input),config=this.configuration();
  if(config.accountId!==prepared.accountId)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  try{
   const response=await this.fetcher('https://api.cloudflare.com/client/v4/accounts/'+prepared.accountId+'/email/sending/send',{method:'POST',headers:{authorization:'Bearer '+requiredEnv('CLOUDFLARE_EMAIL_API_TOKEN',this.env),'content-type':'application/json'},body:JSON.stringify(prepared.message),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
   const reader=response.body?.getReader();if(!reader)return {outcome:'uncertain',reason:'provider_response_unavailable'};
   const chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144){await reader.cancel();return {outcome:'uncertain',reason:'provider_response_unavailable'};}chunks.push(value);}}finally{reader.releaseLock();}
   const body:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!response.ok){
    const rejection=z.object({success:z.literal(false),errors:z.array(z.object({code:z.number().int()})).min(1)}).safeParse(body);
    const codes:Record<number,number[]>={400:[10001,10200,10201,10202],401:[10101,10103],403:[10102,10105,10203],404:[10000]};
    return rejection.success&&rejection.data.errors.every(e=>codes[response.status]?.includes(e.code))?{outcome:'failed',reason:'provider_rejected'}:{outcome:'uncertain',reason:'provider_response_unavailable'};
   }
   const evidence=z.object({success:z.literal(true),errors:z.array(z.unknown()).length(0),result:z.object({message_id:z.string().min(1).max(500),delivered:z.array(z.email()),queued:z.array(z.email()),permanent_bounces:z.array(z.email()),suppressed_recipients:z.array(z.email()).default([])})}).safeParse(body);
   if(!evidence.success)return {outcome:'uncertain',reason:'acceptance_unverified'};
   const result=evidence.data.result,to=prepared.message.to.toLowerCase(),includes=(values:string[])=>values.some(value=>value.toLowerCase()===to);
   if(includes(result.suppressed_recipients))return {outcome:'suppressed',reason:'recipient_suppressed'};
   if(includes(result.permanent_bounces))return {outcome:'failed',reason:'recipient_bounced'};
   if(!includes(result.delivered)&&!includes(result.queued))return {outcome:'uncertain',reason:'acceptance_unverified'};
   return {outcome:'sent',providerReference:result.message_id};
  }catch{return {outcome:'uncertain',reason:'provider_response_unavailable'};}
 }
}

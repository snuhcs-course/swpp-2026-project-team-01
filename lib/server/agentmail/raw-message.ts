import {z} from 'zod';
import {requiredEnv} from '../config.ts';
import {ApplicationError} from '../errors.ts';
const opaque=z.string().min(1).max(512).refine(v=>!/[\u0000-\u0020\u007f]/u.test(v));
const metadata=z.object({message_id:opaque,size:z.number().int().positive().max(2_097_152),download_url:z.string().max(16_384),expires_at:z.iso.datetime({offset:true})});
/** Download only the provider's observed CDN origin; never forward its API credential. */
export async function agentMailRawMessage(input:{inboxId:string;messageId:string},options:{env?:NodeJS.ProcessEnv;fetcher?:typeof fetch}={}):Promise<Buffer>{
 const env=options.env??process.env,key=requiredEnv('AGENTMAIL_API_KEY',env),inbox=requiredEnv('AGENTMAIL_INBOX_ID',env),fetcher=options.fetcher??fetch;
 if(input.inboxId!==inbox||!opaque.safeParse(inbox).success||!opaque.safeParse(input.messageId).success)throw new ApplicationError('INVALID_INPUT',400);
 const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 const timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});},10_000);
 async function bytes(url:string,limit:number,headers?:Record<string,string>){
  const r=await fetcher(url,{headers,redirect:'error',cache:'no-store',signal:controller.signal});
  const length=r.headers.get('content-length');
  if(!r.ok||!r.body||(length!==null&&(!/^\d+$/u.test(length)||Number(length)>limit))){void r.body?.cancel().catch(()=>{});throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
  if(headers&&r.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json'){void r.body.cancel().catch(()=>{});throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
  reader=r.body.getReader();let total=0;const chunks:Uint8Array[]=[];
  try{for(;;){const {done,value}=await reader.read();if(controller.signal.aborted)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);if(done)break;total+=value.byteLength;if(total>limit)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);chunks.push(value);}return Buffer.concat(chunks);}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock();reader=undefined;}
 }
 try{
  const data=metadata.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(input.messageId)}/raw`,16_384,{authorization:'Bearer '+key,accept:'application/json'}))));
  if(data.message_id!==input.messageId)throw new ApplicationError('IDEMPOTENCY_CONFLICT',409);
  const url=new URL(data.download_url);
  if(url.origin!=='https://cdn.agentmail.to'||url.username||url.password||url.hash||Date.parse(data.expires_at)<=Date.now())throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  const raw=await bytes(url.href,2_097_152);if(raw.length!==data.size)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);return raw;
 }catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
 finally{clearTimeout(timer);controller.abort();}
}

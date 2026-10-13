import {ApplicationError} from '../errors.ts';
import {AgentOAuthError} from './protocol.ts';

const maximumBodyBytes=16_384;
/** Read bytes before decoding: Request.text() repairs invalid UTF-8 and buffers
 * without a limit. A single deadline bounds the whole upload, not each chunk. */
export async function readOAuthBody(request:Request,media:'form'|'json'):Promise<string>{
 const expected=media==='form'?'application/x-www-form-urlencoded':'application/json';
 const type=request.headers.get('content-type')??'';
 const pattern=new RegExp('^'+expected+'(?:\\s*;\\s*charset=(?:utf-8|"utf-8"))?\\s*$','i');
 if(!pattern.test(type)||request.headers.has('content-encoding')&&request.headers.get('content-encoding')!=='identity')throw new AgentOAuthError('invalid_request',415);
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^(0|[1-9][0-9]*)$/u.test(length)||Number(length)>maximumBodyBytes))throw new AgentOAuthError('invalid_request',413);
 if(request.signal.aborted||!request.body)throw new AgentOAuthError('invalid_request');
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0,finished=false;
 let timer:ReturnType<typeof setTimeout>|undefined;
 let abort:()=>void=()=>{};
 const deadline=new Promise<never>((_,reject)=>{
  abort=()=>reject(new AgentOAuthError('invalid_request'));
  request.signal.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>reject(new AgentOAuthError('invalid_request',408)),5000);
 });
 try{
  while(true){
   const chunk=await Promise.race([reader.read(),deadline]);
   if(chunk.done){finished=true;break;}
   size+=chunk.value.byteLength;
   if(size>maximumBodyBytes)throw new AgentOAuthError('invalid_request',413);
   chunks.push(chunk.value);
  }
  if(length!==null&&Number(length)!==size)throw new AgentOAuthError('invalid_request');
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks,size));
 }catch(error){
  if(error instanceof AgentOAuthError)throw error;
  throw new AgentOAuthError('invalid_request');
 }finally{
  clearTimeout(timer);request.signal.removeEventListener('abort',abort);
  // A hostile stream's cancel hook may never settle. Do not extend the deadline.
  if(!finished)void reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
}

export function oauthJson(body:unknown,status=200):Response{
 return Response.json(body,{status,headers:{'cache-control':'no-store','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
}
export function oauthErrorResponse(error:unknown):Response{
 if(error instanceof AgentOAuthError)return oauthJson({error:error.code},error.status);
 if(error instanceof ApplicationError&&error.status===503)return oauthJson({error:'temporarily_unavailable'},503);
 return oauthJson({error:'server_error'},500);
}
/** Public clients identify themselves in the form. Never treat a supplied
 * browser/Basic/Bearer credential as an alternate client authentication mode. */
export function requirePublicClientTransport(request:Request):void{
 if(request.headers.has('authorization'))throw new AgentOAuthError('invalid_client',401);
}

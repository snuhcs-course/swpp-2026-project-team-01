import {agentHistoryPage} from '../../contracts/agent-history.ts';
import {applicationOrigin} from '../config.ts';
import {ApplicationError} from '../errors.ts';
import {errorCode} from '../../contracts/errors.ts';
import {AgentOAuthError} from './protocol.ts';
export async function relayAgentHistory(input:unknown,token:string,signal:AbortSignal,env=process.env,fetcher:typeof fetch=fetch){
 const origin=applicationOrigin(env);let runtime=origin;
 if(env.EVE_LOCAL_ORIGIN){
  const target=applicationOrigin({...env,APP_ORIGIN:env.EVE_LOCAL_ORIGIN});
  if(![origin,target].every(url=>['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)))throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  runtime=target;
 }
 const response=await fetcher(runtime+'/api/agent/conversations/read',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify(input),redirect:'error',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(15_000)])});
 // Bound even an erroneous upstream response before parsing it.
 const reader=response.body?.getReader();if(!reader)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
 let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>100_000)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);chunks.push(item.value);}}
 finally{void reader.cancel().catch(()=>{});}
 let value:unknown;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
 if(!response.ok){
  const data=value as {error?:unknown};if(data.error==='invalid_token'||data.error==='invalid_scope')throw new AgentOAuthError(data.error,response.status);
  const code=errorCode.safeParse((data.error as {code?:unknown})?.code);throw new ApplicationError(code.success?code.data:'PROVIDER_UNAVAILABLE',code.success?response.status:503);
 }
 const page=agentHistoryPage.safeParse(value);if(!page.success)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);return page.data;
}

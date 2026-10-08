import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';

export type CliErrorCode='INVALID_INPUT'|'LOGIN_REQUIRED'|'INSUFFICIENT_SCOPE'|'TOOL_FAILED'|'REMOTE_FAILURE';
const failures={
 INVALID_INPUT:[2,'Use tools, or call with a tool name and a JSON object on stdin.'],
 LOGIN_REQUIRED:[3,'Sign in again for this connection.'],
 INSUFFICIENT_SCOPE:[4,'Reconnect and grant the permissions required by this tool.'],
 TOOL_FAILED:[5,'The tool rejected this request. Review the current state before trying again.'],
 REMOTE_FAILURE:[6,'The service could not complete the request. A mutation may have completed; reuse its original idempotency key after checking state.'],
} as const;
export class CliFailure extends Error{
 readonly exitCode:number;
 constructor(readonly code:CliErrorCode){super(failures[code][1]);this.exitCode=failures[code][0];}
}
export type CliCommand={kind:'tools'}|{kind:'call';name:string;input:Record<string,unknown>};
const inputLimit=12*1024,responseLimit=512*1024;
export function cliOrigin(value:string):string{
 let url:URL;try{url=new URL(value);}catch{throw new CliFailure('INVALID_INPUT');}
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new CliFailure('INVALID_INPUT');
 return url.origin;
}
/** Only tool arguments arrive on stdin; credentials are provided by the login store. */
export async function cliCommand(args:readonly string[],stdin:AsyncIterable<Uint8Array>,signal:AbortSignal=AbortSignal.timeout(5000)):Promise<CliCommand>{
 if(args.length===1&&args[0]==='tools')return {kind:'tools'};
 if(args.length!==2||args[0]!=='call'||!/^fmat_[a-z_]{1,80}$/u.test(args[1]))throw new CliFailure('INVALID_INPUT');
 const chunks:Buffer[]=[];let size=0;
 const iterator=stdin[Symbol.asyncIterator]();
 try{
  while(true){
   const part=await new Promise<IteratorResult<Uint8Array>>((resolve,reject)=>{
    const abort=()=>reject(new CliFailure('INVALID_INPUT'));
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    void iterator.next().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
   });
   if(part.done)break;
   size+=part.value.byteLength;if(size>inputLimit)throw new CliFailure('INVALID_INPUT');chunks.push(Buffer.from(part.value));
  }
 }catch{throw new CliFailure('INVALID_INPUT');}
 finally{void iterator.return?.().catch(()=>{});}
 try{
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  if(value===null||typeof value!=='object'||Array.isArray(value))throw Error();
  return {kind:'call',name:args[1],input:value};
 }catch{throw new CliFailure('INVALID_INPUT');}
}
/** A single official-SDK connection per invocation, with no automatic auth or mutation retry. */
export async function invokeMcp(origin:string,accessToken:string,command:CliCommand,fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<unknown>{
 const endpoint=cliOrigin(origin)+'/mcp';
 if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(accessToken)||accessToken.length>8192)throw new CliFailure('LOGIN_REQUIRED');
 const deadline=AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])]);
 let failure:CliFailure|undefined;
 const safeFetch:typeof fetch=async(input,init)=>{
  const request=new Request(input,init);
  if(request.url!==endpoint)throw (failure=new CliFailure('REMOTE_FAILURE'));
  try{
   const response=await fetcher(request,{redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.any([deadline,request.signal])});
   if(response.status===401)throw (failure=new CliFailure('LOGIN_REQUIRED'));
   if(response.status===403)throw (failure=new CliFailure('INSUFFICIENT_SCOPE'));
   if(response.status>=300&&response.status<400)throw (failure=new CliFailure('REMOTE_FAILURE'));
   if(!response.body)return response;
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>responseLimit)throw new CliFailure('REMOTE_FAILURE');chunks.push(part.value);}
   }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const headers=new Headers(response.headers);headers.delete('content-encoding');headers.delete('content-length');
   return new Response(Buffer.concat(chunks),{status:response.status,headers});
  }catch(error){failure??=error instanceof CliFailure?error:new CliFailure('REMOTE_FAILURE');throw failure;}
 };
 const client=new Client({name:'findmeatime-cli',version:'0.1.0'});
 const transport=new StreamableHTTPClientTransport(new URL(endpoint),{fetch:safeFetch,requestInit:{headers:{authorization:'Bearer '+accessToken}},onInsufficientScope:'throw',reconnectionOptions:{maxRetries:0,initialReconnectionDelay:1000,maxReconnectionDelay:1000,reconnectionDelayGrowFactor:1}});
 try{
  await client.connect(transport,{signal:deadline});
  let result:unknown;
  if(command.kind==='tools')result=await client.listTools(undefined,{signal:deadline});
  else{
   const called=await client.callTool({name:command.name,arguments:command.input},{signal:deadline});
   if(called.isError)throw new CliFailure('TOOL_FAILED');
   result=called.structuredContent;
   if(result===undefined)throw new CliFailure('REMOTE_FAILURE');
  }
  if(JSON.stringify(result).includes(accessToken))throw new CliFailure('REMOTE_FAILURE');
  return result;
 }catch(error){throw failure??(error instanceof CliFailure?error:new CliFailure('REMOTE_FAILURE'));}
 finally{await client.close().catch(()=>{});}
}
export async function runMcpCommand(command:CliCommand,connection:{origin:string;accessToken:string},stdout:(value:string)=>void,stderr:(value:string)=>void,fetcher:typeof fetch=fetch):Promise<number>{
 try{stdout(JSON.stringify(await invokeMcp(connection.origin,connection.accessToken,command,fetcher))+'\n');return 0;}
 catch(error){const safe=error instanceof CliFailure?error:new CliFailure('REMOTE_FAILURE');stderr(JSON.stringify({error:{code:safe.code,message:safe.message}})+'\n');return safe.exitCode;}
}

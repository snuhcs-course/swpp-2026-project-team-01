import {createServer,type ServerResponse} from 'node:http';
import {randomBytes} from 'node:crypto';
import {CliFailure} from './mcp.ts';
import type {CliOAuthClient} from './oauth.ts';
import type {StoredConnection} from './store.ts';
/** Only the authorization URL reaches the browser launcher; tokens stay in memory. */
export async function browserLogin(client:Pick<CliOAuthClient,'begin'>,scope:string,openBrowser:(url:string)=>Promise<void>,options:{requestId?:string;signal?:AbortSignal;timeoutMs?:number}={}):Promise<StoredConnection>{
 const path='/callback/'+randomBytes(32).toString('base64url');
 let callback='',expectedState='',attempt:Awaited<ReturnType<CliOAuthClient['begin']>>|undefined,busy=false,settled=false;
 let resolve!: (value:StoredConnection)=>void,reject!: (error:CliFailure)=>void;
 const result=new Promise<StoredConnection>((yes,no)=>{resolve=yes;reject=no;});void result.catch(()=>{});
 const fail=()=>{if(!settled){settled=true;reject(new CliFailure('LOGIN_REQUIRED'));}};
 const reply=(response:ServerResponse,status:number,message:string)=>{response.writeHead(status,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','pragma':'no-cache','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'"});response.end(message);};
 const server=createServer({maxHeaderSize:8192,requestTimeout:5000,headersTimeout:5000},(request,response)=>{
  let url:URL;
  try{
   if(!callback||request.method!=='GET'||request.headers.host!==new URL(callback).host||request.headers.origin||!request.url?.startsWith(path+'?')||request.url.length>16384)throw Error();
   url=new URL(request.url,callback);
   if(url.pathname!==path||url.origin!==new URL(callback).origin||url.searchParams.getAll('state').length!==1||url.searchParams.get('state')!==expectedState||!expectedState)throw Error();
  }catch{reply(response,400,'This callback does not match the current sign-in.');return;}
  if(busy||settled||!attempt){reply(response,409,'This sign-in has already been handled.');return;}busy=true;
  void attempt.complete(url.href).then(connection=>{
   if(settled){reply(response,410,'This sign-in has expired.');return;}
   // Do not claim credential persistence before the caller saves the result.
   response.once('finish',()=>{if(!settled){settled=true;resolve(connection);}});
   reply(response,200,'Authorization received. Return to the terminal to finish.');
  },()=>{reply(response,400,'Sign-in could not be completed. Start again in the terminal.');fail();});
 });
 server.on('error',fail);server.on('clientError',(_error,socket)=>socket.destroy());
 const timer=setTimeout(fail,options.timeoutMs??600000);options.signal?.addEventListener('abort',fail,{once:true});
 try{
  if(options.signal?.aborted)throw new CliFailure('LOGIN_REQUIRED');
  await Promise.race([new Promise<void>(yes=>server.listen(0,'127.0.0.1',yes)),result]);
  const address=server.address();if(!address||typeof address==='string')throw new CliFailure('LOGIN_REQUIRED');
  callback='http://127.0.0.1:'+address.port+path;
  attempt=await Promise.race([client.begin(scope,callback,options.requestId),result.then(()=>{throw new CliFailure('LOGIN_REQUIRED');})]);
  expectedState=new URL(attempt.authorizationUrl).searchParams.get('state')??'';
  if(!/^[A-Za-z0-9_-]{43}$/u.test(expectedState))throw new CliFailure('LOGIN_REQUIRED');
  await Promise.race([openBrowser(attempt.authorizationUrl),result]);
  return await result;
 }catch{throw new CliFailure('LOGIN_REQUIRED');}
 finally{
  settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',fail);
  await new Promise<void>(yes=>{server.close(()=>yes());server.closeAllConnections();});
 }
}

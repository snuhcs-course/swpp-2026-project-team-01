import {publicHandle} from '../contracts/handles.ts';
import {spawn} from 'node:child_process';
import {z} from 'zod';
import {browserLogin} from './login.ts';
import {CliOAuthClient} from './oauth.ts';
import {CliCredentialStore} from './store.ts';
import {cliCommand,cliOrigin,CliFailure,runMcpCommand} from './mcp.ts';
const defaultOrigin='https://release.findmeatime.com';
export async function openSystemBrowser(url:string):Promise<void>{
 const command=process.platform==='darwin'?'open':process.platform==='linux'?'xdg-open':null;
 if(!command)throw new CliFailure('LOGIN_REQUIRED');
 await new Promise<void>((resolve,reject)=>{
  const child=spawn(command,[url],{stdio:'ignore',shell:false});
  const timer=setTimeout(()=>{child.kill();reject(new CliFailure('LOGIN_REQUIRED'));},10000);
  child.once('error',()=>{clearTimeout(timer);reject(new CliFailure('LOGIN_REQUIRED'));});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new CliFailure('LOGIN_REQUIRED'));});
 });
}
export type CliIO={stdin:AsyncIterable<Uint8Array>;stdout:(text:string)=>void;stderr:(text:string)=>void;signal?:AbortSignal};
type OAuth=Pick<CliOAuthClient,'begin'|'refresh'|'revoke'>;
export async function runCli(argv:readonly string[],io:CliIO,dependencies:{store?:CliCredentialStore;oauth?:(origin:string)=>OAuth;openBrowser?:(url:string)=>Promise<void>;fetcher?:typeof fetch}={}):Promise<number>{
 try{
  const args=[...argv];let origin=defaultOrigin;
  if(args[0]==='--origin'){origin=cliOrigin(args[1]??'');args.splice(0,2);}
  if(args.length===1&&args[0]==='--help'){
   io.stdout(JSON.stringify({usage:['fmat [--origin URL] login host|requester|intake [--request UUID | --handle HANDLE]','fmat [--origin URL] tools CONNECTION_UUID','fmat [--origin URL] call CONNECTION_UUID TOOL_NAME < input.json','fmat [--origin URL] logout CONNECTION_UUID'],defaultOrigin,credentials:'Browser authorization only; no token flags or environment-token fallback.'})+'\n');return 0;
  }
  const store=dependencies.store??new CliCredentialStore(),oauth=(dependencies.oauth??(value=>new CliOAuthClient(value)))(origin);
  if(args[0]==='login'){
   const role=args[1],intake=role==='intake';
   if(!(intake?args.length===4&&args[2]==='--handle'&&publicHandle.safeParse(args[3]).success:
    ['host','requester'].includes(role)&&(args.length===2||role==='requester'&&args.length===4&&args[2]==='--request'&&z.uuid().safeParse(args[3]).success)))throw new CliFailure('INVALID_INPUT');
   const scope=(role==='host'?'host':'request'),connection=await browserLogin(oauth,`${scope}:decide ${intake?'request:intake ':''}${scope}:read ${scope}:write`,dependencies.openBrowser??openSystemBrowser,{requestId:intake?undefined:args[3],handle:intake?args[3]:undefined,signal:io.signal});
   try{await store.save(connection);}catch(error){await oauth.revoke(connection).catch(()=>{});throw error;}
   io.stdout(JSON.stringify({connection:connection.grantId,origin,actor:connection.actorKind,scope:connection.scope})+'\n');return 0;
  }
  if(args[0]==='logout'&&args.length===2&&z.uuid().safeParse(args[1]).success){await store.logout(origin,args[1],current=>oauth.revoke(current));io.stdout(JSON.stringify({loggedOut:true})+'\n');return 0;}
  if(!(['tools','call'].includes(args[0])&&z.uuid().safeParse(args[1]).success))throw new CliFailure('INVALID_INPUT');
  const connectionId=args[1],command=await cliCommand([args[0],...args.slice(2)],io.stdin,io.signal);
  const accessToken=await store.access(origin,connectionId,current=>oauth.refresh(current));
  return runMcpCommand(command,{origin,accessToken},io.stdout,io.stderr,dependencies.fetcher,io.signal);
 }catch(error){const safe=error instanceof CliFailure?error:new CliFailure('REMOTE_FAILURE');io.stderr(JSON.stringify({error:{code:safe.code,message:safe.message}})+'\n');return safe.exitCode;}
}

import {constants} from 'node:fs';
import {lstat,mkdir,open,rename,unlink,rmdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {z} from 'zod';
import {cliOrigin,CliFailure} from './mcp.ts';
const jwt=z.string().max(8192).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
export const storedConnection=z.strictObject({version:z.literal(1),origin:z.string(),grantId:z.uuid(),clientId:z.uuid(),actorKind:z.enum(['host','guest','intake']),actorId:z.uuid(),scope:z.string().min(1).max(100),accessToken:jwt,refreshToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),accessExpiresAt:z.number().int().positive(),state:z.enum(['ready','refreshing','revoking'])});
export type StoredConnection=z.infer<typeof storedConnection>;
const missing=(error:unknown)=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT');
const exists=(error:unknown)=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST');
/** POSIX private storage. Never repair unsafe permissions or follow file symlinks. */
export class CliCredentialStore{
 private readonly root:string;
 constructor(root=join(process.env.XDG_CONFIG_HOME||join(homedir(),'.config'),'findmeatime'),private readonly now=Date.now,private readonly lockWaitMs=2000){this.root=resolve(root);}
 private async directory(path:string){
  await mkdir(path,{recursive:true,mode:0o700});
  const stat=await lstat(path);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o700||!process.getuid||stat.uid!==process.getuid())throw new CliFailure('STORAGE_UNSAFE');
 }
 private async paths(origin:string,grantId:string){
  const canonical=cliOrigin(origin);if(!z.uuid().safeParse(grantId).success)throw new CliFailure('INVALID_INPUT');
  await this.directory(this.root);
  const dir=join(this.root,createHash('sha256').update(canonical).digest('hex'));await this.directory(dir);
  return {origin:canonical,grantId,dir,file:join(dir,grantId+'.json'),lock:join(dir,grantId+'.lock')};
 }
 private async synced(dir:string){const handle=await open(dir,constants.O_RDONLY);try{await handle.sync();}finally{await handle.close();}}
 private async write(paths:Awaited<ReturnType<CliCredentialStore['paths']>>,value:StoredConnection){
  const temporary=join(paths.dir,'.'+randomUUID()+'.tmp');
  try{
   const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   try{await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();}finally{await handle.close();}
   await rename(temporary,paths.file);await this.synced(paths.dir);
  }finally{await unlink(temporary).catch(error=>{if(!missing(error))throw error;});}
 }
 private validate(value:unknown,origin:string,grantId:string){
  const parsed=storedConnection.safeParse(value);
  if(!parsed.success||parsed.data.origin!==origin||parsed.data.grantId!==grantId||cliOrigin(parsed.data.origin)!==origin)throw new CliFailure('STORAGE_UNSAFE');
  const prefix=parsed.data.actorKind==='host'?'host:':'request:',scopes=parsed.data.scope.split(' ');
  if(new Set(scopes).size!==scopes.length||!scopes.every(s=>['read','write','decide',...(parsed.data.actorKind==='intake'?['intake']:[])].some(permission=>s===prefix+permission)))throw new CliFailure('STORAGE_UNSAFE');
  return parsed.data;
 }
 private async read(paths:Awaited<ReturnType<CliCredentialStore['paths']>>):Promise<StoredConnection>{
  let handle;try{handle=await open(paths.file,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if(missing(error))throw new CliFailure('LOGIN_REQUIRED');throw error;}
  try{
   const stat=await handle.stat();
   if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o777)!==0o600||!process.getuid||stat.uid!==process.getuid()||stat.size>32768)throw new CliFailure('STORAGE_UNSAFE');
   const buffer=Buffer.alloc(32769),{bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>32768)throw new CliFailure('STORAGE_UNSAFE');
   return this.validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,bytesRead))),paths.origin,paths.grantId);
  }finally{await handle.close();}
 }
 private async locked<T>(origin:string,grantId:string,work:(paths:Awaited<ReturnType<CliCredentialStore['paths']>>)=>Promise<T>):Promise<T>{
  let paths:Awaited<ReturnType<CliCredentialStore['paths']>>|undefined,locked=false;
  try{
   paths=await this.paths(origin,grantId);const start=Date.now();
   while(!locked){try{await mkdir(paths.lock,{mode:0o700});locked=true;}catch(error){if(!exists(error))throw error;if(Date.now()-start>=this.lockWaitMs)throw new CliFailure('CONNECTION_BUSY');await setTimeout(25);}}
   return await work(paths);
  }catch(error){throw error instanceof CliFailure?error:new CliFailure('STORAGE_UNSAFE');}
  finally{if(locked&&paths)await rmdir(paths.lock).catch(()=>{});}
 }
 /** Login saves a new grant; it cannot silently overwrite an existing connection. */
 async save(value:StoredConnection){
  return this.locked(value.origin,value.grantId,async paths=>{
   const parsed=this.validate(value,paths.origin,paths.grantId);if(parsed.state!=='ready'||parsed.accessExpiresAt<=this.now())throw new CliFailure('LOGIN_REQUIRED');
   try{await lstat(paths.file);throw new CliFailure('STORAGE_UNSAFE');}catch(error){if(!missing(error))throw error;}
   await this.write(paths,parsed);
  });
 }
 async access(origin:string,grantId:string,refresh:(current:StoredConnection)=>Promise<StoredConnection>):Promise<string>{
  return this.locked(origin,grantId,async paths=>{
   const current=await this.read(paths);if(current.state!=='ready')throw new CliFailure('LOGIN_REQUIRED');
   if(current.accessExpiresAt>this.now()+30000)return current.accessToken;
   // Durable before dispatch: after a crash or uncertain reply this token cannot be replayed.
   await this.write(paths,{...current,state:'refreshing'});
   let next:StoredConnection;
   try{
    next=this.validate(await refresh({...current}),paths.origin,paths.grantId);
    if(next.state!=='ready'||next.clientId!==current.clientId||next.actorKind!==current.actorKind||next.actorId!==current.actorId||next.accessExpiresAt<=this.now()+30000||next.refreshToken===current.refreshToken||!next.scope.split(' ').every(s=>current.scope.split(' ').includes(s)))throw Error();
   }catch{throw new CliFailure('LOGIN_REQUIRED');}
   await this.write(paths,next);return next.accessToken;
  });
 }
 async logout(origin:string,grantId:string,revoke:(current:StoredConnection)=>Promise<void>):Promise<void>{
  return this.locked(origin,grantId,async paths=>{
   const current=await this.read(paths);await this.write(paths,{...current,state:'revoking'});
   try{await revoke({...current});}catch{throw new CliFailure('LOGOUT_INCOMPLETE');}
   await unlink(paths.file);await this.synced(paths.dir);
  });
 }
}

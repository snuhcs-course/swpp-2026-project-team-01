import {constants} from 'node:fs';
import {lstat,mkdir,open,unlink} from 'node:fs/promises';
import {dirname,basename,isAbsolute,resolve,parse,join} from 'node:path';
export class ArtifactFailure extends Error{constructor(){super('PRIVATE_OUTPUT_UNAVAILABLE');}}
/** Reserve an exclusive file before remote issuance. Do not follow symlinks or
 * silently repair permissions. The caller owns the dedicated 0700 directory. */
export async function privateArtifact(path:string){
 let handle:Awaited<ReturnType<typeof open>>|undefined,created=false,finished=false;
 const discard=async()=>{if(!handle||!created)return;const own=await handle.stat().catch(()=>null),named=await lstat(path).catch(()=>null);if(own&&named&&own.ino===named.ino&&own.dev===named.dev)await unlink(path).catch(()=>{});};
 try{
  if(!isAbsolute(path)||resolve(path)!==path||/[\x00-\x1f\x7f]/u.test(path)||!process.getuid)throw Error();
  const uid=process.getuid(),dir=dirname(path),root=parse(path).root;
  if(dir===root||basename(path).startsWith('.'))throw Error();
  const ancestors:string[]=[];for(let p=dirname(dir);;p=dirname(p)){ancestors.unshift(p);if(p===root)break;}
  for(const ancestor of ancestors){const stat=await lstat(ancestor);if(!stat.isDirectory()||stat.isSymbolicLink()||![0,uid].includes(stat.uid)||((stat.mode&0o022)!==0&&(stat.mode&0o1000)===0))throw Error();}
  try{await mkdir(dir,{mode:0o700});}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST'))throw error;}
  const check=async()=>{const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o700||stat.uid!==uid)throw Error();return stat;};
  const original=await check();
  handle=await open(join(dir,basename(path)),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;
  const verify=async()=>{const current=await check(),file=await handle!.stat(),named=await lstat(path);if(current.dev!==original.dev||current.ino!==original.ino||!file.isFile()||file.nlink!==1||file.uid!==uid||(file.mode&0o777)!==0o600||named.dev!==file.dev||named.ino!==file.ino)throw Error();};
  await verify();
  return {
   async write(value:unknown){try{await verify();await handle!.writeFile(JSON.stringify(value,null,2)+'\n');await handle!.sync();await verify();const directory=await open(dir,constants.O_RDONLY|constants.O_NOFOLLOW);try{await directory.sync();}finally{await directory.close();}finished=true;}catch{throw new ArtifactFailure();}},
   async close(){try{if(!finished)await discard();}finally{await handle!.close();}},
  };
 }catch{await discard();await handle?.close().catch(()=>{});throw new ArtifactFailure();}
}

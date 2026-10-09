import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,chmod,stat,symlink,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {CliCredentialStore,type StoredConnection} from './store.ts';
import {CliFailure} from './mcp.ts';
const now=1800000000000,origin='https://store.example.test';
const value=():StoredConnection=>({version:1,origin,grantId:randomUUID(),clientId:randomUUID(),actorKind:'host',actorId:randomUUID(),scope:'host:read host:write',accessToken:'aaa.bbb.ccc',refreshToken:'a'.repeat(43),accessExpiresAt:now+1000,state:'ready'});
const file=(root:string,v:StoredConnection)=>join(root,createHash('sha256').update(v.origin).digest('hex'),v.grantId+'.json');
const fails=(code:string)=>(error:unknown)=>error instanceof CliFailure&&error.code===code;
async function fixture(run:(root:string,store:CliCredentialStore,v:StoredConnection)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'fmat-store-'));try{await run(root,new CliCredentialStore(root,()=>now,100),value());}finally{await rm(root,{recursive:true,force:true});}}
test('credential storage isolates origins/grants and uses private atomic files',()=>fixture(async(root,store,v)=>{
 await store.save({...v,accessExpiresAt:now+60000});
 assert.equal((await stat(root)).mode&0o777,0o700);assert.equal((await stat(file(root,v))).mode&0o777,0o600);
 assert.equal(await store.access(origin,v.grantId,async()=>assert.fail()),v.accessToken);
 await assert.rejects(store.save(v),fails('STORAGE_UNSAFE'));
 await assert.rejects(store.access('https://another.example',v.grantId,async()=>assert.fail()),fails('LOGIN_REQUIRED'));
 await assert.rejects(store.access(origin,randomUUID(),async()=>assert.fail()),fails('LOGIN_REQUIRED'));
 assert.equal(JSON.parse(await readFile(file(root,v),'utf8')).origin,origin);
}));
test('parallel refresh rotates once and a lost reply disables rather than replays the connection',()=>fixture(async(root,store,v)=>{
 await store.save(v);let calls=0;
 const refresh=async(current:StoredConnection)=>{calls++;await new Promise(r=>setTimeout(r,40));return {...current,accessToken:'ddd.eee.fff',refreshToken:'b'.repeat(43),accessExpiresAt:now+60000};};
 const other=new CliCredentialStore(root,()=>now,1000);
 assert.deepEqual(await Promise.all([store.access(origin,v.grantId,refresh),other.access(origin,v.grantId,refresh)]),['ddd.eee.fff','ddd.eee.fff']);assert.equal(calls,1);
 const uncertain={...value()};await store.save(uncertain);
 const lost=async()=>{calls++;throw Error('private refresh data');};await assert.rejects(store.access(origin,uncertain.grantId,lost),fails('LOGIN_REQUIRED'));
 assert.equal(JSON.parse(await readFile(file(root,uncertain),'utf8')).state,'refreshing');
 await assert.rejects(other.access(origin,uncertain.grantId,lost),fails('LOGIN_REQUIRED'));assert.equal(calls,2);
}));
test('refresh cannot switch principal or expand scopes; failed logout stays disabled until revocation succeeds',()=>fixture(async(root,store,v)=>{
 await store.save(v);
 await assert.rejects(store.access(origin,v.grantId,async current=>({...current,actorId:randomUUID(),accessExpiresAt:now+60000,refreshToken:'b'.repeat(43)})),fails('LOGIN_REQUIRED'));
 await assert.rejects(store.logout(origin,v.grantId,async()=>{throw Error('private provider message');}),fails('LOGOUT_INCOMPLETE'));
 assert.equal(JSON.parse(await readFile(file(root,v),'utf8')).state,'revoking');await assert.rejects(store.access(origin,v.grantId,async()=>assert.fail()),fails('LOGIN_REQUIRED'));
 let revoked=0;await store.logout(origin,v.grantId,async current=>{assert.equal(current.grantId,v.grantId);revoked++;});assert.equal(revoked,1);await assert.rejects(readFile(file(root,v)),{code:'ENOENT'});
 const expanded=value();await store.save(expanded);await assert.rejects(store.access(origin,expanded.grantId,async current=>({...current,scope:current.scope+' host:decide',accessExpiresAt:now+60000,refreshToken:'b'.repeat(43)})),fails('LOGIN_REQUIRED'));
}));
test('unsafe files, symlinks, permissions and corrupt data fail closed',()=>fixture(async(root,store,v)=>{
 await store.save(v);await chmod(file(root,v),0o644);await assert.rejects(store.access(origin,v.grantId,async()=>assert.fail()),fails('STORAGE_UNSAFE'));
 await chmod(file(root,v),0o600);const target=join(root,'other.json');await writeFile(target,JSON.stringify(v),{mode:0o600});await unlink(file(root,v));await symlink(target,file(root,v));
 await assert.rejects(store.access(origin,v.grantId,async()=>assert.fail()),fails('STORAGE_UNSAFE'));assert.equal(JSON.parse(await readFile(target,'utf8')).grantId,v.grantId);
 await unlink(file(root,v));await writeFile(file(root,v),'invalid',{mode:0o600});await assert.rejects(store.access(origin,v.grantId,async()=>assert.fail()),fails('STORAGE_UNSAFE'));
 await chmod(root,0o755);await assert.rejects(store.access(origin,v.grantId,async()=>assert.fail()),fails('STORAGE_UNSAFE'));
}));
test('separate terminal processes coordinate one refresh using the filesystem lock',()=>fixture(async(root,store,v)=>{
 await store.save(v);const worker=join(root,'worker.mjs'),marker=join(root,'refreshes');
 await writeFile(worker,`import {CliCredentialStore} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'lib/cli/store.ts')).href)};
import {appendFile} from 'node:fs/promises';
let input='';for await(const part of process.stdin)input+=part;
const {root,origin,id,now,marker}=JSON.parse(input);
const store=new CliCredentialStore(root,()=>now,3000);
await store.access(origin,id,async current=>{await appendFile(marker,'refresh\\n',{mode:0o600});await new Promise(r=>setTimeout(r,100));return {...current,accessToken:'ddd.eee.fff',refreshToken:'b'.repeat(43),accessExpiresAt:now+60000};});
process.stdout.write('ok');`,{mode:0o600});
 const run=()=>new Promise<string>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx',worker],{stdio:['pipe','pipe','pipe']});let out='';child.stdout.on('data',part=>out+=part);child.stderr.resume();child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(Error('Worker failed')));child.stdin.end(JSON.stringify({root,origin,id:v.grantId,now,marker}));});
 assert.deepEqual(await Promise.all([run(),run()]),['ok','ok']);assert.equal(await readFile(marker,'utf8'),'refresh\n');
}));

test('an existing lock times out without stealing it or invoking refresh',()=>fixture(async(root,store,v)=>{
 await store.save(v);const lock=file(root,v).replace(/\.json$/u,'.lock');await mkdir(lock,{mode:0o700});
 await assert.rejects(store.access(origin,v.grantId,async()=>assert.fail()),fails('CONNECTION_BUSY'));assert.equal((await stat(lock)).isDirectory(),true);assert.equal(JSON.parse(await readFile(file(root,v),'utf8')).state,'ready');
}));

test('intake storage permits narrowed requester scopes but cannot promote a guest or host',()=>fixture(async(_root,store,v)=>{
 const intake={...v,actorKind:'intake' as const,scope:'request:intake request:read'};await store.save(intake);
 assert.equal(await store.access(origin,intake.grantId,async current=>({...current,scope:'request:read',refreshToken:'b'.repeat(43),accessExpiresAt:now+60000})),intake.accessToken);
 for(const actorKind of ['guest','host'] as const)await assert.rejects(store.save({...intake,grantId:randomUUID(),actorKind}),fails('STORAGE_UNSAFE'));
}));

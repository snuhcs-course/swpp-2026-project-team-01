import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

// Isolated eve instance with the real application channels and deterministic
// model. The fixture cannot call external model or messaging providers.
export async function startBrowserRuntime(local:{API_URL:string;SERVICE_ROLE_KEY:string;ANON_KEY:string},appOrigin:string,dispatchSecret?:string,options:{preload?:string;modelCallLog?:string;modelContextWindowTokens?:number}={}){
  const root=process.cwd();await mkdir('.local/rebuild',{recursive:true});
  const fixture=await mkdtemp(resolve('.local/rebuild/browser-runtime-'));
  await mkdir(join(fixture,'agent/channels'),{recursive:true});
  await mkdir(join(fixture,'agent/tools'),{recursive:true});
  await writeFile(join(fixture,'agent/instructions.md'),'Reply to synthetic browser tests.');
  await writeFile(join(fixture,'package.json'),JSON.stringify({name:'fmat-browser-fixture',private:true,type:'module',dependencies:{eve:'0.71.3'}}));
  for(const [target,source] of Object.entries({'agent/agent.ts':'tests/runtime/fixture-agent.ts','agent/channels/eve.ts':'agent/channels/eve.ts','agent/channels/conversations.ts':'agent/channels/conversations.ts','agent/tools/read_context.ts':'agent/tools/read_context.ts','agent/tools/propose_request_details.ts':'agent/tools/propose_request_details.ts','agent/tools/update_setup_draft.ts':'agent/tools/update_setup_draft.ts'}))
    await writeFile(join(fixture,target),`export {default} from ${JSON.stringify(resolve(source))};\n`);
  const modelContext=String(options.modelContextWindowTokens??100_000);
  const build=spawn(process.execPath,[join(root,'node_modules/eve/bin/eve.js'),'build','--skip-sandbox-prewarm'],{cwd:fixture,env:{...process.env,FMAT_FIXTURE_MODEL_CONTEXT:modelContext},stdio:['ignore','pipe','pipe']});
  let buildLog='';build.stdout.on('data',v=>buildLog+=v);build.stderr.on('data',v=>buildLog+=v);
  const [buildCode]=await once(build,'close');await writeFile(join(fixture,'build.log'),buildLog);assert.equal(buildCode,0,buildLog.slice(-4000));
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));
  const origin=`http://127.0.0.1:${port}`;
  let child:ReturnType<typeof spawn>;
  let log='';
  async function start(resume=false){
  child=spawn(process.execPath,[join(root,'node_modules/eve/bin/eve.js'),'dev','--no-ui','--no-default-extensions','--host','127.0.0.1','--port',String(port),...(resume?['--resume']:[])],{cwd:fixture,env:{...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,APP_ORIGIN:appOrigin,PORT:String(port),HOST:'127.0.0.1',OPENAI_API_KEY:'',WORKFLOW_INLINE_OWNERSHIP_LEASE_SECONDS:'5',...(options.preload?{NODE_OPTIONS:'--import '+options.preload}:{}),FMAT_FIXTURE_MODEL_CONTEXT:modelContext,FMAT_FIXTURE_MODEL_LOG:options.modelCallLog??'',RUNTIME_DISPATCH_SECRET:dispatchSecret??'',NODE_ENV:'development'},stdio:['ignore','pipe','pipe'],detached:true});
  child.stdout!.on('data',v=>log+=v);child.stderr!.on('data',v=>log+=v);
  for(let i=0;i<300;i++){assert.equal(child.exitCode,null,log.slice(-3000));try{if((await fetch(origin+'/eve/v1/health')).ok)return;}catch{}await delay(100);}throw new Error('Browser runtime did not start');
  }
  async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');process.kill(-child.pid!,'SIGKILL');await closed;}await writeFile(join(fixture,'server.log'),log);}
  try{await start();return {origin,stop,async restart(){await stop();await start(true);}};}
  catch(error){await stop();throw error;}
}

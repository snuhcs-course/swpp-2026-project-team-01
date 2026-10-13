import test from 'node:test';
import assert from 'node:assert/strict';
import {startBrowserRuntime} from './fixture-server.ts';

test('live setup probe requires explicit opt-in, pinned model, local targets and no diagnostic overlays before boot',async()=>{
 const saved={FMAT_LIVE_SETUP_PROBE:process.env.FMAT_LIVE_SETUP_PROBE,OPENAI_MODEL:process.env.OPENAI_MODEL,OPENAI_API_KEY:process.env.OPENAI_API_KEY};
 const local={API_URL:'http://127.0.0.1:54321',SERVICE_ROLE_KEY:'synthetic',ANON_KEY:'synthetic'};
 try{
  delete process.env.FMAT_LIVE_SETUP_PROBE;process.env.OPENAI_MODEL='gpt-6-luna';process.env.OPENAI_API_KEY='synthetic';
  await assert.rejects(startBrowserRuntime(local,'http://localhost:3000',undefined,{liveSetupModel:true}),/explicit|dedicated opt-in/);
  process.env.FMAT_LIVE_SETUP_PROBE='1';delete process.env.OPENAI_API_KEY;
  await assert.rejects(startBrowserRuntime(local,'http://localhost:3000',undefined,{liveSetupModel:true}));
  process.env.OPENAI_API_KEY='synthetic';process.env.OPENAI_MODEL='different-model';
  await assert.rejects(startBrowserRuntime(local,'http://localhost:3000',undefined,{liveSetupModel:true}));
  process.env.OPENAI_MODEL='gpt-6-luna';
  await assert.rejects(startBrowserRuntime({...local,API_URL:'https://abcdefghijklmnopqrst.supabase.co'},'http://localhost:3000',undefined,{liveSetupModel:true}));
  await assert.rejects(startBrowserRuntime(local,'https://release.findmeatime.com',undefined,{liveSetupModel:true}));
  await assert.rejects(startBrowserRuntime(local,'http://localhost:3000',undefined,{liveSetupModel:true,legacyAuthenticationFailure:true}),/diagnostic overlays/);
 }finally{for(const [name,value]of Object.entries(saved)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});

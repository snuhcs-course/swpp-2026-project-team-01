import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateText,APICallError} from 'ai';
import {MockLanguageModelV4} from 'ai/test';
import {openai} from 'eve/models/openai';
import {boundedModel,modelExecutionPolicy} from './execution.ts';
import {ApplicationError} from '../errors.ts';

type Model=ReturnType<typeof boundedModel>;
type Call=Parameters<Model['doGenerate']>[0];
const prompt:Call['prompt']=[{role:'user',content:[{type:'text',text:'Find a time'}]}];
const answer:Awaited<ReturnType<Model['doGenerate']>>={content:[{type:'text',text:'Ready'}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}},warnings:[]};
const configurationUnavailable=(error:unknown)=>error instanceof ApplicationError&&error.code==='CONFIGURATION_UNAVAILABLE'&&error.cause===undefined;
const limited=(error:unknown)=>error instanceof ApplicationError&&error.code==='MODEL_LIMIT';
const fixture=(options:ConstructorParameters<typeof MockLanguageModelV4>[0]={})=>new MockLanguageModelV4({modelId:'gpt-6-luna',doGenerate:answer,...options});

test('enforces options and reserves once per call while retaining lower output limits',async()=>{
 let reservations=0;const provider=fixture(),model=boundedModel(provider,async()=>{reservations++;});
 await model.doGenerate({prompt,maxOutputTokens:100_000,providerOptions:{openai:{serviceTier:'priority',store:true,previousResponseId:'remote',conversation:'remote',promptCacheOptions:{mode:'explicit'}}}});
 await model.doGenerate({prompt,maxOutputTokens:2048,providerOptions:{openai:{safetyIdentifier:'a'.repeat(64)}}});
 assert.equal(reservations,2);
 assert.equal(provider.doGenerateCalls[0].maxOutputTokens,4096);
 assert.equal(provider.doGenerateCalls[1].maxOutputTokens,2048);
 assert.equal(provider.doGenerateCalls[1].providerOptions?.openai?.safetyIdentifier,'a'.repeat(64),'keep the framework hashed safety identifier');
 assert.deepEqual(provider.doGenerateCalls[0].providerOptions,{openai:{store:false,serviceTier:'default',reasoningEffort:'low',parallelToolCalls:false}});
 assert.ok(provider.doGenerateCalls[0].abortSignal);
});

test('validates UTF-8 envelope, tools, output limits and attachments before reserving',async()=>{
 let reservations=0;const provider=fixture(),model=boundedModel(provider,async()=>{reservations++;});
 const invalid:Call[]=[
  {prompt:[{role:'user',content:[{type:'text',text:'한'.repeat(50_000)}]}]},
  {prompt,tools:[{type:'function',name:'read',inputSchema:{type:'object',description:'x'.repeat(modelExecutionPolicy.maxInputBytes)}}]},
  {prompt,responseFormat:{type:'json',schema:{description:'x'.repeat(modelExecutionPolicy.maxInputBytes)}}},
  {prompt,tools:[{type:'provider',id:'openai.web_search',name:'web_search',args:{}}]},
  {prompt:[{role:'user',content:[{type:'file',mediaType:'image/png',data:{type:'url',url:new URL('https://example.com/image.png')}}]}]},
  {prompt:[{role:'tool',content:[{type:'tool-result',toolName:'read',toolCallId:'1',output:{type:'content',value:[{type:'text',text:'unsupported richer output'}]}}]}]},
  {prompt:[{role:'assistant',content:[{type:'tool-call',toolName:'remote',toolCallId:'1',input:{},providerExecuted:true}]}]},
  ...[0,-1,Infinity,1.5,NaN].map(maxOutputTokens=>({prompt,maxOutputTokens})),
 ];
 for(const input of invalid)await assert.rejects(model.doGenerate(input),limited);
 assert.equal(reservations,0);assert.equal(provider.doGenerateCalls.length,0);
 assert.throws(()=>boundedModel(fixture({modelId:'another-model'}),async()=>{}),{code:'CONFIGURATION_UNAVAILABLE'});
});

test('removes cache controls from prompt metadata without changing tool-result business data',async()=>{
 const provider=fixture(),model=boundedModel(provider,async()=>{});
 const options={openai:{promptCacheBreakpoint:true,itemId:'reasoning-id',reasoningEncryptedContent:'encrypted'}};
 await model.doGenerate({prompt:[{role:'assistant',content:[{type:'reasoning',text:'',providerOptions:options}]},
  {role:'tool',content:[{type:'tool-result',toolName:'read',toolCallId:'1',output:{type:'json',value:{providerOptions:{unchanged:true}},providerOptions:options},providerOptions:options}],providerOptions:options}],tools:[{type:'function',name:'read',inputSchema:{type:'object'},providerOptions:options}]});
 const call=provider.doGenerateCalls[0];
 assert.ok(!JSON.stringify(call).includes('promptCacheBreakpoint'));
 assert.ok(JSON.stringify(call).includes('reasoningEncryptedContent'));
 assert.ok(JSON.stringify(call).includes('unchanged'));
 assert.equal(call.tools?.[0].type==='function'?call.tools[0].providerOptions:undefined,undefined);
});

test('reservation failures and pre-cancelled calls never reach the provider',async()=>{
 let count=0;const provider=fixture(),model=boundedModel(provider,async()=>{count++;throw new ApplicationError('MODEL_LIMIT',429);});
 await assert.rejects(model.doGenerate({prompt,abortSignal:AbortSignal.abort('private reason')}),limited);
 assert.equal(count,0);
 await assert.rejects(model.doGenerate({prompt}),limited);
 await assert.rejects(model.doStream({prompt}),limited);
 assert.equal(count,2);assert.equal(provider.doGenerateCalls.length+provider.doStreamCalls.length,0);
});

test('actual SDK retries each require a new reservation and stop when denied',async()=>{
 let reservations=0;const provider=fixture({doGenerate:async()=>{throw new APICallError({message:'temporary',url:'https://api.openai.com/v1/responses',requestBodyValues:{},statusCode:503,isRetryable:true});}});
 const model=boundedModel(provider,async()=>{if(++reservations===2)throw new ApplicationError('MODEL_LIMIT',429);});
 await assert.rejects(generateText({model,prompt:'hello',maxRetries:2}));
 assert.equal(reservations,2);assert.equal(provider.doGenerateCalls.length,1);
});

test('configuration failures are sanitized without automatic retries or refunded reservations',async()=>{
 for(const statusCode of [401,403]){
  let reservations=0;
  const provider=fixture({doGenerate:async()=>{throw new APICallError({message:'private authentication detail',
   url:'https://private.test/secret',requestBodyValues:{secret:'private'},responseHeaders:{secret:'private'},
   responseBody:'private body',cause:new Error('private cause'),statusCode,isRetryable:true});}});
  await assert.rejects(generateText({model:boundedModel(provider,async()=>{reservations++;}),prompt:'hello',maxRetries:2}),error=>{
   assert.doesNotMatch(JSON.stringify(error),/private|authentication|401|403/);
   return configurationUnavailable(error);
  });
  assert.equal(reservations,1);assert.equal(provider.doGenerateCalls.length,1);
 }
});

test('stream error events and reader exceptions are sanitized and cancel the source',async()=>{
 for(const mode of ['event','throw'] as const){
  let reservations=0,cancelled=0;
  const error=new APICallError({message:'private upstream detail',url:'https://private.test',requestBodyValues:{secret:'private'},
   statusCode:401,responseBody:JSON.stringify({error:{code:'invalid_api_key'}}),isRetryable:false});
  const provider=fixture({doStream:async()=>({stream:new ReadableStream({start(controller){
   if(mode==='throw')controller.error(error);
   else {controller.enqueue({type:'error',error});controller.enqueue({type:'tool-call',toolCallId:'must-not-run',toolName:'update_setup_draft',input:'{}'});}
  },cancel(){cancelled++;}})})});
  const response=await boundedModel(provider,async()=>{reservations++;}).doStream({prompt}),reader=response.stream.getReader();
  if(mode==='throw')await assert.rejects(reader.read(),configurationUnavailable);
  else {
   const event=(await reader.read()).value;assert.equal(event?.type,'error');
   assert.ok(event?.type==='error'&&configurationUnavailable(event.error));
   assert.doesNotMatch(JSON.stringify(event),/private|invalid_api_key|responseBody/);
   assert.equal((await reader.read()).done,true);assert.equal(cancelled,1);
  }
  assert.equal(reservations,1);assert.equal(provider.doStreamCalls.length,1);
 }
});

test('30-second deadline rejects an uncooperative generation and retains its reservation',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let charged=0;let called!:()=>void;const entered=new Promise<void>(resolve=>{called=resolve;});
 const provider=fixture({doGenerate:()=>{called();return new Promise(()=>{});}}),model=boundedModel(provider,async()=>{charged++;});
 const result=assert.rejects(model.doGenerate({prompt}),limited);
 await entered;t.mock.timers.tick(30_000);await result;
 assert.equal(charged,1);assert.equal(provider.doGenerateCalls[0].abortSignal?.aborted,true);
});

test('deadline during reservation cannot start a late provider call',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let release!:()=>void;const provider=fixture(),model=boundedModel(provider,()=>new Promise<void>(resolve=>{release=resolve;}));
 const result=assert.rejects(model.doGenerate({prompt}),limited);
 t.mock.timers.tick(30_000);await result;release();await Promise.resolve();
 assert.equal(provider.doGenerateCalls.length,0);
});

test('stream deadline errors stalled reads and cancels the source even without a reader',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let cancels=0,reservations=0;
 const provider=fixture({doStream:async()=>({stream:new ReadableStream({cancel(){cancels++;}})})});
 const model=boundedModel(provider,async()=>{reservations++;});
 const first=await model.doStream({prompt}),second=await model.doStream({prompt});
 const stalled=assert.rejects(first.stream.getReader().read(),limited);
 t.mock.timers.tick(30_000);await stalled;
 await assert.rejects(second.stream.getReader().read(),limited);
 assert.equal(cancels,2);assert.equal(reservations,2);
});

test('caller cancellation interrupts stream setup and releases a late stream',async()=>{
 const controller=new AbortController();let release!:(value:Awaited<ReturnType<Model['doStream']>>)=>void,markCancelled!:()=>void;
 const cancelled=new Promise<void>(resolve=>{markCancelled=resolve;});
 let entered!:()=>void;const called=new Promise<void>(resolve=>{entered=resolve;});
 const provider=fixture({doStream:()=>{entered();return new Promise(resolve=>{release=resolve;});}});
 const result=assert.rejects(boundedModel(provider,async()=>{}).doStream({prompt,abortSignal:controller.signal}),limited);
 await called;controller.abort('private cause');await result;
 release({stream:new ReadableStream({cancel(){markCancelled();}})});await cancelled;
});

test('normal stream completion and reader cancellation release the deadline and provider',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let cancelled=0;
 const provider=fixture({doStream:async()=>({stream:new ReadableStream({start(controller){controller.enqueue({type:'text-start',id:'1'});},cancel(){cancelled++;}})})});
 const result=await boundedModel(provider,async()=>{}).doStream({prompt});
 const reader=result.stream.getReader();assert.equal((await reader.read()).value?.type,'text-start');await reader.cancel();
 assert.equal(cancelled,1);t.mock.timers.tick(30_000);
 const complete=fixture({doStream:async()=>({stream:new ReadableStream({start(controller){controller.close();}})})});
 const done=await boundedModel(complete,async()=>{}).doStream({prompt});assert.equal((await done.stream.getReader().read()).done,true);
 t.mock.timers.tick(30_000);assert.equal(complete.doStreamCalls[0].abortSignal?.aborted,false);
});

test('installed direct OpenAI adapter serializes enforced Responses options',async()=>{
 const originalFetch=globalThis.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture-only';
 let body:Record<string,unknown>|undefined;
 globalThis.fetch=async(url,init)=>{
  assert.equal(String(url),'https://api.openai.com/v1/responses');body=JSON.parse(String(init?.body));
  return Response.json({id:'resp_fixture',object:'response',created_at:1,status:'completed',model:'gpt-6-luna',output:[{type:'message',id:'msg_1',role:'assistant',content:[{type:'output_text',text:'Ready',annotations:[]}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}},incomplete_details:null});
 };
 try{
  const raw=openai('gpt-6-luna');assert.notEqual(typeof raw,'string');
  const model=boundedModel(raw as Parameters<typeof boundedModel>[0],async()=>{},2048);
  await model.doGenerate({prompt,maxOutputTokens:100_000,providerOptions:{openai:{serviceTier:'priority',store:true,previousResponseId:'secret'}}});
  assert.equal(body?.max_output_tokens,2048);assert.equal(body?.service_tier,'default');assert.equal(body?.store,false);assert.equal(body?.previous_response_id,undefined);
  assert.equal(body?.model,'gpt-6-luna');assert.equal((body?.reasoning as {effort:string}).effort,'low');
 }finally{globalThis.fetch=originalFetch;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;}
});

test('deployed direct provider fails without a key before HTTP or tool execution',async()=>{
 const originalFetch=globalThis.fetch,key=process.env.OPENAI_API_KEY,dev=process.env.EVE_DEV;
 process.env.OPENAI_API_KEY='';process.env.EVE_DEV='0';
 let requests=0,executions=0,reservations=0;
 globalThis.fetch=async()=>{requests++;throw new Error('Unexpected network access');};
 try{
  const raw=openai('gpt-6-luna');assert.notEqual(typeof raw,'string');
  const model=boundedModel(raw as Parameters<typeof boundedModel>[0],async()=>{reservations++;});
  await assert.rejects(generateText({model,prompt:'Suggest setup preferences',maxRetries:0,tools:{update_setup_draft:{description:'Fixture mutation',inputSchema:(await import('zod')).z.object({}),execute:async()=>{executions++;return {};}}}}),configurationUnavailable);
  await assert.rejects(model.doStream({prompt}),configurationUnavailable);
  assert.equal(requests,0);assert.equal(executions,0);assert.equal(reservations,2,'Failed attempts retain their reservations');
 }finally{
  globalThis.fetch=originalFetch;
  if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;
  if(dev===undefined)delete process.env.EVE_DEV;else process.env.EVE_DEV=dev;
 }
});

test('installed Responses adapter rejects authentication, throttling and billing failures in generation and streaming',async()=>{
 const originalFetch=globalThis.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture-only';
 const {assistantDraftInput}=await import('../../contracts/setup.ts');
 const cases=[
  {status:401,code:'invalid_api_key',type:'invalid_request_error'},
  {status:429,code:'rate_limit_exceeded',type:'rate_limit_error'},
  {status:429,code:'slow_down',type:'rate_limit_error'},
  ...['insufficient_quota','credit_balance_exhausted','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded'].map(code=>({status:429,code,type:'insufficient_quota'})),
 ];
 try{
  for(const scenario of cases){
   let requests=0,executions=0,reservations=0;
   globalThis.fetch=async(url)=>{
    assert.equal(String(url),'https://api.openai.com/v1/responses');requests++;
    return Response.json({error:{message:'synthetic-private-provider-detail',type:scenario.type,code:scenario.code,param:null}},{status:scenario.status,headers:{'retry-after':'1'}});
   };
   const raw=openai('gpt-6-luna');assert.notEqual(typeof raw,'string');
   const model=boundedModel(raw as Parameters<typeof boundedModel>[0],async()=>{reservations++;});
   const rejected=(error:unknown)=>{
    assert.doesNotMatch(JSON.stringify(error),/synthetic-private|invalid_api_key|responseBody|retry-after/);
    assert.equal((error as Error).cause,undefined);
    return ['rate_limit_exceeded','slow_down'].includes(scenario.code)
     ?APICallError.isInstance(error)&&error.statusCode===scenario.status&&error.isRetryable
     :configurationUnavailable(error);
   };
   await assert.rejects(generateText({model,prompt:'Suggest setup preferences',maxRetries:0,tools:{update_setup_draft:{description:'Suggest unconfirmed preferences',inputSchema:assistantDraftInput,execute:async()=>{executions++;return {};}}}}),rejected,scenario.code);
   await assert.rejects(model.doStream({prompt}),rejected,scenario.code);
   assert.equal(executions,0,scenario.code);assert.equal(requests,2,scenario.code);assert.equal(reservations,2,scenario.code);
  }
 }finally{globalThis.fetch=originalFetch;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;}
});

test('installed Responses adapter never executes setup tools for refusals or malformed provider output',async()=>{
 const originalFetch=globalThis.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture-only';
 const {assistantDraftInput}=await import('../../contracts/setup.ts');
 const base={id:'resp_fixture',object:'response',created_at:1,status:'completed',model:'gpt-6-luna',usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}},incomplete_details:null};
 const cases=[
  {name:'refusal',response:()=>Response.json({...base,output:[{type:'message',id:'msg_1',role:'assistant',content:[{type:'refusal',refusal:'Cannot provide a suggestion'}]}]})},
  {name:'invalid response JSON',response:()=>new Response('{broken',{headers:{'content-type':'application/json'}})},
  {name:'provider unavailable',response:()=>Response.json({error:{message:'Synthetic provider failure'}},{status:503})},
  {name:'invalid tool JSON',response:()=>Response.json({...base,output:[{type:'function_call',id:'fc_1',call_id:'call_1',name:'update_setup_draft',arguments:'{broken'}]})},
  {name:'invalid tool values',response:()=>Response.json({...base,output:[{type:'function_call',id:'fc_1',call_id:'call_1',name:'update_setup_draft',arguments:JSON.stringify({expectedRevision:0,patch:{rules:{timezone:'fake/timezone'}},unresolved:[]})}]})},
  {name:'valid partial draft',response:()=>Response.json({...base,output:[{type:'function_call',id:'fc_1',call_id:'call_1',name:'update_setup_draft',arguments:JSON.stringify({expectedRevision:0,patch:{rules:{timezone:'Asia/Seoul',bufferMinutes:10}},unresolved:[]})}]})},
 ];
 try{
  for(const scenario of cases){
   let executions=0,reservations=0,requests=0;
   globalThis.fetch=async(url)=>{assert.equal(String(url),'https://api.openai.com/v1/responses');requests++;return scenario.response();};
   const raw=openai('gpt-6-luna');assert.notEqual(typeof raw,'string');
   const model=boundedModel(raw as Parameters<typeof boundedModel>[0],async()=>{reservations++;});
   const outcome=await Promise.allSettled([generateText({model,prompt:'Suggest setup preferences',maxRetries:0,tools:{update_setup_draft:{description:'Suggest unconfirmed preferences',inputSchema:assistantDraftInput,execute:async(input)=>{executions++;assert.deepEqual(input,{expectedRevision:0,patch:{rules:{timezone:'Asia/Seoul',bufferMinutes:10}},unresolved:[]});return {revision:1};}}}})]);
   assert.equal(executions,scenario.name==='valid partial draft'?1:0,scenario.name);assert.equal(reservations,1,scenario.name);assert.equal(requests,1,scenario.name);
   if(scenario.name==='invalid response JSON'||scenario.name==='provider unavailable')assert.equal(outcome[0].status,'rejected',scenario.name);
   if(scenario.name==='valid partial draft')assert.equal(outcome[0].status,'fulfilled',scenario.name);
   if(scenario.name==='refusal'&&outcome[0].status==='fulfilled'){assert.equal(outcome[0].value.toolCalls.length,0);assert.equal(outcome[0].value.text,'');}
  }
 }finally{globalThis.fetch=originalFetch;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;}
});

test('installed Responses adapter preserves requester advisory boundaries and rejects unsafe extraction',async()=>{
 const originalFetch=globalThis.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture-only';
 const {requestExtractionInput}=await import('../../contracts/conversation-tools.ts');
 const base={id:'resp_fixture',object:'response',created_at:1,status:'completed',model:'gpt-6-luna',usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}},incomplete_details:null};
 const valid={intent:'details',expectedRevision:2,patch:{purpose:'Discuss research',mode:'in_person',location:'Library',windows:[{start:'2030-06-01T09:00:00+09:00',end:'2030-06-01T10:00:00+09:00'}]},clarifications:[]};
 const cases=[
  {name:'refusal',output:[{type:'message',id:'msg_1',role:'assistant',content:[{type:'refusal',refusal:'Cannot provide a suggestion'}]}]},
  ...[
   {name:'invalid tool JSON',args:'{broken'},
   {name:'ambiguous dates',args:JSON.stringify({...valid,patch:{windows:[{start:'2030-06-01T09:00',end:'2030-06-01T10:00'}]}})},
   {name:'impossible date',args:JSON.stringify({...valid,patch:{windows:[{start:'2030-02-30T09:00:00Z',end:'2030-02-30T10:00:00Z'}]}})},
   {name:'injected authority',args:JSON.stringify({...valid,approved:true,command:'calendar.insert'})},
   {name:'nested authority',args:JSON.stringify({...valid,patch:{...valid.patch,agreed:true}})},
   {name:'question with patch',args:JSON.stringify({...valid,intent:'question'})},
   {name:'unknown with patch',args:JSON.stringify({...valid,intent:'unknown'})},
   {name:'missing intent',args:JSON.stringify({...valid,intent:undefined})},
   {name:'English false claim',args:JSON.stringify({...valid,clarifications:['The meeting is booked and approved.']})},
   {name:'Korean false claim',args:JSON.stringify({...valid,clarifications:['예약이 완료되었습니다.']})},
   {name:'valid advisory review',args:JSON.stringify(valid)},
   {name:'valid clarification',args:JSON.stringify({...valid,intent:'question',patch:{},clarifications:['timezone']})},
  ].map(item=>({name:item.name,output:[{type:'function_call',id:'fc_1',call_id:'call_1',name:'propose_request_details',arguments:item.args}]})),
 ];
 try{
  for(const scenario of cases){
   let executions=0,reservations=0,requests=0;
   globalThis.fetch=async(url)=>{assert.equal(String(url),'https://api.openai.com/v1/responses');requests++;return Response.json({...base,output:scenario.output});};
   const raw=openai('gpt-6-luna');assert.notEqual(typeof raw,'string');
   const model=boundedModel(raw as Parameters<typeof boundedModel>[0],async()=>{reservations++;});
   const outcome=await Promise.allSettled([generateText({model,prompt:'Suggest requester scheduling details',maxRetries:0,tools:{propose_request_details:{description:'Propose a review for explicit requester application',inputSchema:requestExtractionInput,execute:async(input)=>{executions++;assert.deepEqual(input,scenario.name==='valid clarification'?{...valid,intent:'question',patch:{},clarifications:['timezone']}:valid);return {review:{status:'pending'}};}}}})]);
   assert.equal(executions,scenario.name.startsWith('valid ')?1:0,scenario.name);
   assert.equal(requests,1,scenario.name);assert.equal(reservations,1,scenario.name);
   if(scenario.name.startsWith('valid '))assert.equal(outcome[0].status,'fulfilled');
   if(scenario.name==='refusal'&&outcome[0].status==='fulfilled'){assert.equal(outcome[0].value.toolCalls.length,0);assert.equal(outcome[0].value.text,'');}
  }
 }finally{globalThis.fetch=originalFetch;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;}
});

test('reported generation usage is durable before exposing a successful result',async()=>{
 let release!:()=>void,entered!:()=>void,returned=false;
 const recording=new Promise<void>(resolve=>{entered=resolve;});
 const model=boundedModel(fixture(),async()=>({complete:async usage=>{assert.deepEqual(usage,answer.usage);entered();await new Promise<void>(resolve=>{release=resolve;});},failed:async()=>{assert.fail('successful result cannot be recorded as zero failure');}}));
 const pending=model.doGenerate({prompt}).then(result=>{returned=true;return result;});
 await recording;assert.equal(returned,false);release();assert.deepEqual(await pending,answer);
});

test('uncertain successful usage recording fails closed without converting it to zero',async()=>{
 let failed=0;
 const model=boundedModel(fixture(),async()=>({complete:async()=>{throw new ApplicationError('PROVIDER_UNAVAILABLE',503);},failed:async()=>{failed++;}}));
 await assert.rejects(model.doGenerate({prompt}),{code:'PROVIDER_UNAVAILABLE'});assert.equal(failed,0);
});

test('stream completion waits for reported usage, while setup failure records no reported tokens',async()=>{
 let complete=0,failed=0;
 const receipt={complete:async(usage:unknown)=>{assert.deepEqual(usage,answer.usage);complete++;},failed:async()=>{failed++;}};
 const provider=fixture({doStream:async()=>({stream:new ReadableStream({start(controller){controller.enqueue({type:'finish',finishReason:answer.finishReason,usage:answer.usage});controller.close();}})})});
 const response=await boundedModel(provider,async()=>receipt).doStream({prompt});
 const event=await response.stream.getReader().read();assert.equal(event.value?.type,'finish');assert.equal(complete,1);assert.equal(failed,0);
 const broken=fixture({doStream:async()=>{throw new APICallError({message:'private',url:'https://api.openai.com',requestBodyValues:{},statusCode:401,isRetryable:false});}});
 await assert.rejects(boundedModel(broken,async()=>receipt).doStream({prompt}),configurationUnavailable);assert.equal(failed,1);
});

test('configuration stream failure records no reported usage only before any generated output',async()=>{
 for(const partial of [false,true]){
  let failed=0;
  const error=new APICallError({message:'private upstream',url:'https://api.openai.com',requestBodyValues:{},statusCode:401,isRetryable:false});
  const provider=fixture({doStream:async()=>({stream:new ReadableStream({start(controller){
   if(partial)controller.enqueue({type:'text-delta',id:'text',delta:'partial response'});
   controller.enqueue({type:'error',error});controller.close();
  }})})});
  const model=boundedModel(provider,async()=>({complete:async()=>{assert.fail('failure has no complete usage');},failed:async()=>{failed++;}}));
  const reader=(await model.doStream({prompt})).stream.getReader();
  if(partial)assert.equal((await reader.read()).value?.type,'text-delta');
  const result=(await reader.read()).value;assert.ok(result?.type==='error'&&configurationUnavailable(result.error));
  assert.equal(failed,partial?0:1,'partial output remains unresolved instead of being assigned zero usage');
 }
});

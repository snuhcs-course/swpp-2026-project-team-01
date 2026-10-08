import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {generateText} from 'ai';
import {OpenAIRanking,validateRanking,type RankingInput} from './ranking.ts';
import {ApplicationError} from '../errors.ts';
const ids=[randomUUID(),randomUUID()],candidates=ids.map((id,i)=>({id,interval:{start:`2030-01-01T1${i}:00:00Z`,end:`2030-01-01T1${i}:30:00Z`}}));
const unavailable=(error:unknown)=>error instanceof ApplicationError&&error.code==='PROVIDER_UNAVAILABLE';
test('Ranking is an exact ID permutation and cannot invent intervals, omit slots or waive constraints',()=>{
 assert.deepEqual(validateRanking({orderedIds:[...ids].reverse()},candidates),{orderedIds:[...ids].reverse()});
 for(const value of [{orderedIds:[ids[0],ids[0]]},{orderedIds:[ids[0]]},{orderedIds:[...ids,randomUUID()]},{orderedIds:[ids[0],randomUUID()]},{orderedIds:ids,intervals:[]},{orderedIds:ids,waive:true},null])assert.throws(()=>validateRanking(value,candidates),unavailable);
 assert.deepEqual(validateRanking({orderedIds:[]},[]),{orderedIds:[]});
});
test('Direct ranking bounds model calls and rejects refusal, truncation, multiple calls and invalid output',async()=>{
 const key=process.env.OPENAI_API_KEY,model=process.env.OPENAI_MODEL;process.env.OPENAI_API_KEY='fixture-key';process.env.OPENAI_MODEL='gpt-6-luna';
 let response:unknown={finishReason:'tool-calls',toolCalls:[{toolName:'rank_candidates',input:{orderedIds:ids}}]},calls=0;
 const fake=(async(options:Parameters<typeof generateText>[0])=>{calls++;assert.equal(options.maxRetries,0);assert.equal(options.maxOutputTokens,2048);assert.ok(options.abortSignal);assert.deepEqual(options.toolChoice,{type:'tool',toolName:'rank_candidates'});assert.equal(options.prompt,JSON.stringify({timezone:'UTC',candidates}));assert.ok(!JSON.stringify(options).includes('Private host reason'));return response;}) as typeof generateText;
 try{
  const provider=new OpenAIRanking(fake),input:RankingInput={timezone:'UTC',candidates};
  assert.deepEqual(await provider.rank(input,async()=>{}),{orderedIds:ids});
  for(const value of [{finishReason:'stop',toolCalls:[]},{finishReason:'length',toolCalls:[{toolName:'rank_candidates',input:{orderedIds:ids}}]},{finishReason:'tool-calls',toolCalls:[{toolName:'rank_candidates',input:{orderedIds:ids}},{toolName:'rank_candidates',input:{orderedIds:ids}}]},{finishReason:'tool-calls',toolCalls:[{toolName:'rank_candidates',input:{orderedIds:[randomUUID()]}}]}]){response=value;await assert.rejects(provider.rank(input,async()=>{}),unavailable);}
  const before=calls;assert.deepEqual(await provider.rank({timezone:'UTC',candidates:[]},async()=>{}),{orderedIds:[]});assert.equal(calls,before);
 }finally{if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;if(model===undefined)delete process.env.OPENAI_MODEL;else process.env.OPENAI_MODEL=model;}
});

test('Direct ranking reserves before the real Responses adapter and preserves allowance denial',async()=>{
 const key=process.env.OPENAI_API_KEY,model=process.env.OPENAI_MODEL,fetcher=globalThis.fetch;
 process.env.OPENAI_API_KEY='fixture-key';process.env.OPENAI_MODEL='gpt-6-luna';let requests=0,reservations=0;
 globalThis.fetch=async(url,init)=>{
  requests++;assert.equal(reservations,1);assert.equal(String(url),'https://api.openai.com/v1/responses');
  const body=JSON.parse(String(init?.body));assert.equal(body.max_output_tokens,2048);assert.equal(body.service_tier,'default');assert.equal(body.store,false);
  return Response.json({id:'resp_fixture',object:'response',created_at:1,status:'completed',model:'gpt-6-luna',output:[{type:'function_call',id:'fc_1',call_id:'call_1',name:'rank_candidates',arguments:JSON.stringify({orderedIds:ids}),status:'completed'}],usage:{input_tokens:10,output_tokens:10,total_tokens:20,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}});
 };
 try{
  const provider=new OpenAIRanking(),input:RankingInput={timezone:'UTC',candidates};
  assert.deepEqual(await provider.rank(input,async()=>{reservations++;}),{orderedIds:ids});
  await assert.rejects(provider.rank(input,async()=>{throw new ApplicationError('MODEL_LIMIT',429);}),{code:'MODEL_LIMIT'});
  assert.equal(requests,1);assert.equal(reservations,1);
 }finally{globalThis.fetch=fetcher;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;if(model===undefined)delete process.env.OPENAI_MODEL;else process.env.OPENAI_MODEL=model;}
});

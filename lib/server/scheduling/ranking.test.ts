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
  assert.deepEqual(await provider.rank(input),{orderedIds:ids});
  for(const value of [{finishReason:'stop',toolCalls:[]},{finishReason:'length',toolCalls:[{toolName:'rank_candidates',input:{orderedIds:ids}}]},{finishReason:'tool-calls',toolCalls:[{toolName:'rank_candidates',input:{orderedIds:ids}},{toolName:'rank_candidates',input:{orderedIds:ids}}]},{finishReason:'tool-calls',toolCalls:[{toolName:'rank_candidates',input:{orderedIds:[randomUUID()]}}]}]){response=value;await assert.rejects(provider.rank(input),unavailable);}
  const before=calls;assert.deepEqual(await provider.rank({timezone:'UTC',candidates:[]}),{orderedIds:[]});assert.equal(calls,before);
 }finally{if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;if(model===undefined)delete process.env.OPENAI_MODEL;else process.env.OPENAI_MODEL=model;}
});

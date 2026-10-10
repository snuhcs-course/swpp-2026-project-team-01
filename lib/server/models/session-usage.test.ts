import test from 'node:test';
import assert from 'node:assert/strict';
import {captureModelUsage,initialModelUsage} from './session-usage.ts';
const usage={inputTokens:100,outputTokens:10,cacheReadTokens:20,cacheWriteTokens:5};
const step={turnId:'turn_0',sequence:1,stepIndex:0,usage};
test('checkpointed usage adds each step once across turns and restart serialization',()=>{
 const state=initialModelUsage();captureModelUsage(state,step);captureModelUsage(state,step);
 assert.deepEqual(state.total,usage);
 const restarted=JSON.parse(JSON.stringify(state));
 captureModelUsage(restarted,step);captureModelUsage(restarted,{...step,turnId:'turn_1'});
 assert.deepEqual(restarted.total,{inputTokens:200,outputTokens:20,cacheReadTokens:40,cacheWriteTokens:10});
 captureModelUsage(restarted,{...step,turnId:'turn_1',stepIndex:1});
 assert.equal(restarted.total.inputTokens,300);
});
test('missing, partial, unsafe and conflicting usage cannot become fresh zero counters',()=>{
 for(const invalid of [undefined,{}, {...usage,inputTokens:-1},{...usage,inputTokens:0.5},{...usage,outputTokens:Infinity}]){
  const state=initialModelUsage();captureModelUsage(state,{...step,usage:invalid});assert.equal(state.total,null);
  captureModelUsage(state,step);assert.equal(state.total,null,'later valid data cannot erase unknown history');
 }
 const state=initialModelUsage();captureModelUsage(state,step);captureModelUsage(state,{...step,usage:{...usage,inputTokens:101}});
 assert.equal(state.total,null);
 const overflow=initialModelUsage();captureModelUsage(overflow,{...step,usage:{...usage,inputTokens:Number.MAX_SAFE_INTEGER}});
 captureModelUsage(overflow,{...step,stepIndex:1});assert.equal(overflow.total,null);
 assert.doesNotThrow(()=>captureModelUsage(undefined,step),'old checkpoints are never initialized from a partial later step');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {providerTokenUsage} from './model-usage-receipt.ts';
test('provider receipts require complete safe totals and preserve cache counts',()=>{
 assert.deepEqual(providerTokenUsage({inputTokens:{total:12,cacheRead:4,cacheWrite:2},outputTokens:{total:3}}),{inputTokens:12,outputTokens:3,cacheReadTokens:4,cacheWriteTokens:2});
 for(const usage of [null,{}, {inputTokens:{},outputTokens:{total:1}},{inputTokens:{total:1},outputTokens:{}},
  ...[-1,0.1,Infinity,Number.MAX_SAFE_INTEGER+1].map(total=>({inputTokens:{total},outputTokens:{total:1}}))])assert.throws(()=>providerTokenUsage(usage),{code:'MODEL_LIMIT'});
});

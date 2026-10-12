import assert from 'node:assert/strict';
import type {Page} from '@playwright/test';
export async function nonPresentationLocalKeys(page:Page){
 const entries=await page.evaluate(()=>Object.entries(localStorage));
 for(const [key,value] of entries.filter(([key])=>key.startsWith('fmat:seen-prose:'))){
  assert.match(key,/^fmat:seen-prose:[0-9a-f-]{36}$/u);
  const hashes=JSON.parse(value);assert.ok(Array.isArray(hashes)&&hashes.length<=128);
  for(const hash of hashes)assert.match(hash,/^[0-9a-f]{64}$/u);
 }
 return entries.map(([key])=>key).filter(key=>!key.startsWith('fmat:seen-prose:'));
}

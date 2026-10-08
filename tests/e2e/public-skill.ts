import assert from 'node:assert/strict';
import type {APIRequestContext} from '@playwright/test';
export async function verifyPublicSkill(request:APIRequestContext,origin:string,handle:string){
 for(const [path,status] of [['/SKILL.md',200],['/'+handle+'/SKILL.md',200],['/missing-skill-host/SKILL.md',404],['/BAD/SKILL.md',404],['/mcp/SKILL.md',404],['/oauth/SKILL.md',404]] as const){
  const response=await request.get(origin+path+'?next=https://evil.test',{headers:{'x-forwarded-host':'evil.test'}});assert.equal(response.status(),status);const body=await response.text();
  assert.match(response.headers()['content-type'],/text\/markdown/);assert.equal(response.headers()['cache-control'],'no-store');assert.equal(response.headers()['set-cookie'],undefined);assert.ok(!body.includes('evil.test'));
  if(status===200){assert.ok(body.includes('Instruction version:'));assert.ok(body.includes(origin));assert.ok(body.includes('not yet available'));}
  const head=await request.head(origin+path);assert.equal(head.status(),status);assert.equal((await head.body()).length,0);assert.equal(head.headers()['cache-control'],'no-store');
 }
 for(const name of ['mcp','oauth']){assert.equal((await request.get(origin+'/'+name)).status(),404);assert.equal((await request.post(origin+'/'+name,{data:{jsonrpc:'2.0',id:1,method:'initialize'}})).status(),404);}
 assert.equal((await request.post(origin+'/SKILL.md',{data:{approved:true}})).status(),405);
}

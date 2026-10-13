import test from 'node:test';
import assert from 'node:assert/strict';
import {publicHandle} from './intake.ts';
import {setupPatch} from './setup.ts';
test('Public intake and setup share protocol and application namespace exclusions',()=>{
 for(const handle of ['mcp','oauth','app','auth','api','connect','connections','booking','host','requests','operator','skills','favicon','robots','sitemap','_next']){
  assert.equal(publicHandle.safeParse(handle).success,false,handle);
  assert.equal(setupPatch.safeParse({handle}).success,false,handle);
 }
 for(const handle of ['mcp-team','oauth-demo','dodo','abc','a'.repeat(40)]){
  assert.equal(publicHandle.parse(handle),handle);assert.equal(setupPatch.parse({handle}).handle,handle);
 }
 for(const handle of ['', 'ab','MCP','%6dcp','mcp/extra',' mcp','mcp ','a'.repeat(41)])assert.equal(publicHandle.safeParse(handle).success,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {checkClientBoundaries} from './check-client-boundaries.mjs';
function fixture(t,entries){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fmat-boundaries-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const [name,content] of Object.entries(entries)){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
 return root;
}
test('browser graph follows alias barrels, cycles and dynamic imports to server code',t=>{
 const root=fixture(t,{
  'apps/web/components/chat.tsx':"'use client'; import {run} from '@web/lib/barrel'; export const Chat=()=> <button onClick={run}/>;",
  'apps/web/lib/barrel.ts':"export {run} from './action';",
  'apps/web/lib/action.ts':"import './barrel'; export const run=()=>import('../../../lib/server/secret.ts');",
  'lib/server/secret.ts':"export const value=process.env.OPENAI_API_KEY;",
 });
 const result=checkClientBoundaries(root);assert.equal(result.violations.length,1);assert.deepEqual(result.violations[0].chain,['apps/web/components/chat.tsx','apps/web/lib/barrel.ts','apps/web/lib/action.ts','lib/server/secret.ts']);
});
test('standalone shared contracts cannot pull in a privileged module even without a client importer',t=>{
 const root=fixture(t,{'lib/contracts/shared.ts':"export * from '../server/secret';",'lib/server/secret.ts':'export const secret=1;'});
 assert.equal(checkClientBoundaries(root).violations.length,1);
});
test('type-only imports and public variables remain valid; comments are not imports',t=>{
 const root=fixture(t,{
  'apps/web/components/chat.tsx':"'use client'; import type {Secret} from '../../../lib/server/secret'; import {type Other} from '../../../lib/server/other'; export {type Other} from '../../../lib/server/other'; /* import 'server-only'; process.env.SECRET */ const example=\"process.env.SECRET\"; export const mode=process.env.NODE_ENV; export const api=process.env['NEXT_PUBLIC_API'];",
  'lib/contracts/shared.ts':"export type {Secret} from '../server/secret';",
 });
 assert.deepEqual(checkClientBoundaries(root).violations,[]);
});
test('private environment reads, builtins and unresolvable dynamic targets fail closed',t=>{
 for(const code of ["import 'server-only';","import 'fs';","import('node:crypto');","require('node:fs');","const x=process.env.OPENAI_API_KEY;","const x=process.env['SUPABASE_SECRET_KEY'];","const x={...process.env};","const x=process.env[name];","import(name);","import './missing';"]){
  const root=fixture(t,{'apps/web/components/chat.tsx':"'use client'; "+code});
  assert.equal(checkClientBoundaries(root).violations.length,1,code);
 }
});

test('a test-named module imported at runtime cannot hide a server dependency',t=>{
 const root=fixture(t,{
  'apps/web/components/chat.tsx':"'use client'; import '../lib/helper.test.ts';",
  'apps/web/lib/helper.test.ts':"import '../../../lib/server/secret.ts';",
  'lib/server/secret.ts':'export const secret=1;',
 });
 const result=checkClientBoundaries(root);assert.equal(result.violations.length,1);assert.equal(result.violations[0].chain.length,3);
});

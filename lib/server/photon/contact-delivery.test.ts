import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dispatchContactShares} from './contact-delivery.ts';
import {ApplicationError} from '../errors.ts';

const project=randomUUID(),env={PHOTON_PROJECT_ID:project},phone='+15550100001';
const intent=()=>({action:'send',shareId:randomUUID(),projectId:project,leaseToken:randomUUID(),phone,line:'shared',spaceId:'any;-;'+phone});
function fixture(items:unknown[]=[intent()]){
 const calls:{operation:unknown;input:any}[]=[];
 let dispatch:()=>Promise<unknown>=async()=>({authorized:true});
 let finish:()=>Promise<unknown>=async()=>({});
 const database={async rpc(_name:string,parameters:Record<string,unknown>){assert.equal(parameters.p_project_id,project);calls.push({operation:parameters.p_operation,input:parameters.p_input});if(parameters.p_operation==='claim')return items.shift()??{action:'idle'};return parameters.p_operation==='dispatch'?dispatch():finish();}};
 return {database,calls,setDispatch:(fn:typeof dispatch)=>{dispatch=fn;},setFinish:(fn:typeof finish)=>{finish=fn;}};
}
test('native worker marks dispatch after provider preflight and records acknowledgement once',async()=>{
 const item=intent(),f=fixture([item]);let shares=0;
 const result=await dispatchContactShares(f.database,env,{async shareContact(route,recipient,authorize){assert.deepEqual(route,{line:item.line,spaceId:item.spaceId});assert.equal(recipient,phone);assert.ok(!f.calls.some(c=>c.operation==='dispatch'));await authorize();shares++;return {status:'accepted'};}});
 assert.deepEqual(result,{claimed:1,recovered:0,recorded:1});assert.equal(shares,1);
 assert.deepEqual(f.calls.at(-1),{operation:'finish',input:{shareId:item.shareId,leaseToken:item.leaseToken,status:'accepted'}});
});
test('native worker separates preflight failure from an ambiguous native operation',async()=>{
 for(const after of [false,true]){
  const f=fixture();await dispatchContactShares(f.database,env,{async shareContact(_route,_phone,authorize){if(after)await authorize();throw Error('private provider sentinel');}});
  assert.equal(f.calls.at(-1)!.input.status,after?'uncertain':'retry');assert.ok(!JSON.stringify(f.calls).includes('sentinel'));
 }
 const f=fixture();await dispatchContactShares(f.database,env,{async shareContact(){return {status:'failed'};}});
 assert.equal(f.calls.at(-1)!.input.status,'failed');assert.ok(!f.calls.some(c=>c.operation==='dispatch'));
});
test('unknown dispatch acknowledgement leaves persisted recovery to decide and never calls the provider',async()=>{
 const f=fixture();let shares=0;f.setDispatch(async()=>{throw new ApplicationError('PROVIDER_UNAVAILABLE',503);});
 assert.deepEqual(await dispatchContactShares(f.database,env,{async shareContact(_r,_p,authorize){await authorize();shares++;return {status:'accepted'};}}),{claimed:1,recovered:0,recorded:0});
 assert.equal(shares,0);assert.ok(!f.calls.some(c=>c.operation==='finish'));
});
test('revoked dispatch is already persisted and lost finish does not fabricate recorded success',async()=>{
 const revoked=fixture();let shares=0;revoked.setDispatch(async()=>({authorized:false}));
 assert.equal((await dispatchContactShares(revoked.database,env,{async shareContact(_r,_p,authorize){await authorize();shares++;return {status:'accepted'};}})).recorded,1);
 assert.equal(shares,0);assert.ok(!revoked.calls.some(c=>c.operation==='finish'));
 const lost=fixture();lost.setFinish(async()=>{throw Error('private finish failure');});
 assert.equal((await dispatchContactShares(lost.database,env,{async shareContact(_r,_p,authorize){await authorize();shares++;return {status:'accepted'};}})).recorded,0);assert.equal(shares,1);
});
test('worker is bounded, preserves recovered terminal outcomes and refuses a transferred route',async()=>{
 const f=fixture(Array.from({length:8},()=>({action:'uncertain'})));let shares=0;
 assert.deepEqual(await dispatchContactShares(f.database,env,{async shareContact(){shares++;return {status:'accepted'};}}),{claimed:0,recovered:5,recorded:0});assert.equal(f.calls.length,5);
 const bad=fixture([{...intent(),projectId:randomUUID()}]);
 await dispatchContactShares(bad.database,env,{async shareContact(){shares++;return {status:'accepted'};}});assert.equal(shares,0);assert.equal(bad.calls.at(-1)!.input.status,'revoked');
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {EvaluationBudget,evaluationBudgetMs,type BudgetClock} from './budget.ts';
import {ApplicationError} from '../errors.ts';
function fixture(){
 let now=0;const timers=new Map<symbol,{at:number;callback:()=>void}>();
 const clock:BudgetClock={now:()=>now,schedule(callback,delayMs){const id=Symbol();timers.set(id,{at:now+delayMs,callback});return ()=>{timers.delete(id);};}};
 return {clock,timers,advance(ms:number,fire=true){now+=ms;if(fire)for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}}};
}
const expired=(error:unknown)=>error instanceof ApplicationError&&error.code==='PROVIDER_UNAVAILABLE'&&error.status===503;
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

test('Evaluation has one 18-second budget across operations and rejects the exact boundary before work',async()=>{
 const f=fixture(),budget=new EvaluationBudget(f.clock);let calls=0;
 assert.equal(evaluationBudgetMs,18000);assert.equal(f.timers.size,1);
 assert.equal(await budget.run(()=>++calls),1);f.advance(17999);
 assert.equal(await budget.run(()=>++calls),2);assert.equal(f.timers.size,1);
 f.advance(1,false);await assert.rejects(budget.run(()=>++calls),expired);
 assert.equal(calls,2);assert.equal(budget.signal.aborted,true);assert.equal(f.timers.size,0);
 budget.dispose();
});

test('Deadline stops waiting for non-cooperative work and ignores late resolution and rejection',async()=>{
 for(const late of ['resolve','reject','never'] as const){
  const f=fixture(),budget=new EvaluationBudget(f.clock),work=deferred<string>();let signal:AbortSignal|undefined,continued=false;
  const pending=budget.run(s=>{signal=s;return work.promise;}).then(()=>{continued=true;});
  const rejected=assert.rejects(pending,expired);assert.equal(getEventListeners(budget.signal,'abort').length,1);
  f.advance(18000);await rejected;assert.equal(signal?.aborted,true);
  if(late==='resolve')work.resolve('private late result');if(late==='reject')work.reject(new Error('private late failure'));
  await Promise.resolve();await Promise.resolve();assert.equal(continued,false);assert.equal(getEventListeners(budget.signal,'abort').length,0);assert.equal(f.timers.size,0);
  budget.dispose();
 }
});

test('Elapsed expiry rejects completed work even when timer delivery is delayed',async()=>{
 const f=fixture(),budget=new EvaluationBudget(f.clock);
 await assert.rejects(budget.run(()=>{f.advance(18000,false);return 'late';}),expired);
 assert.equal(budget.signal.aborted,true);budget.dispose();
});

test('Success and provider errors release listeners; disposal cancels outstanding waits and denies reuse',async()=>{
 const f=fixture(),budget=new EvaluationBudget(f.clock),failure=new Error('provider failure');
 assert.equal(await budget.run(()=>42),42);
 await assert.rejects(budget.run(()=>{throw failure;}),error=>error===failure);
 await assert.rejects(budget.run(()=>Promise.reject(failure)),error=>error===failure);
 assert.equal(getEventListeners(budget.signal,'abort').length,0);
 const pending=assert.rejects(budget.run(()=>new Promise(()=>{})),expired);
 budget.dispose();budget.dispose();await pending;
 assert.equal(f.timers.size,0);assert.equal(getEventListeners(budget.signal,'abort').length,0);
 await assert.rejects(budget.run(()=>{throw new Error('Must not execute');}),expired);
});

test('Concurrent invocations keep independent deadlines and cannot renew an older budget',async()=>{
 const f=fixture(),first=new EvaluationBudget(f.clock);f.advance(9000);const second=new EvaluationBudget(f.clock);
 const stopped=assert.rejects(first.run(()=>new Promise(()=>{})),expired);f.advance(9000);await stopped;
 assert.equal(await second.run(()=>true),true);assert.equal(second.signal.aborted,false);
 f.advance(9000);await assert.rejects(second.run(()=>true),expired);
 first.dispose();second.dispose();assert.equal(f.timers.size,0);
});

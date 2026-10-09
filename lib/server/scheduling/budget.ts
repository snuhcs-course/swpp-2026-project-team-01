import {ApplicationError} from '../errors.ts';

export const evaluationBudgetMs=18_000;
export interface BudgetClock {
 now():number;
 schedule(callback:()=>void,delayMs:number):()=>void;
}
const clock:BudgetClock={
 now:()=>performance.now(),
 schedule(callback,delayMs){const timer=setTimeout(callback,delayMs);return ()=>clearTimeout(timer);},
};
const unavailable=()=>new ApplicationError('PROVIDER_UNAVAILABLE',503);

/** One invocation owns and disposes this budget; nested work only borrows it.
 * Cancellation stops waiting, not already committed remote effects. Callers
 * must pass the signal downstream and guard every later mutation with run(). */
export class EvaluationBudget {
 private readonly controller=new AbortController();
 private readonly deadline:number;
 private cancelTimer:()=>void=()=>{};
 private disposed=false;
 readonly signal=this.controller.signal;
 constructor(private readonly timing:BudgetClock=clock){
  this.deadline=timing.now()+evaluationBudgetMs;
  this.cancelTimer=timing.schedule(()=>this.expire(),evaluationBudgetMs);
 }
 private expire(){this.cancelTimer();this.controller.abort(unavailable());}
 assertActive(){
  if(this.disposed||this.timing.now()>=this.deadline)this.expire();
  if(this.signal.aborted)throw unavailable();
 }
 async run<T>(operation:(signal:AbortSignal)=>Promise<T>|T):Promise<T>{
  this.assertActive();
  return new Promise<T>((resolve,reject)=>{
   const abort=()=>{cleanup();reject(unavailable());};
   const cleanup=()=>this.signal.removeEventListener('abort',abort);
   this.signal.addEventListener('abort',abort,{once:true});
   // Invoke synchronously after the admission check. Both settlement handlers
   // stay attached even when cancellation wins, absorbing late rejection.
   let work:Promise<T>;
   try{work=Promise.resolve(operation(this.signal));}
   catch(error){cleanup();try{this.assertActive();reject(error);}catch(expired){reject(expired);}return;}
   work.then(value=>{
    cleanup();try{this.assertActive();resolve(value);}catch(error){reject(error);}
   },error=>{
    cleanup();try{this.assertActive();reject(error);}catch(expired){reject(expired);}
   });
  });
 }
 dispose(){
  if(this.disposed)return;
  this.disposed=true;this.expire();
 }
}

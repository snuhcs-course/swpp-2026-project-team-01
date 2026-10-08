// Isolated, disposable-local-only worker used by booking-crashes.ts.
import assert from 'node:assert/strict';
import {Database} from '../../lib/server/database/client.ts';
import {BookingWorker} from '../../lib/server/booking/worker.ts';
import {AvailabilityEvaluation} from '../../lib/server/scheduling/availability.ts';
import {GoogleBookingProvider} from '../../lib/server/calendar/booking.ts';

assert.ok(process.send,'Crash fixture requires its parent IPC channel');
assert.equal(new URL(process.env.SUPABASE_URL!).hostname,'127.0.0.1');
const providerOrigin=new URL(process.env.FMAT_TEST_PROVIDER!);assert.equal(providerOrigin.hostname,'127.0.0.1');assert.equal(providerOrigin.protocol,'http:');
async function checkpoint(point:string){
 if(process.env.FMAT_TEST_CRASH!==point)return;
 await new Promise<never>(()=>{process.send!({fault:point},()=>process.kill(process.pid,'SIGKILL'));});
}
const database=new Database(process.env,async(url,init)=>{
 const name=new URL(String(url)).pathname.split('/').at(-1),body=JSON.parse(String(init?.body));
 const operation=name==='fmat_booking_dispatch'?'dispatch':name==='fmat_booking_worker'?body.p_operation:name==='fmat_booking_evaluation'?'evaluation_'+body.p_operation:'other';
 await checkpoint('before:'+operation);
 const response=await fetch(url,init);
 if(response.ok)await checkpoint('after:'+operation);
 return response;
});
const calendar={async refresh(bundle:import('../../lib/server/calendar/google.ts').TokenBundle){return {...bundle,expiresAt:Date.now()+3600000};},async list(){return [{id:'fixture-calendar',name:'fixture',accessRole:'owner' as const,primary:false,timeZone:'UTC',color:null}];}};
const provider=new GoogleBookingProvider(async(url,init)=>{
 const original=new URL(String(url));assert.equal(original.origin,'https://www.googleapis.com');
 const operation=init?.method==='POST'?'insert':'lookup';await checkpoint('before:'+operation);
 const response=await fetch(providerOrigin.origin+original.pathname+original.search,init);
 await checkpoint('after:'+operation);return response;
});
const worker=new BookingWorker(database,process.env,new AvailabilityEvaluation(database,process.env,calendar,{async read(){return [];}}),provider,calendar);
const result=await worker.run();process.send!({result},()=>process.exit(0));

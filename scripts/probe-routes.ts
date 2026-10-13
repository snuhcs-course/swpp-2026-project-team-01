import assert from 'node:assert/strict';
import {GoogleRoutes} from '../lib/server/routes/google.ts';
import {evaluateTravel,type TravelInput} from '../lib/server/scheduling/travel.ts';
// Exactly sixteen read-only, billable Routes requests with public landmarks.
// No Calendar reads, messaging, persisted scheduling state or booking writes.
async function main(){
if(!process.env.GOOGLE_MAPS_API_KEY)throw new Error('configuration');
const startedAt=new Date().toISOString(),base=Date.now()+86400000,at=(minutes:number)=>new Date(base+minutes*60000).toISOString();
const pairs=[{city:'Seoul',a:{latitude:37.5663,longitude:126.9779},b:{latitude:37.5547,longitude:126.9706}},{city:'New York',a:{latitude:40.7580,longitude:-73.9855},b:{latitude:40.7527,longitude:-73.9772}}];
const results=[];
for(const pair of pairs)for(const mode of ['DRIVE','TRANSIT','WALK','BICYCLE'] as const){
 const input:TravelInput={contextFingerprint:'a'.repeat(64),candidate:{start:at(120),end:at(150)},meetingMode:'in_person',location:pair.b,previous:{kind:'commitment',id:'public-landmark-before',interval:{start:at(-30),end:at(0)},location:pair.a},next:{kind:'commitment',id:'public-landmark-after',interval:{start:at(270),end:at(300)},location:pair.a},mode,bufferMinutes:10,travelBufferMinutes:15};
 const result=await evaluateTravel(input,new GoogleRoutes({GOOGLE_MAPS_API_KEY:process.env.GOOGLE_MAPS_API_KEY}));
 assert.equal(result.legs.length,2);
 for(const leg of result.legs){
  if(leg.estimate?.status==='success'){
   assert.equal(BigInt(leg.requiredNanoseconds!)-BigInt(leg.estimate.durationNanoseconds),15n*60n*1000000000n);
   assert.equal(BigInt(leg.availableNanoseconds!),110n*60n*1000000000n);
  }else assert.equal(leg.status,'clarification');
 }
 results.push({city:pair.city,mode,status:result.status,legs:result.legs.map(leg=>({direction:leg.direction,status:leg.status,reason:leg.reason,departure:leg.request?.departureTime,estimate:leg.estimate?.status,providerReason:leg.estimate&&'reason' in leg.estimate?leg.estimate.reason:undefined,durationNanoseconds:leg.estimate?.status==='success'?leg.estimate.durationNanoseconds:undefined,availableNanoseconds:leg.availableNanoseconds,requiredNanoseconds:leg.requiredNanoseconds}))});
}
const evidence={startedAt,completedAt:new Date().toISOString(),scope:'Local adapter plus actual travel evaluator; public landmarks, synthetic adjacent commitments; no Calendar or deployed booking acceptance',bufferMinutes:10,travelBufferMinutes:15,results};
console.log(JSON.stringify(evidence,null,2));
if(results.some(result=>result.legs.some(leg=>leg.estimate==='failure')))process.exitCode=1;
}
main().catch(()=>{console.error(JSON.stringify({error:'Routes probe could not complete; check server configuration and adapter assertions.'}));process.exitCode=1;});

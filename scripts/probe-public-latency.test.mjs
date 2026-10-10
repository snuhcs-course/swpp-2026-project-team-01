import test from 'node:test';
import assert from 'node:assert/strict';
import {probe,main,summarize} from './probe-public-latency.mjs';
const origin='https://release.findmeatime.com';
const fast={samples:2,pause:async()=>{}};
test('separates first requests and measures full-body nearest-rank percentiles',async()=>{
 assert.deepEqual(summarize([4,1,3,2]),{samples:4,minMs:1,medianMs:2,p95Ms:4,maxMs:4});
 let clock=0,calls=0;
 const result=await probe(origin,{...fast,now:()=>clock,fetcher:async(url,init)=>{
  calls++;assert.ok(url.startsWith(origin+'/'));assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'manual');assert.deepEqual(Object.keys(init.headers),['accept']);
  clock+=2;return new Response(new ReadableStream({pull(controller){clock+=3;controller.enqueue(new Uint8Array([1]));controller.close();}}));
 }});
 assert.equal(calls,12);assert.equal(result.releasePerformanceVerified,false);
 for(const route of result.results){assert.equal(route.firstRequestMs,5);assert.equal(route.repeated.samples,2);assert.equal(route.repeated.p95Ms,5);assert.deepEqual(route.failures,[]);}
});
test('redirect/error/oversized/stalled bodies fail without leaking payloads or repeating failures',async()=>{
 let calls=0;
 const result=await probe(origin,{...fast,deadlineMs:10,fetcher:async()=>{
  calls++;if(calls===1)return new Response('private sentinel',{status:302,headers:{location:'https://other.invalid'}});
  if(calls===2)throw Error('private sentinel');
  if(calls===3)return new Response(new Uint8Array(1048577));
  return new Response(new ReadableStream({pull(){return new Promise(()=>{});}}));
 }});
 assert.equal(result.results[0].failures[0].status,302);assert.equal(result.results[1].failures[0].status,null);
 assert.equal(calls,4);assert.deepEqual(result.results.map(r=>r.failures[0].code),['HTTP_STATUS','REQUEST_FAILED','BODY_LIMIT','DEADLINE']);
 assert.ok(!JSON.stringify(result).includes('sentinel'));assert.ok(!JSON.stringify(result).includes('other.invalid'));
});
test('invalid origins make no requests and unsuccessful probes exit nonzero',async()=>{
 let calls=0;const options={...fast,fetcher:async()=>{calls++;return new Response(null,{status:503});}};
 for(const target of ['http://localhost','https://user:password@example.com','https://example.com/path','https://example.com?token=secret'])assert.equal(await main(['--origin',target],()=>{},()=>{},options),1);
 assert.equal(calls,0);assert.equal(await main(['--origin',origin],()=>{},()=>{},options),1);assert.equal(calls,4);
});

test('edge challenges and rate limits stop all further traffic with explicit skipped routes',async()=>{
 for(const [status,headers,reason]of [[403,{'x-vercel-mitigated':'challenge'},'EDGE_CHALLENGE'],[429,{},'RATE_LIMIT']]){
  let calls=0;const result=await probe(origin,{...fast,fetcher:async()=>{calls++;return new Response('private challenge',{status,headers});}});
  assert.equal(calls,1);assert.equal(result.stopReason,reason);assert.deepEqual(result.skippedPaths,['/app','/api/health','/eve/v1/health']);assert.equal(result.results[0].failures[0].status,status);
 }
});

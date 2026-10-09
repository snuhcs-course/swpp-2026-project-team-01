import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';

const routes=['/','/app','/api/health','/eve/v1/health'];
const round=value=>Math.round(value*10)/10;
export function summarize(values){
 const sorted=[...values].sort((a,b)=>a-b);
 return {samples:sorted.length,minMs:round(sorted[0]),medianMs:round(sorted[Math.ceil(sorted.length*.5)-1]),p95Ms:round(sorted[Math.ceil(sorted.length*.95)-1]),maxMs:round(sorted.at(-1))};
}
function validOrigin(origin){try{const url=new URL(origin);return url.protocol==='https:'&&url.origin===origin&&!url.username&&!url.password;}catch{return false;}}
/** Sequential public GETs only. No credentials, redirects, raw bodies or error text in evidence. */
export async function probe(origin,{fetcher=fetch,now=()=>performance.now(),pause=()=>sleep(250),samples=20,deadlineMs=10000}={}){
 if(!validOrigin(origin)||!Number.isInteger(samples)||samples<1||samples>20)throw Error('INVALID_TARGET');
 const results=[];let stopReason=null;
 for(const path of routes){
  const timings=[],failures=[];let first=null;
  for(let index=0;index<=samples;index++){
   const controller=new AbortController(),start=now();let reader,status=null,mitigation=null;
   let timer;
   const request=(async()=>{
    const response=await fetcher(origin+path,{method:'GET',redirect:'manual',credentials:'omit',signal:controller.signal,headers:{accept:path.includes('health')?'application/json':'text/html'}});
    status=response.status;mitigation=response.headers.get('x-vercel-mitigated')==='challenge'?'challenge':null;reader=response.body?.getReader();
    if(response.status!==200)throw Error('HTTP_STATUS');
    let bytes=0;
    if(!reader)throw Error('EMPTY_BODY');
    while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>1048576)throw Error('BODY_LIMIT');}
    if(bytes===0)throw Error('EMPTY_BODY');
   })();
   try{
    await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('DEADLINE'));},deadlineMs);})]);
    const elapsed=now()-start;
    if(index===0)first=round(elapsed);else timings.push(elapsed);
   }catch(error){
    const code=['HTTP_STATUS','BODY_LIMIT','EMPTY_BODY','DEADLINE'].includes(error?.message)?error.message:'REQUEST_FAILED';
    failures.push({sample:index,code,status,mitigation});
    if(mitigation==='challenge'||status===429)stopReason=mitigation==='challenge'?'EDGE_CHALLENGE':'RATE_LIMIT';
   }finally{clearTimeout(timer);controller.abort();void reader?.cancel().catch(()=>{});}
   await pause();
   // A broken route is not a load-test target. Keep its failure and move on.
   if(failures.length)break;
  }
  results.push({path,firstRequestMs:first,repeated:timings.length?summarize(timings):null,failures});
  if(stopReason)break;
 }
 return {origin,observedAt:new Date().toISOString(),version:1,measurement:'client-observed full-response duration',concurrency:1,delayMs:250,requestDeadlineMs:deadlineMs,maxBodyBytes:1048576,releasePerformanceVerified:false,stopReason,skippedPaths:routes.slice(results.length),results};
}
export async function main(args,stdout=console.log,stderr=console.error,options){
 if(args.length!==2||args[0]!=='--origin'||!validOrigin(args[1])){stderr(JSON.stringify({code:'INVALID_ARGUMENTS'}));return 1;}
 const result=await probe(args[1],options);stdout(JSON.stringify(result));return result.results.some(route=>route.failures.length)?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await main(process.argv.slice(2));

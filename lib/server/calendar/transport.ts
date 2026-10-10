/** Signal races bound injected/non-cooperative transports as well as native fetch. */
export function providerSignal(shared:AbortSignal|undefined,timeoutMs:number){
 return AbortSignal.any([...(shared?[shared]:[]),AbortSignal.timeout(timeoutMs)]);
}
export async function abortable<T>(signal:AbortSignal,work:()=>Promise<T>,late?:(value:T)=>void):Promise<T>{
 signal.throwIfAborted();
 return new Promise<T>((resolve,reject)=>{
  const abort=()=>{cleanup();reject(signal.reason);};
  const cleanup=()=>signal.removeEventListener('abort',abort);
  signal.addEventListener('abort',abort,{once:true});
  let pending:Promise<T>;
  try{pending=work();}catch(error){cleanup();reject(error);return;}
  pending.then(value=>{cleanup();if(signal.aborted){late?.(value);reject(signal.reason);}else resolve(value);},error=>{cleanup();reject(signal.aborted?signal.reason:error);});
 });
}
function cancel(body:ReadableStream<Uint8Array>|null){void body?.cancel().catch(()=>{});}
export function providerFetch(fetcher:typeof fetch,url:URL|string,init:RequestInit,signal:AbortSignal){
 return abortable(signal,()=>fetcher(url,{...init,signal}),response=>cancel(response.body));
}
export async function providerBody(response:Response,signal:AbortSignal,maxBytes:number):Promise<Buffer>{
 if(signal.aborted){cancel(response.body);signal.throwIfAborted();}
 const reader=response.body?.getReader();if(!reader)throw new Error('Missing provider body');
 const stop=()=>{void reader.cancel().catch(()=>{});};
 signal.addEventListener('abort',stop,{once:true});
 let size=0;const chunks:Uint8Array[]=[];
 try{
  for(;;){const {done,value}=await abortable(signal,()=>reader.read());if(done)break;size+=value.byteLength;if(size>maxBytes){stop();throw new Error('Provider response too large');}chunks.push(value);}
  signal.throwIfAborted();return Buffer.concat(chunks);
 }finally{signal.removeEventListener('abort',stop);reader.releaseLock();}
}

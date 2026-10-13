/** Bound the complete response, including JSON body reads. Aborting a message
 * request does not prove nonacceptance; its caller must retain the same ID. */
export async function conversationJson(path:string,signal:AbortSignal,body?:unknown,timeoutMs=35_000) {
 const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),timeoutMs);
 try{
  const response=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',signal:AbortSignal.any([signal,deadline.signal]),
   headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.error?.message??'The conversation could not be loaded.'),{status:response.status,code:result.error?.code});
  return result;
 }finally{clearTimeout(timer);}
}

/** Only a known admission denial establishes a temporary wait. Network and
 * malformed failures still require the original idempotent retry identity. */
export function conversationSendFailure(error:unknown):string {
 const failure=error as {status?:number;code?:string}|null;
 if(failure?.status===429&&failure.code==='CONVERSATION_RATE_LIMIT')return 'Too many messages right now. Wait at least a minute, then retry this message. You can still use the meeting controls.';
 return 'The send could not be confirmed. Retry this same message to check its saved result.';
}

/** Bound the complete response, including JSON body reads. Aborting a message
 * request does not prove nonacceptance; its caller must retain the same ID. */
export async function conversationJson(path:string,signal:AbortSignal,body?:unknown,timeoutMs=35_000) {
 const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),timeoutMs);
 try{
  const response=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',signal:AbortSignal.any([signal,deadline.signal]),
   headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.error?.message??'The conversation could not be loaded.'),{status:response.status});
  return result;
 }finally{clearTimeout(timer);}
}

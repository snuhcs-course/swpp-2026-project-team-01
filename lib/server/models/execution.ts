import type {ModelUsageReceipt} from './model-usage-receipt.ts';
import {APICallError,LoadAPIKeyError,wrapLanguageModel} from 'ai';
import {ApplicationError} from '../errors.ts';

type Model = ReturnType<typeof wrapLanguageModel>;
type Call = Parameters<Model['doGenerate']>[0];
export const modelExecutionPolicy = Object.freeze({maxInputBytes:128 * 1024,maxOutputTokens:4096,timeoutMs:30_000});
const limited = () => new ApplicationError('MODEL_LIMIT',429);

const configurationCodes=new Set(['invalid_api_key','model_not_found','insufficient_quota','credit_balance_exhausted',
 'organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded']);

// Never retain an upstream cause: eve examines nested errors when deciding
// whether a failed turn must terminate its owning workflow. Transient retries
// still pass through the SDK and therefore require another durable reservation.
function providerFailure(error:unknown):Error {
 if(error instanceof ApplicationError)return error;
 if(LoadAPIKeyError.isInstance(error)||(error instanceof Error&&error.message.startsWith('Set OPENAI_API_KEY in the server environment')))
  return new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 if(APICallError.isInstance(error)){
  let code:unknown;
  if(typeof error.responseBody==='string'&&Buffer.byteLength(error.responseBody,'utf8')<=64*1024){
   try{code=JSON.parse(error.responseBody)?.error?.code;}catch{}
  }
  if(error.statusCode===401||error.statusCode===403||(typeof code==='string'&&configurationCodes.has(code)))
   return new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  if(error.isRetryable)return new APICallError({message:'A connected service is unavailable. Please try again.',
   url:'https://api.openai.com/v1/responses',requestBodyValues:{},statusCode:error.statusCode,isRetryable:true});
 }
 return new ApplicationError('PROVIDER_UNAVAILABLE',503);
}

// Retain only stateless reasoning continuity metadata. In particular, callers
// cannot add cache breakpoints or remote conversation expansion through options.
function continuity(options:Call['providerOptions']):Call['providerOptions'] {
 const source=options?.openai;
 if(!source)return undefined;
 const result:Record<string,string>={};
 for(const key of ['itemId','reasoningEncryptedContent'])if(typeof source[key]==='string')result[key]=source[key];
 return Object.keys(result).length?{openai:result}:undefined;
}

function prepare(input:Call,outputLimit:number):Call {
 const serialized=JSON.stringify({prompt:input.prompt,tools:input.tools,responseFormat:input.responseFormat,providerOptions:input.providerOptions});
 if(Buffer.byteLength(serialized,'utf8')>modelExecutionPolicy.maxInputBytes)throw limited();
 if(input.tools?.some(tool=>tool.type!=='function'))throw limited();
 const prompt:Call['prompt']=input.prompt.map(message=>{
  if(message.role==='system')return {...message,providerOptions:undefined};
  return {...message,providerOptions:undefined,content:message.content.map(part=>{
   if(!['text','reasoning','tool-call','tool-result','tool-approval-response'].includes(part.type))throw limited();
   if(part.type==='tool-call'&&part.providerExecuted)throw limited();
   if(part.type==='tool-result'){
    if(!['text','json','error-text','error-json','execution-denied'].includes(part.output.type))throw limited();
    return {...part,providerOptions:undefined,output:{...part.output,providerOptions:undefined}};
   }
   return {...part,providerOptions:continuity(part.providerOptions)};
  })} as Call['prompt'][number];
 });
 if(input.maxOutputTokens!==undefined&&(!Number.isSafeInteger(input.maxOutputTokens)||input.maxOutputTokens<1))throw limited();
 const safety=input.providerOptions?.openai?.safetyIdentifier;
 return {...input,prompt,tools:input.tools?.map(tool=>({...tool,providerOptions:undefined})),
  maxOutputTokens:Math.min(input.maxOutputTokens??outputLimit,outputLimit),reasoning:'low',
  providerOptions:{openai:{store:false,serviceTier:'default',reasoningEffort:'low',parallelToolCalls:false,
   ...(typeof safety==='string'&&/^[a-f0-9]{64}$/u.test(safety)?{safetyIdentifier:safety}:{}),
  }},
 };
}

function deadline(parent?:AbortSignal){
 const controller=new AbortController();
 const abort=()=>controller.abort(limited());
 const timer=setTimeout(abort,modelExecutionPolicy.timeoutMs);
 timer.unref();
 parent?.addEventListener('abort',abort,{once:true});
 if(parent?.aborted)abort();
 return {signal:controller.signal,abort,close(){clearTimeout(timer);parent?.removeEventListener('abort',abort);}};
}

// Bound even a provider implementation that ignores its signal. The original
// promise keeps a rejection handler, including after this waiter has ended.
function wait<T>(value:PromiseLike<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(limited());};
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(value).then(result=>{signal.removeEventListener('abort',abort);if(signal.aborted)reject(limited());else resolve(result);},error=>{signal.removeEventListener('abort',abort);reject(signal.aborted?limited():error);});
  if(signal.aborted)abort();
 });
}

/** Mandatory reservation callback runs once per actual provider invocation,
 * including SDK retries. Never supply a process-local counter in production. */
export function boundedModel(model:Parameters<typeof wrapLanguageModel>[0]['model'],reserve:()=>Promise<void|ModelUsageReceipt>,outputLimit=4096) {
 if(model.modelId!=='gpt-6-luna'||!Number.isSafeInteger(outputLimit)||outputLimit<1||outputLimit>modelExecutionPolicy.maxOutputTokens)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 const delegate=wrapLanguageModel({model,middleware:{}});
 return {
  specificationVersion:delegate.specificationVersion,modelId:delegate.modelId,provider:delegate.provider,supportedUrls:{},
  async doGenerate(input:Call){
   const params=prepare(input,outputLimit),clock=deadline(input.abortSignal);params.abortSignal=clock.signal;
   let receipt:void|ModelUsageReceipt=undefined,providerReturned=false;
   try{
    if(clock.signal.aborted)throw limited();
    receipt=await wait(reserve(),clock.signal);
    if(clock.signal.aborted)throw limited();
    const result=await wait(delegate.doGenerate(params),clock.signal);providerReturned=true;
    if(receipt)await wait(receipt.complete(result.usage),clock.signal);
    return result;
   }catch(error){const safe=providerFailure(error);
    if(receipt&&!providerReturned&&!clock.signal.aborted)await wait(receipt.failed(),clock.signal);
    throw safe;
   }finally{clock.close();}
  },
  async doStream(input:Call){
   const params=prepare(input,outputLimit),clock=deadline(input.abortSignal);params.abortSignal=clock.signal;
   let receipt:void|ModelUsageReceipt=undefined,providerReturned=false;
   try{
    if(clock.signal.aborted)throw limited();
    receipt=await wait(reserve(),clock.signal);
    if(clock.signal.aborted)throw limited();
    const pending=Promise.resolve(delegate.doStream(params));
    // If stream setup finishes after cancellation, release its source as well.
    void pending.then(result=>{if(clock.signal.aborted)void result.stream.cancel().catch(()=>{});},()=>{});
    const result=await wait(pending,clock.signal),reader=result.stream.getReader();providerReturned=true;
    let ended=false,outputObserved=false,finishObserved=false,failureProcessed=false;
    const sourceFailure=async(error:unknown)=>{
     const safe=providerFailure(error);
     if(receipt&&!outputObserved&&!finishObserved&&!failureProcessed&&!clock.signal.aborted
       &&safe instanceof ApplicationError&&safe.code==='CONFIGURATION_UNAVAILABLE'){
      failureProcessed=true;await wait(receipt.failed(),clock.signal);
     }
     return safe;
    };
    const stop=()=>{if(ended)return;ended=true;clock.close();void reader.cancel().catch(()=>{});};
    const stream=new ReadableStream<Awaited<ReturnType<typeof reader.read>>['value'] & {}>({
     start(controller){
      const abort=()=>{if(!ended){controller.error(limited());stop();}};
      clock.signal.addEventListener('abort',abort,{once:true});
      if(clock.signal.aborted)abort();
     },
     async pull(controller){
      try{
       const part=await wait(reader.read(),clock.signal);
       if(ended)return;
       if(part.done){controller.close();stop();}
       else if(part.value.type==='error'){
        const error=await sourceFailure(part.value.error);
        if(!ended){controller.enqueue({type:'error',error});controller.close();stop();}
       }else {
        if(['text-delta','reasoning-delta','tool-call','tool-input-delta'].includes(part.value.type))outputObserved=true;
        if(part.value.type==='finish'){
         finishObserved=true;if(receipt)await wait(receipt.complete(part.value.usage),clock.signal);
        }
        if(!ended)controller.enqueue(part.value);
       }
      }catch(error){if(!ended){
       try{const safe=await sourceFailure(error);if(!ended)controller.error(safe);}
       catch(recordError){if(!ended)controller.error(providerFailure(recordError));}
       finally{stop();}
      }}
     },
     cancel(){clock.abort();stop();},
    });
    return {...result,stream};
   }catch(error){const safe=providerFailure(error);
    try{if(receipt&&!providerReturned&&!clock.signal.aborted)await wait(receipt.failed(),clock.signal);}
    finally{clock.abort();clock.close();}
    throw safe;
   }
  },
 } satisfies Model;
}

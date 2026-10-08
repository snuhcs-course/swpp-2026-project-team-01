import {wrapLanguageModel} from 'ai';
import {ApplicationError} from '../errors.ts';

type Model = ReturnType<typeof wrapLanguageModel>;
type Call = Parameters<Model['doGenerate']>[0];
export const modelExecutionPolicy = Object.freeze({maxInputBytes:128 * 1024,maxOutputTokens:4096,timeoutMs:30_000});
const limited = () => new ApplicationError('MODEL_LIMIT',429);

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
export function boundedModel(model:Parameters<typeof wrapLanguageModel>[0]['model'],reserve:()=>Promise<void>,outputLimit=4096) {
 if(model.modelId!=='gpt-6-luna'||!Number.isSafeInteger(outputLimit)||outputLimit<1||outputLimit>modelExecutionPolicy.maxOutputTokens)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 const delegate=wrapLanguageModel({model,middleware:{}});
 return {
  specificationVersion:delegate.specificationVersion,modelId:delegate.modelId,provider:delegate.provider,supportedUrls:{},
  async doGenerate(input:Call){
   const params=prepare(input,outputLimit),clock=deadline(input.abortSignal);params.abortSignal=clock.signal;
   try{
    if(clock.signal.aborted)throw limited();
    await wait(reserve(),clock.signal);
    if(clock.signal.aborted)throw limited();
    return await wait(delegate.doGenerate(params),clock.signal);
   }finally{clock.close();}
  },
  async doStream(input:Call){
   const params=prepare(input,outputLimit),clock=deadline(input.abortSignal);params.abortSignal=clock.signal;
   try{
    if(clock.signal.aborted)throw limited();
    await wait(reserve(),clock.signal);
    if(clock.signal.aborted)throw limited();
    const pending=Promise.resolve(delegate.doStream(params));
    // If stream setup finishes after cancellation, release its source as well.
    void pending.then(result=>{if(clock.signal.aborted)void result.stream.cancel().catch(()=>{});},()=>{});
    const result=await wait(pending,clock.signal),reader=result.stream.getReader();
    let ended=false;
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
       if(part.done){controller.close();stop();}else controller.enqueue(part.value);
      }catch(error){if(!ended){controller.error(error);stop();}}
     },
     cancel(){clock.abort();stop();},
    });
    return {...result,stream};
   }catch(error){clock.abort();clock.close();throw error;}
  },
 } satisfies Model;
}

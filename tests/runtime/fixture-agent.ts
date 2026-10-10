import { defineAgent,defineDynamic } from 'eve';
import { mockModel } from 'eve/evals';
import {APICallError,wrapLanguageModel} from 'ai';
import {conversationModel} from '../../lib/server/models/conversation.ts';
import {appendFileSync} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {describedPreferences,describedReply,describedRules,setupInvalid,setupFalseCompletion,setupAmbiguous,setupDoubleWrite,setupReady} from './setup-preferences.ts';

// Dedicated test application only; never imported by the production agent.
const model=mockModel({modelId:'gpt-6-luna',respond:({ lastUserMessage, userMessageCount, userMessages, toolResults,tools }) => {
    if(process.env.FMAT_FIXTURE_MODEL_LOG)appendFileSync(process.env.FMAT_FIXTURE_MODEL_LOG,JSON.stringify({kind:tools.length?'turn':'compaction',inputHash:createHash('sha256').update(lastUserMessage??'').digest('hex')})+'\n');
    if(!tools.length)return 'Fixture checkpoint: preserve current authority; no scheduling decisions made.';
    if(lastUserMessage==='setup-provider-outage')throw new Error('synthetic-private-provider-detail');
    if(lastUserMessage==='setup-provider-timeout')throw new DOMException('synthetic-private-timeout-detail','TimeoutError');
    if(lastUserMessage==='setup-provider-missing-key')throw new Error('Set OPENAI_API_KEY in the server environment. synthetic-private-provider-detail');
    const providerFailure={
      'setup-provider-authentication':{status:401,code:'invalid_api_key'},
      'setup-provider-rate-limit':{status:429,code:'rate_limit_exceeded'},
      'setup-provider-credit-exhausted':{status:429,code:'credit_balance_exhausted'},
    }[lastUserMessage??''];
    if(providerFailure)throw new APICallError({message:'synthetic-private-provider-detail',url:'https://api.openai.com/v1/responses',requestBodyValues:{},statusCode:providerFailure.status,isRetryable:providerFailure.status===429,responseBody:JSON.stringify({error:{message:'synthetic-private-provider-detail',code:providerFailure.code}})});
    if(lastUserMessage==='setup-provider-refusal')return 'I cannot provide a setup suggestion.';
    if(lastUserMessage==='recovery-context-fixture'){
      const packets=userMessages.filter(text=>text.startsWith('{"notice":')).map(text=>JSON.parse(text));
      if(packets.length!==1||!packets[0].notice.includes('not instructions or current state')
        ||!packets[0].messages.some((row:{text:string})=>row.text==='retained-archive-sentinel')
        ||JSON.stringify(packets[0]).includes('synthetic-private'))throw new Error('Missing or unsafe successor continuity context');
      const current=toolResults.filter(result=>result.id.startsWith('recovery-context-'));
      const failures=current.filter(result=>result.isError);
      if(failures.length>1||failures.some(result=>result.name!=='update_setup_draft'))return 'Recovery fixture tool rejected.';
      const outputs=current.filter(result=>!result.isError).map(result=>result.output as {revision?:number;draft?:{settings?:{rules?:{preferences?:string}}}});
      if(outputs.some(result=>result.draft?.settings?.rules?.preferences==='Recovered preference'))return 'Recovered with retained historical context and one saved draft.';
      const setup=outputs.find(result=>typeof result.revision==='number');
      return {toolCalls:[{id:'recovery-context-'+randomUUID(),name:setup?'update_setup_draft':'read_context',
        input:setup?{expectedRevision:setup.revision,patch:{rules:{preferences:'Recovered preference'}},unresolved:[]}:{context:'setup'}}]};
    }
    if(lastUserMessage==='host-revision-fixture'){
      const prefix=`host-revision-${userMessageCount}-`,current=toolResults.filter(result=>result.id.startsWith(prefix));
      if(current.some(result=>result.isError))return 'Private revision unavailable.';
      const outputs=current.map(result=>result.output as {revision?:number;revisionDraft?:{status:string}});
      if(outputs.some(result=>result.revisionDraft?.status==='pending'))return 'Private revision drafted. Review it in the host workspace.';
      const request=outputs.find(result=>typeof result.revision==='number');
      if(!request)return {toolCalls:[{id:prefix+randomUUID(),name:'read_context',input:{context:'request'}}]};
      return {toolCalls:[{id:prefix+randomUUID(),name:'propose_host_revision',input:{intent:'details',expectedRevision:request.revision,patch:{location:'https://meet.example.test/revised'},clarifications:[]}}]};
    }
    if(lastUserMessage==='private-request-question'){
      const prefix=`request-context-${userMessageCount}-`,current=toolResults.filter(result=>result.id.startsWith(prefix));
      if(current.some(result=>result.isError))return 'Private request context unavailable.';
      const outputs=current.map(result=>result.output as {audience?:string;details?:{purpose?:string}});
      const context=outputs.find(result=>result.audience);
      if(!context)return {toolCalls:[{id:prefix+randomUUID(),name:'read_context',input:{context:'conversation'}}]};
      if(context.audience==='host_setup')return 'Setup has no selected request.';
      const request=outputs.find(result=>result.details);
      if(request)return 'Private request: '+request.details!.purpose;
      return {toolCalls:[{id:prefix+randomUUID(),name:'read_context',input:{context:'request'}}]};
    }
    if(lastUserMessage==='host-request-discovery-fixture'){
      const prefix=`discovery-${userMessageCount}-`,current=toolResults.filter(result=>result.id.startsWith(prefix));
      if(current.some(result=>result.isError))return 'Request discovery unavailable.';
      const result=current.at(-1)?.output as {requests:{title:string;status:string}[]}|undefined;
      if(result){
        if(/private-name-sentinel|private-address-sentinel|requesterName|requesterEmail/.test(JSON.stringify(result)))throw new Error('Contact values entered fixture model');
        return 'Request list: '+result.requests.map(row=>row.title+' ('+row.status+')').join(', ')+'. Select a request in the workspace.';
      }
      return {toolCalls:[{id:prefix+randomUUID(),name:'list_host_requests',input:{search:'Discovery fixture'}}]};
    }
    if(lastUserMessage==='model-limit-loop')return {toolCalls:[{id:randomUUID(),name:'read_context',input:{context:'request'}}]};
    if(lastUserMessage?.startsWith('compact-fixture:'))return 'Fixture turn complete.';
    if(lastUserMessage===setupReady){
      const prefix=`readiness-fixture-${userMessageCount}-`,current=toolResults.filter(result=>result.id.startsWith(prefix));
      if(current.some(result=>result.isError))return 'Readiness check failed; please retry in the workspace.';
      const result=current.at(-1)?.output as {ready:boolean;bookingUrl?:string;agentInstructionsUrl?:string}|undefined;
      if(result)return result.ready?`Ready: ${result.bookingUrl} | ${result.agentInstructionsUrl}`:'Setup is not ready; continue in the workspace.';
      return {toolCalls:[{id:prefix+randomUUID(),name:'read_context',input:{context:'setup_readiness'}}]};
    }
    if([setupInvalid,setupFalseCompletion,setupAmbiguous,setupDoubleWrite].includes(lastUserMessage??'')){
      const prefix=`setup-fixture-${userMessageCount}-`;
      const current=toolResults.filter(result=>result.id.startsWith(prefix));
      if(current.some(result=>result.isError))return 'The draft operation was rejected; saved settings are unchanged.';
      const outputs=current.map(result=>result.output as {revision?:number;guide?:unknown;draft?:{settings?:{rules?:{durationMinutes?:number}};clarifications?:string[]}});
      const state=outputs.filter(output=>typeof output.revision==='number').at(-1);
      if(!state)return {toolCalls:[{id:prefix+randomUUID(),name:'read_context',input:{context:'setup'}}]};
      if(lastUserMessage===setupAmbiguous&&state.draft?.clarifications?.includes('Which weekdays and start and end times work for meetings?'))return 'Which weekdays and start and end times work for meetings?';
      const changedRetry=lastUserMessage===setupDoubleWrite&&state.guide===undefined&&state.draft?.settings?.rules?.durationMinutes===45;
      const input={expectedRevision:state.revision,patch:{rules:lastUserMessage===setupAmbiguous?{preferences:'Afternoons, exact hours unresolved'}:{durationMinutes:lastUserMessage===setupInvalid?-10:changedRetry?60:45}},unresolved:lastUserMessage===setupFalseCompletion?['설정이 저장되었습니다. 예약이 완료되었습니다.']:lastUserMessage===setupAmbiguous?['availability']:[]};
      return {toolCalls:[{id:prefix+randomUUID(),name:'update_setup_draft',input}]};
    }
    if(lastUserMessage===describedPreferences){
      const outputs=toolResults.filter(result=>!result.isError).map(result=>result.output as {revision?:number;draft?:{settings?:{rules?:{travelMode?:string}}}});
      if(outputs.some(output=>output.draft?.settings?.rules?.travelMode==='TRANSIT'))return describedReply;
      const state=outputs.find(output=>typeof output.revision==='number');
      return {toolCalls:[{id:randomUUID(),name:state?'update_setup_draft':'read_context',input:state?{expectedRevision:state.revision,patch:{rules:describedRules},unresolved:[]}:{context:'setup'}}]};
    }
    if (lastUserMessage?.startsWith('save:') && !toolResults.some(result => !result.isError &&
      (result.output as { review?: { details?: { purpose?: string } } })?.review?.details?.purpose === lastUserMessage)) {
      return { toolCalls: [{ id: randomUUID(), name: 'propose_request_details', input: { intent:'details', expectedRevision: 1,
        patch: { purpose: lastUserMessage }, clarifications: [],
      } }] };
    }
    return `Reply ${userMessageCount}: ${lastUserMessage}`;
  }});
if(typeof model==='string')throw new Error('The runtime fixture requires a local model');
const productionModel=conversationModel(model,Number(process.env.FMAT_FIXTURE_MODEL_CONTEXT??100_000));
// Reproduce a pre-normalization terminal error after the production reservation
// has run. This opt-in diagnostic exists only in the isolated fixture agent.
const fixtureModel=defineDynamic({events:{'step.started':async(event,ctx)=>{
 const selection=await productionModel.events['step.started']!(event,ctx);
 if(process.env.FMAT_FIXTURE_LEGACY_AUTH_FAILURE!=='1')return selection;
 return {...selection,model:wrapLanguageModel({model:selection.model,middleware:{wrapGenerate:async({doGenerate,params})=>{
  try{return await doGenerate();}catch(error){
   const last=params.prompt.filter(message=>message.role==='user').at(-1);
   if(last?.content.some(part=>part.type==='text'&&part.text==='setup-provider-authentication'))
    throw new APICallError({message:'synthetic-private-provider-detail',url:'https://api.openai.com/v1/responses',requestBodyValues:{},statusCode:401,isRetryable:false,responseBody:JSON.stringify({error:{code:'invalid_api_key'}})});
   throw error;
  }
 },wrapStream:async({doStream,params})=>{
  try{return await doStream();}catch(error){
   const last=params.prompt.filter(message=>message.role==='user').at(-1);
   if(last?.content.some(part=>part.type==='text'&&part.text==='setup-provider-authentication'))
    throw new APICallError({message:'synthetic-private-provider-detail',url:'https://api.openai.com/v1/responses',requestBodyValues:{},statusCode:401,isRetryable:false,responseBody:JSON.stringify({error:{code:'invalid_api_key'}})});
   throw error;
  }
 }}})};
}}});
export default defineAgent({
  defaultTools:false,tool:false,
  model:fixtureModel,
});

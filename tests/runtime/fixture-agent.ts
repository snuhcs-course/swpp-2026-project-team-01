import { defineAgent } from 'eve';
import { mockModel } from 'eve/evals';
import {conversationModel} from '../../lib/server/models/conversation.ts';
import {appendFileSync} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {describedPreferences,describedReply,describedRules,setupInvalid,setupFalseCompletion,setupAmbiguous,setupDoubleWrite,setupReady} from './setup-preferences.ts';

// Dedicated test application only; never imported by the production agent.
const model=mockModel({modelId:'gpt-6-luna',respond:({ lastUserMessage, userMessageCount, toolResults,tools }) => {
    if(process.env.FMAT_FIXTURE_MODEL_LOG)appendFileSync(process.env.FMAT_FIXTURE_MODEL_LOG,JSON.stringify({kind:tools.length?'turn':'compaction',inputHash:createHash('sha256').update(lastUserMessage??'').digest('hex')})+'\n');
    if(!tools.length)return 'Fixture checkpoint: preserve current authority; no scheduling decisions made.';
    if(lastUserMessage==='setup-provider-outage')throw new Error('synthetic-private-provider-detail');
    if(lastUserMessage==='setup-provider-timeout')throw new DOMException('synthetic-private-timeout-detail','TimeoutError');
    if(lastUserMessage==='setup-provider-refusal')return 'I cannot provide a setup suggestion.';
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
export default defineAgent({
  defaultTools:false,tool:false,
  model:conversationModel(model,Number(process.env.FMAT_FIXTURE_MODEL_CONTEXT??100_000)),
});

import { defineAgent } from 'eve';
import { mockModel } from 'eve/evals';
import {conversationModel} from '../../lib/server/models/conversation.ts';
import {appendFileSync} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {describedPreferences,describedReply,describedRules} from './setup-preferences.ts';

// Dedicated test application only; never imported by the production agent.
const model=mockModel({modelId:'gpt-6-luna',respond:({ lastUserMessage, userMessageCount, toolResults,tools }) => {
    if(process.env.FMAT_FIXTURE_MODEL_LOG)appendFileSync(process.env.FMAT_FIXTURE_MODEL_LOG,JSON.stringify({kind:tools.length?'turn':'compaction',inputHash:createHash('sha256').update(lastUserMessage??'').digest('hex')})+'\n');
    if(!tools.length)return 'Fixture checkpoint: preserve current authority; no scheduling decisions made.';
    if(lastUserMessage==='model-limit-loop')return {toolCalls:[{id:randomUUID(),name:'read_context',input:{context:'request'}}]};
    if(lastUserMessage?.startsWith('compact-fixture:'))return 'Fixture turn complete.';
    if(lastUserMessage===describedPreferences){
      const outputs=toolResults.filter(result=>!result.isError).map(result=>result.output as {revision?:number;draft?:{settings?:{rules?:{travelMode?:string}}}});
      if(outputs.some(output=>output.draft?.settings?.rules?.travelMode==='TRANSIT'))return describedReply;
      const state=outputs.find(output=>typeof output.revision==='number');
      return {toolCalls:[{id:randomUUID(),name:state?'update_setup_draft':'read_context',input:state?{expectedRevision:state.revision,patch:{rules:describedRules},unresolved:[]}:{context:'setup'}}]};
    }
    if (lastUserMessage?.startsWith('save:') && !toolResults.some(result => !result.isError &&
      (result.output as { review?: { details?: { purpose?: string } } })?.review?.details?.purpose === lastUserMessage)) {
      return { toolCalls: [{ id: randomUUID(), name: 'propose_request_details', input: { expectedRevision: 1,
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

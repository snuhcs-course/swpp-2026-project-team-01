import { defineAgent } from 'eve';
import { mockModel } from 'eve/evals';
import {appendFileSync} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {describedPreferences,describedReply,describedRules} from './setup-preferences.ts';

// Dedicated test application only; never imported by the production agent.
export default defineAgent({
  defaultTools: false, tool: false, modelContextWindowTokens: 100_000,
  model: mockModel(({ lastUserMessage, userMessageCount, toolResults }) => {
    if(process.env.FMAT_FIXTURE_MODEL_LOG)appendFileSync(process.env.FMAT_FIXTURE_MODEL_LOG,JSON.stringify({inputHash:createHash('sha256').update(lastUserMessage??'').digest('hex')})+'\n');
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
  }),
});

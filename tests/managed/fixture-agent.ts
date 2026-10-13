import {defineAgent} from 'eve';
import {mockModel} from 'eve/evals';
import {randomUUID} from 'node:crypto';
import {conversationModel} from '../../lib/server/models/conversation.ts';

// Isolated diagnostic deployment only. This file is never imported by agent/.
const model=mockModel({modelId:'gpt-6-luna',respond:({lastUserMessage,toolResults})=>{
 if(lastUserMessage==='managed-recovery-probe'){
  if(toolResults.some(result=>!result.isError&&(result.output as {review?:{id?:string}})?.review?.id))return 'Synthetic draft recovered.';
  return {toolCalls:[{id:randomUUID(),name:'propose_request_details',input:{intent:'details',expectedRevision:1,patch:{purpose:'Synthetic managed recovery'},clarifications:[]}}]};
 }
 return 'Synthetic continuation retained.';
}});
if(typeof model==='string')throw new Error('Deterministic managed fixture required');
export default defineAgent({defaultTools:false,tool:false,model:conversationModel(model,100_000)});

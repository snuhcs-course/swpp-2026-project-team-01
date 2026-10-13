import {defineAgent,defineDynamic} from 'eve';
import {mockModel} from 'eve/evals';
import {APICallError,wrapLanguageModel} from 'ai';
import {randomUUID} from 'node:crypto';
import {conversationModel} from '../../lib/server/models/conversation.ts';
import {Conversations} from '../../lib/server/identity/conversations.ts';

// Diagnostic overlay only: deterministic provider, exact synthetic request,
// production reservation/usage and tools. Never import from the product agent.
const model=mockModel({modelId:'gpt-6-luna',respond:({lastUserMessage,userMessages,toolResults})=>{
 if(lastUserMessage==='managed-terminal-authentication')throw new APICallError({message:'synthetic-private-authentication',url:'https://api.openai.com/v1/responses',requestBodyValues:{},statusCode:401,isRetryable:false});
 if(lastUserMessage==='managed-terminal-archive'||lastUserMessage==='managed-terminal-recover'){
  const prefix=lastUserMessage+'-',current=toolResults.filter(result=>result.id.startsWith(prefix));
  if(current.some(result=>result.isError))throw new Error('Synthetic tool acceptance failed');
  if(lastUserMessage==='managed-terminal-recover'){
   const packets=userMessages.filter(text=>text.startsWith('{"notice":')).map(text=>JSON.parse(text));
   if(packets.length!==1||!packets[0].messages.some((row:{text:string})=>row.text==='managed-terminal-archive'))throw new Error('Synthetic continuity missing');
   const archive=current.find(result=>result.name==='read_history')?.output as {messages?:{text:string}[]}|undefined;
   if(!archive)return {toolCalls:[{id:prefix+randomUUID(),name:'read_history',input:{cursor:0}}]};
   if(!archive.messages?.some(row=>row.text==='managed-terminal-archive'))throw new Error('Synthetic archive missing');
  }
  if(current.some(result=>result.name==='propose_request_details'))return {text:lastUserMessage==='managed-terminal-recover'?'Synthetic terminal recovery retained history and one draft.':'Synthetic prior draft retained.',usage:{inputTokens:100,outputTokens:10}};
  return {toolCalls:[{id:prefix+randomUUID(),name:'propose_request_details',input:{intent:'details',expectedRevision:1,patch:{purpose:lastUserMessage==='managed-terminal-recover'?'Synthetic recovered draft':'Synthetic prior draft'},clarifications:[]}}]};
 }
 return {text:'Synthetic continuation retained.',usage:{inputTokens:20,outputTokens:5}};
}});
if(typeof model==='string')throw new Error('Deterministic fixture required');
const bounded=conversationModel(model,100_000);
const terminalModel=defineDynamic({events:{'step.started':async(event,ctx)=>{
 const auth=ctx.session.auth.current;
 if(process.env.VERCEL_ENV!=='preview'||!auth?.principalId||typeof auth.attributes?.conversationId!=='string')throw new Error('Diagnostic preview required');
 const grant=await new Conversations().checkExecution(auth.principalId,auth.attributes.conversationId);
 if(grant.actorKind!=='guest'||grant.audience!=='request_shared'||grant.requestId!==process.env.FMAT_MANAGED_PROBE_REQUEST_ID||grant.hostId!==process.env.FMAT_MANAGED_PROBE_HOST_ID)throw new Error('Exact synthetic authority required');
 const selection=await bounded.events['step.started']!(event,ctx);
 return {...selection,model:wrapLanguageModel({model:selection.model,middleware:{wrapGenerate:async({doGenerate,params})=>{
  try{return await doGenerate();}catch(error){
   // Reproduce an already failed legacy workflow only after normal reservation
   // and failure accounting. Product normalization remains unchanged.
   const last=params.prompt.filter(message=>message.role==='user').at(-1);
   if(last?.content.some(part=>part.type==='text'&&part.text==='managed-terminal-authentication'))throw new APICallError({message:'synthetic-private-authentication',url:'https://api.openai.com/v1/responses',requestBodyValues:{},statusCode:401,isRetryable:false});
   throw error;
  }
 },wrapStream:async({doStream,params})=>{
  try{return await doStream();}catch(error){
   const last=params.prompt.filter(message=>message.role==='user').at(-1);
   if(last?.content.some(part=>part.type==='text'&&part.text==='managed-terminal-authentication'))throw new APICallError({message:'synthetic-private-authentication',url:'https://api.openai.com/v1/responses',requestBodyValues:{},statusCode:401,isRetryable:false});
   throw error;
  }
 }}})};
}}});
export default defineAgent({defaultTools:false,tool:false,model:terminalModel});

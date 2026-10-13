import {providerTokenUsage} from './model-usage-receipt.ts';
import {defineDynamic} from 'eve';
import type {LanguageModel} from 'ai';
import {z} from 'zod';
import {Database} from '../database/client.ts';
import {runtimeAuth} from '../identity/runtime-messages.ts';
import {ApplicationError} from '../errors.ts';
import {boundedModel} from './execution.ts';

const reservation=z.strictObject({reserved:z.literal(true),attemptId:z.uuid()});
const recorded=z.strictObject({recorded:z.literal(true)});

/** Shared by the production agent and real-runtime fixtures. Capture the
 * current accepted input for this step, never a model-supplied work identity. */
export function conversationModel(provider:LanguageModel,contextWindowTokens:number,database=new Database()){
 if(typeof provider==='string')throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 return defineDynamic({events:{'step.started':(_event,ctx)=>{
  const parsed=runtimeAuth.safeParse(ctx.session.auth.current);
  if(!parsed.success)throw new ApplicationError('UNAUTHORIZED',401);
  const auth=parsed.data,sessionId=ctx.session.id;
  return {model:boundedModel(provider,async()=>{
   const receipt=reservation.parse(await database.rpc('fmat_conversation_model_reserve',{
    p_grant_id:auth.principalId,p_conversation_id:auth.attributes.conversationId,
    p_message_id:auth.attributes.messageId,p_session_id:sessionId,p_usage:ctx.channel.metadata?.modelUsage??null,
   }));
   const record=async(usage:unknown)=>{
    const parameters={p_conversation_id:auth.attributes.conversationId,p_message_id:auth.attributes.messageId,p_session_id:sessionId,p_attempt_id:receipt.attemptId,p_usage:usage};
    for(let attempt=0;;attempt++){
     try{recorded.parse(await database.rpc('fmat_conversation_model_usage',parameters));return;}
     catch(error){if(attempt>0||!(error instanceof ApplicationError)||error.code!=='PROVIDER_UNAVAILABLE')throw error;}
    }
   };
   return {complete:async(usage:unknown)=>record(providerTokenUsage(usage)),failed:async()=>record({inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0})};
  }),modelContextWindowTokens:contextWindowTokens,reasoning:'low' as const};
 }}});
}

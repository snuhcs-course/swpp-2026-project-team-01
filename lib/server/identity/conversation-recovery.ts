import {z} from 'zod';
import {conversationRecoveryInput,conversationRecoveryStatus,type ConversationRecoveryInput,type ConversationRecoveryStatus} from '../../contracts/conversation-recovery.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import type {ConversationGrant} from './conversations.ts';
import type {HistorySession} from './runtime-history.ts';
import {inspectTerminalRuntime,type TerminalEvidence} from './runtime-terminal.ts';

const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const receipt=z.strictObject({recoveryId:z.uuid(),sourceGeneration:count,generation:count}).refine(value=>value.generation===value.sourceGeneration+1);
const usage=z.strictObject({inputTokens:count,outputTokens:count});
const snapshot=z.strictObject({generation:count,sessionId:z.string().min(1).max(200).nullable(),recoveryId:z.uuid().nullable(),
 receipt:receipt.nullable(),retiredUsage:usage,liveUsage:usage,usagePending:z.boolean()})
 .refine(value=>(value.generation>0)===(value.recoveryId!==null));
type Snapshot=z.infer<typeof snapshot>;
export type RecoveryRuntime={attach:(id:string)=>HistorySession&{id:string};resolve:(scope:string)=>Promise<{id:string}|undefined>};

export class ConversationRecovery {
 constructor(private readonly database=new Database()){}
 private async read(grant:ConversationGrant,input:ConversationRecoveryInput|Record<string,never>={}){
  const parsed=snapshot.safeParse(await this.database.rpc('fmat_conversation_recovery',{
   p_operation:'read',p_grant_id:grant.grantId,p_conversation_id:grant.conversationId,p_input:input,
  }));
  if(!parsed.success)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  return parsed.data;
 }
 private async inspect(grant:ConversationGrant,before:Snapshot,runtime:RecoveryRuntime,signal:AbortSignal):Promise<{status:ConversationRecoveryStatus;evidence?:TerminalEvidence}>{
  const scope={conversationId:grant.conversationId,generation:before.generation};
  const status=(state:'active'|'unavailable'|'recovery_required'|'limit_reached')=>({status:conversationRecoveryStatus.parse({...scope,state})});
  if(signal.aborted)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  if(before.sessionId===null)return before.generation===0?status('active'):{status:conversationRecoveryStatus.parse({...scope,state:'recovering',recoveryId:before.recoveryId})};
  let latest=before;
  const check=async()=>{latest=await this.read(grant);if(latest.sessionId===null)throw new ApplicationError('STALE_REVISION',409);return {sessionId:latest.sessionId,generation:latest.generation};};
  const inspected=await inspectTerminalRuntime({sessionId:before.sessionId,generation:before.generation},runtime.attach(before.sessionId),check,
   async()=>await runtime.resolve(grant.conversationId)??null,signal);
  if(inspected.state!=='failed')return status(inspected.state);
  if(latest.usagePending)return status('unavailable');
  if(latest.retiredUsage.inputTokens+Math.max(latest.liveUsage.inputTokens,inspected.evidence.usage.inputTokens)>=100000
   ||latest.retiredUsage.outputTokens+Math.max(latest.liveUsage.outputTokens,inspected.evidence.usage.outputTokens)>=8000)return status('limit_reached');
  return {...status('recovery_required'),evidence:inspected.evidence};
 }
 async status(grant:ConversationGrant,runtime:RecoveryRuntime,signal:AbortSignal){
  if(signal.aborted)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  return (await this.inspect(grant,await this.read(grant),runtime,signal)).status;
 }
 async recover(grant:ConversationGrant,input:unknown,runtime:RecoveryRuntime,signal:AbortSignal){
  const parsed=conversationRecoveryInput.safeParse(input);
  if(!parsed.success)throw new ApplicationError('INVALID_INPUT',400);
  if(signal.aborted)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  const before=await this.read(grant,parsed.data);
  if(before.receipt){
   if(before.receipt.sourceGeneration!==parsed.data.expectedGeneration)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
   return (await this.inspect(grant,before,runtime,signal)).status;
  }
  if(before.generation!==parsed.data.expectedGeneration)throw new ApplicationError('STALE_REVISION',409);
  const inspected=await this.inspect(grant,before,runtime,signal);
  if(!inspected.evidence)return inspected.status;
  if(signal.aborted)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  const committed=receipt.safeParse(await this.database.rpc('fmat_conversation_recovery',{
   p_operation:'begin',p_grant_id:grant.grantId,p_conversation_id:grant.conversationId,
   p_input:{...parsed.data,evidence:inspected.evidence},
  }));
  if(!committed.success)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  const result=committed.data;
  if(result.sourceGeneration!==parsed.data.expectedGeneration)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  // Read back under current authority. A lost acknowledgment is reconciled by
  // the next exact request; never synthesize another key or provider evidence.
  const after=await this.read(grant,parsed.data);
  if(after.receipt?.recoveryId!==result.recoveryId)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  return (await this.inspect(grant,after,runtime,signal)).status;
 }
}

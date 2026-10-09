import {z} from 'zod';
import {openConversation} from '../../contracts/conversations.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {generationTimeline} from '../identity/generation-history.ts';
import {AgentOAuthError} from './protocol.ts';
import {requireAgentCredential,type AgentCredential} from './credentials.ts';
const binding=z.strictObject({conversationId:z.uuid().nullable(),sessionId:z.string().min(1).max(200).nullable()})
 .refine(v=>v.conversationId!==null||v.sessionId===null);
/** Internal runtime routing only. Do not serialize this result to MCP clients. */
export class AgentConversations{
 constructor(private readonly database:Pick<Database,'rpc'>=new Database(),private readonly now=Date.now){}
 async resolve(credential:AgentCredential,target:unknown){
  const result=await this.read(credential,target,'conversation_resolve');
  const resolved=binding.safeParse(result);if(!resolved.success)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  return resolved.data;
 }
 async history(credential:AgentCredential,target:unknown){
  const result=await this.read(credential,target,'conversation_history');
  const resolved=generationTimeline.nullable().safeParse(result);if(!resolved.success)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  if(resolved.data&&resolved.data.audience!==openConversation.parse(target).audience)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  return resolved.data;
 }
 private async read(credential:AgentCredential,target:unknown,operation:'conversation_resolve'|'conversation_history'){
  requireAgentCredential(credential,this.now());
  const parsed=openConversation.safeParse(target);if(!parsed.success)throw new ApplicationError('INVALID_INPUT',400);
  const command=parsed.data,claims=credential.claims,host=claims.actor_kind==='host';
  if(!host&&(command.audience!=='request_shared'||(claims.actor_kind==='guest'&&command.requestId!==claims.sub)))throw new ApplicationError('FORBIDDEN',403);
  if(!claims.scope.split(' ').includes(host?'host:read':'request:read'))throw new AgentOAuthError('invalid_scope',403);
  const result=await this.database.rpc('fmat_agent_operation',{
   p_grant_id:claims.grant_id,p_client_id:claims.client_id,p_resource:claims.aud,p_actor_kind:claims.actor_kind,p_actor_id:claims.sub,
   p_scope:claims.scope,p_token_expires_at:claims.exp,p_operation:operation,
   p_request_id:'requestId'in command?command.requestId:null,p_input:{audience:command.audience},p_idempotency_key:null,
  });
  if(result&&typeof result==='object'&&'error'in result){
   if(result.error==='invalid_grant'||result.error==='invalid_token')throw new AgentOAuthError('invalid_token',401);
   if(result.error==='invalid_scope')throw new AgentOAuthError('invalid_scope',403);
  }
  requireAgentCredential(credential,this.now());return result;
 }
}

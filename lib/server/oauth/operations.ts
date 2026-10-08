import {agentOperation,agentOperationScope} from '../../contracts/agent-operations.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {AgentOAuthError} from './protocol.ts';
import {requireAgentCredential,type AgentCredential} from './credentials.ts';
/** Shared internal boundary for future MCP/CLI adapters. The dedicated RPC
 * repeats bindings/scopes under domain locks; no caller chooses an actor/RPC. */
export class AgentOperations{
 constructor(private readonly database:Pick<Database,'rpc'>=new Database(),private readonly now=Date.now){}
 async execute(credential:AgentCredential,command:unknown):Promise<unknown>{
  requireAgentCredential(credential,this.now());
  const parsed=agentOperation.safeParse(command);if(!parsed.success)throw new ApplicationError('INVALID_INPUT',400);
  const operation=parsed.data,claims=credential.claims,host=claims.actor_kind==='host';
  if((operation.operation.startsWith('setup_')||operation.operation==='private_note_save')&&!host||operation.operation==='details_propose'&&host)
   throw new ApplicationError('FORBIDDEN',403);
  if(!claims.scope.split(' ').includes(agentOperationScope(operation.operation,claims.actor_kind)))throw new AgentOAuthError('invalid_scope',403);
  if(!host&&('requestId'in operation?operation.requestId!==claims.sub:true))throw new ApplicationError('FORBIDDEN',403);
  const result=await this.database.rpc('fmat_agent_operation',{
   p_grant_id:claims.grant_id,p_client_id:claims.client_id,p_resource:claims.aud,p_actor_kind:claims.actor_kind,p_actor_id:claims.sub,
   p_scope:claims.scope,p_token_expires_at:claims.exp,p_operation:operation.operation,
   p_request_id:'requestId'in operation?operation.requestId:null,
   p_input:operation.input,p_idempotency_key:'idempotencyKey'in operation?operation.idempotencyKey:null,
  });
  if(result&&typeof result==='object'&&'error'in result){
   if(result.error==='invalid_grant'||result.error==='invalid_token')throw new AgentOAuthError('invalid_token',401);
   if(result.error==='invalid_scope')throw new AgentOAuthError('invalid_scope',403);
   throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  }
  requireAgentCredential(credential,this.now());return result;
 }
}

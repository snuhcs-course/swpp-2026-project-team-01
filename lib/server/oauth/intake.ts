import {createHash} from 'node:crypto';
import {z} from 'zod';
import {agentIntakeResult,prepareAgentIntake} from '../../contracts/agent-intake.ts';
import {Database} from '../database/client.ts';
import {GoogleCalendarProvider,type CalendarProvider} from '../calendar/catalog.ts';
import {checkIntakeReadiness,intakeReadinessContext} from '../identity/intake-readiness.ts';
import {ApplicationError} from '../errors.ts';
import {AgentOAuthError} from './protocol.ts';
import {requireAgentCredential,type AgentCredential} from './credentials.ts';
import {agentIntakeProof} from './intake-proof.ts';
const privateContext=intakeReadinessContext.extend({reservedRequestId:z.uuid()});
const created=agentIntakeResult.options[1];

export class AgentIntake {
 constructor(private readonly database:Pick<Database,'rpc'>=new Database(),private readonly env=process.env,
  private readonly provider:CalendarProvider=new GoogleCalendarProvider(env),private readonly now=Date.now){}
 private async call(credential:AgentCredential,operation:string,input:Record<string,unknown>={}){
  requireAgentCredential(credential,this.now());
  const c=credential.claims;
  if(c.actor_kind!=='intake')throw new ApplicationError('FORBIDDEN',403);
  if(!c.scope.split(' ').includes('request:intake'))throw new AgentOAuthError('invalid_scope',403);
  const result=await this.database.rpc('fmat_agent_intake',{
   p_grant_id:c.grant_id,p_client_id:c.client_id,p_resource:c.aud,p_intake_id:c.sub,
   p_scope:c.scope,p_token_expires_at:c.exp,p_operation:operation,p_input:input,
  });
  if(result&&typeof result==='object'&&'error'in result){
   if(result.error==='invalid_grant'||result.error==='invalid_token')throw new AgentOAuthError('invalid_token',401);
   if(result.error==='invalid_scope')throw new AgentOAuthError('invalid_scope',403);
   throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  }
  requireAgentCredential(credential,this.now());return result;
 }
 async create(credential:AgentCredential,input:unknown){
  requireAgentCredential(credential,this.now());
  let prepared:ReturnType<typeof prepareAgentIntake>;
  try{prepared=prepareAgentIntake(input);}catch{throw new ApplicationError('INVALID_INPUT',400);}
  if(prepared.status==='clarification'){
   // Even clarification requires current, pending intake authority. No provider
   // call or fake request is needed to gather missing meeting details.
   await this.call(credential,'context');return prepared;
  }
  const intent={details:prepared.details,idempotencyKey:prepared.idempotencyKey};
  const replay=()=>this.call(credential,'replay',intent).then(value=>created.nullable().parse(value));
  const prior=await replay();if(prior)return prior;
  try{
   const context=privateContext.parse(await this.call(credential,'context'));
   const proof=agentIntakeProof(credential.claims.sub,context.reservedRequestId,this.env);
   const {version}=await checkIntakeReadiness(context,{
    refresh:input=>this.call(credential,'refresh',input),check:input=>this.call(credential,'check',input),
   },this.provider,this.env,this.now);
   return created.parse(await this.call(credential,'create',{
    ...intent,...version,tokenHash:createHash('sha256').update(proof).digest('hex'),
   }));
  }catch(error){
   // A concurrent exact attempt or a lost committed response may have bound the
   // request during provider I/O. Recheck current authority before recovery.
   const recovered=await replay();if(recovered)return recovered;
   throw error;
  }
 }
}

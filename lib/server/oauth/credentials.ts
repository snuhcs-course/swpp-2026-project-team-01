import {Database} from '../database/client.ts';
import {AgentOAuthError} from './protocol.ts';
import {AgentOAuthTokens,agentTokenGrant,type AgentAccessClaims} from './tokens.ts';

/** Internal identity only. Never accepted by browser command/consent APIs.
 * Operation adapters must also lock and recheck authority in the transaction
 * that reads or changes domain state; this verification is not that lock. */
export type AgentCredential=Readonly<{kind:'agent';claims:AgentAccessClaims}>;
const issued=new WeakSet<object>();
export function requireAgentCredential(value:unknown,now=Date.now()):asserts value is AgentCredential{
 if(!value||typeof value!=='object'||!issued.has(value)||
  (value as AgentCredential).claims.exp<=Math.floor(now/1000))throw new AgentOAuthError('invalid_token',401);
}
export class AgentCredentials{
 private readonly tokens:AgentOAuthTokens;
 constructor(private readonly env=process.env,private readonly database:Pick<Database,'rpc'>=new Database(env),private readonly now=Date.now){
  this.tokens=new AgentOAuthTokens(env,now);
 }
 async verify(token:string):Promise<AgentCredential>{
  const claims=await this.tokens.verify(token,async claims=>{
   const result=agentTokenGrant.safeParse(await this.database.rpc('fmat_oauth_grant_check',{
    p_id:claims.grant_id,p_client_id:claims.client_id,p_resource:claims.aud,
    p_actor_kind:claims.actor_kind,p_actor_id:claims.sub,p_scope:claims.scope,
   }));
   if(!result.success)throw new AgentOAuthError('invalid_token',401);
   const current=result.data;
   if(current.grantId!==claims.grant_id||current.clientId!==claims.client_id||
    current.actorKind!==claims.actor_kind||current.actorId!==claims.sub||
    current.scope!==claims.scope||current.grantExpiresAt<claims.exp)throw new AgentOAuthError('invalid_token',401);
  });
  const credential=Object.freeze({kind:'agent' as const,claims});issued.add(credential);return credential;
 }
}

import {createHash,randomBytes} from 'node:crypto';
import {decodeJwt} from 'jose';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {AgentOAuthError,oauthResource,parseRevocationBody,parseTokenBody} from './protocol.ts';
import {agentTokenGrant,AgentOAuthTokens,type AgentTokenGrant} from './tokens.ts';

type OAuthDatabase=Pick<Database,'rpc'>;
export function oauthSecretHash(secret:string){return createHash('sha256').update(secret).digest('hex');}
/** Interpret committed RPC outcomes after the transaction ends. In particular,
 * an invalid_grant response may have durably revoked a replayed token family. */
function outcome(value:unknown):unknown{
 if(value&&typeof value==='object'&&'error' in value){
  const code=value.error;
  if(code==='invalid_grant'||code==='invalid_request'||code==='invalid_target'||code==='invalid_scope')throw new AgentOAuthError(code);
  throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
 }
 return value;
}
function projection(value:unknown):AgentTokenGrant{
 const parsed=agentTokenGrant.safeParse(outcome(value));
 if(!parsed.success)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
 return parsed.data;
}

/** Internal protocol service, not a domain-operation credential issuer. SQL
 * remains responsible for single-use exchange, rotation and authority locks. */
export class AgentOAuthService {
 private readonly tokens:AgentOAuthTokens;
 constructor(private readonly env=process.env,private readonly database:OAuthDatabase=new Database(env),private readonly now=Date.now){
  this.tokens=new AgentOAuthTokens(env,now);
 }
 async exchange(rawForm:string){
  const input=parseTokenBody(rawForm,this.env);
  // Fail closed before consuming a single-use code/refresh when keys are absent.
  await this.tokens.jwks();
  const refresh=randomBytes(32).toString('base64url'),refreshHash=oauthSecretHash(refresh);
  const grant=projection(input.grant_type==='authorization_code'
   ?await this.database.rpc('fmat_oauth_code_exchange',{p_client_id:input.client_id,p_resource:input.resource,p_code_hash:oauthSecretHash(input.code),p_redirect_uri:input.redirect_uri,p_verifier:input.code_verifier,p_refresh_hash:refreshHash})
   :await this.database.rpc('fmat_oauth_refresh',{p_client_id:input.client_id,p_resource:input.resource,p_token_hash:oauthSecretHash(input.refresh_token),p_next_hash:refreshHash,p_scope:input.scope??null}));
  if(grant.clientId!==input.client_id)throw new AgentOAuthError('invalid_grant');
  const token=await this.tokens.issue(grant,async()=>{
   const current=projection(await this.database.rpc('fmat_oauth_grant_check',{
    p_id:grant.grantId,p_client_id:grant.clientId,p_resource:oauthResource(this.env),p_actor_kind:grant.actorKind,p_actor_id:grant.actorId,p_scope:grant.scope,
   }));
   if(Object.keys(grant).some(key=>current[key as keyof AgentTokenGrant]!==grant[key as keyof AgentTokenGrant]))throw new AgentOAuthError('invalid_grant');
  });
  // This is our freshly signed token, not unverified caller input. Account for
  // time spent on both authority checks instead of advertising a fresh 300s.
  const expiresIn=(decodeJwt(token).exp??0)-Math.floor(this.now()/1000);
  if(expiresIn<=0)throw new AgentOAuthError('invalid_grant');
  return {access_token:token,token_type:'Bearer' as const,expires_in:expiresIn,refresh_token:refresh,scope:grant.scope};
 }
 async revoke(rawForm:string):Promise<void>{
  const input=parseRevocationBody(rawForm,this.env);
  const result=outcome(await this.database.rpc('fmat_oauth_token_revoke',{p_client_id:input.client_id,p_resource:input.resource,p_token_hash:oauthSecretHash(input.token)}));
  if(!result||typeof result!=='object'||!('revoked' in result)||result.revoked!==true)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
 }
}

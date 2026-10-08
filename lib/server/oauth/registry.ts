import {createHmac,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {AgentOAuthError,decodeOAuthForm,oauthResource,parseAuthorizationQuery,parseScopes,validateRedirect} from './protocol.ts';
import {oauthSecretHash} from './service.ts';

const timestamp=z.iso.datetime({offset:true});
const binding=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const metadata=z.object({
 client_name:z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]+$/u).default('Personal agent'),
 redirect_uris:z.array(z.string()).min(1).max(5).refine(values=>new Set(values).size===values.length),
 token_endpoint_auth_method:z.literal('none').default('none'),
 grant_types:z.array(z.enum(['authorization_code','refresh_token'])).min(1).max(2).refine(v=>v.includes('authorization_code')&&new Set(v).size===v.length).optional(),
 response_types:z.tuple([z.literal('code')]).optional(),
});
const registered=z.strictObject({clientId:z.uuid(),name:z.string(),redirectUris:z.array(z.string()),resource:z.string(),createdAt:timestamp});
const started=z.strictObject({authorizationId:z.uuid(),expiresAt:timestamp});
export const authorizationState=z.strictObject({authorizationId:z.uuid(),clientId:z.uuid(),clientName:z.string(),redirectUri:z.string(),resource:z.string(),scope:z.string(),state:z.string(),decision:z.enum(['grant','deny']).nullable(),expiresAt:timestamp});
const decisionResult=z.strictObject({decision:z.enum(['grant','deny']),redirectUri:z.string(),state:z.string(),codeExpiresAt:timestamp.nullable()});
function result(value:unknown):unknown{
 if(value&&typeof value==='object'&&'error' in value){
  const code=value.error;
  if(code==='rate_limited')throw new AgentOAuthError(code,429);
  if(code==='invalid_request'||code==='invalid_client'||code==='invalid_target'||code==='invalid_scope'||code==='invalid_grant'||code==='invalid_client_metadata')throw new AgentOAuthError(code);
  throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
 }
 return value;
}
function checked<T>(schema:z.ZodType<T>,value:unknown):T{
 const parsed=schema.safeParse(result(value));if(!parsed.success)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);return parsed.data;
}
/** Registry calls charge durable budgets even when protocol parsing rejects an
 * otherwise bounded request. Invalid inputs never create a client/attempt. */
export class AgentOAuthRegistry {
 constructor(private readonly env=process.env,private readonly database:Pick<Database,'rpc'>=new Database(env)){}
 async register(raw:string){
  let parsed:z.infer<typeof metadata>;
  try{
   if(Buffer.byteLength(raw)>16_384)throw Error();
   parsed=metadata.parse(JSON.parse(raw));parsed.redirect_uris.forEach(validateRedirect);
  }catch{
   result(await this.database.rpc('fmat_oauth_register',{p_name:null,p_redirects:null,p_resource:oauthResource(this.env)}));
   throw new AgentOAuthError('invalid_client_metadata');
  }
  const client=checked(registered,await this.database.rpc('fmat_oauth_register',{p_name:parsed.client_name,p_redirects:parsed.redirect_uris,p_resource:oauthResource(this.env)}));
  if(client.resource!==oauthResource(this.env))throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  return {client_id:client.clientId,client_id_issued_at:Math.floor(Date.parse(client.createdAt)/1000),client_name:client.name,redirect_uris:client.redirectUris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']};
 }
 async start(raw:string){
  let input:ReturnType<typeof parseAuthorizationQuery>;
  const secret=randomBytes(32).toString('base64url');
  try{input=parseAuthorizationQuery(raw,this.env);}catch(error){
   let fields:Record<string,string>={};try{fields=decodeOAuthForm(raw);}catch{/* Still charge the global budget. */}
   const invalid={clientId:fields.client_id??'',resource:fields.resource??'',redirectUri:fields.redirect_uri??'',scope:fields.scope??'',state:fields.state??'',codeChallenge:fields.code_challenge??'',codeChallengeMethod:'invalid',browserHash:oauthSecretHash(secret)};
   const failure=await this.database.rpc('fmat_oauth_authorization_start',{p_input:invalid});
   if(failure&&typeof failure==='object'&&'error' in failure&&failure.error==='rate_limited')throw new AgentOAuthError('rate_limited',429);
   throw error;
  }
  const attempt=checked(started,await this.database.rpc('fmat_oauth_authorization_start',{p_input:{clientId:input.client_id,resource:input.resource,redirectUri:input.redirect_uri,scope:input.scope,state:input.state,codeChallenge:input.code_challenge,codeChallengeMethod:input.code_challenge_method,browserHash:oauthSecretHash(secret)}}));
  return {...attempt,binding:secret};
 }
 async read(id:string,secret:string){
  if(!z.uuid().safeParse(id).success||!binding.safeParse(secret).success)throw new AgentOAuthError('invalid_request');
  const state=checked(authorizationState,await this.database.rpc('fmat_oauth_authorization_read',{p_id:id,p_browser_hash:oauthSecretHash(secret)}));
  if(state.resource!==oauthResource(this.env)||state.authorizationId!==id)throw new AgentOAuthError('invalid_request');
  parseScopes(state.scope);validateRedirect(state.redirectUri);return state;
 }
 async decide(id:string,secret:string,decision:'grant'|'deny',credential:Credential|null){
  const state=await this.read(id,secret);
  if(decision==='grant'){
   if(!credential)throw new AgentOAuthError('invalid_grant');requireCredential(credential);
   if(state.scope.startsWith('host:')!==(credential.kind==='host'))throw new AgentOAuthError('invalid_grant');
  }
  // Stable only for this browser-bound attempt, so a lost response recovers the
  // same one-minute code. Neither the binding nor its hash enters client JS.
  const code=createHmac('sha256',secret).update('fmat-agent-code:'+id).digest('base64url');
  const outcome=checked(decisionResult,await this.database.rpc('fmat_oauth_consent',{p_id:id,p_browser_hash:oauthSecretHash(secret),p_credential:decision==='grant'?credential:null,p_decision:decision,p_code_hash:decision==='grant'?oauthSecretHash(code):null}));
  if(outcome.decision!==decision||outcome.redirectUri!==state.redirectUri||outcome.state!==state.state)throw new AgentOAuthError('invalid_request');
  if(decision==='grant'&&(!outcome.codeExpiresAt||Date.parse(outcome.codeExpiresAt)<=Date.now()))throw new AgentOAuthError('invalid_grant');
  const redirect=new URL(state.redirectUri);redirect.searchParams.delete('code');redirect.searchParams.delete('error');redirect.searchParams.delete('error_description');
  redirect.searchParams.set('state',state.state);
  redirect.searchParams.set(decision==='grant'?'code':'error',decision==='grant'?code:'access_denied');
  return {redirectUri:redirect.toString()};
 }
 async grants(credential:Credential,cursor:string|null=null){
  requireCredential(credential);
  if(cursor!==null&&!z.uuid().safeParse(cursor).success)throw new AgentOAuthError('invalid_request');
  return checked(z.strictObject({grants:z.array(z.strictObject({id:z.uuid(),clientName:z.string(),scope:z.string(),expiresAt:timestamp,clientDisabled:z.boolean()})).max(50),nextCursor:z.uuid().nullable()}),await this.database.rpc('fmat_oauth_grants_read',{p_credential:credential,p_cursor:cursor}));
 }
 async revoke(id:string,credential:Credential){
  requireCredential(credential);if(!z.uuid().safeParse(id).success)throw new AgentOAuthError('invalid_request');
  return checked(z.strictObject({revoked:z.literal(true)}),await this.database.rpc('fmat_oauth_grant_revoke',{p_id:id,p_credential:credential}));
 }
}

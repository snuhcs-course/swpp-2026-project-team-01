import {publicHandle} from '../contracts/handles.ts';
import {randomBytes,createHash} from 'node:crypto';
import {createLocalJWKSet,jwtVerify} from 'jose';
import {z} from 'zod';
import {cliOrigin,CliFailure} from './mcp.ts';
import type {StoredConnection} from './store.ts';
const secret=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const tokenResponse=z.object({access_token:z.string().max(8192),refresh_token:secret,token_type:z.literal('Bearer'),expires_in:z.number().int().positive().max(300),scope:z.string()});
const key=z.strictObject({kty:z.literal('EC'),crv:z.literal('P-256'),x:secret,y:secret,kid:z.string().min(1).max(64),alg:z.literal('ES256').optional(),use:z.literal('sig').optional()});
const claims=z.strictObject({iss:z.string(),aud:z.string(),sub:z.uuid(),client_id:z.uuid(),grant_id:z.uuid(),actor_kind:z.enum(['host','guest','intake']),scope:z.string(),iat:z.number().int(),exp:z.number().int(),jti:z.uuid()});
function scopes(value:string){const items=value.split(' ');if(!items.length||new Set(items).size!==items.length||!items.every(s=>(/^(host|request):(read|write|decide)$/u.test(s)||s==='request:intake'))||items.some(s=>s.startsWith('host:'))&&items.some(s=>s.startsWith('request:')))throw new CliFailure('INVALID_INPUT');return items.sort().join(' ');}
/** Fixed-origin application OAuth. No remote metadata can redirect secret-bearing requests. */
export class CliOAuthClient{
 readonly origin:string;
 constructor(origin:string,private readonly fetcher:typeof fetch=fetch,private readonly now=Date.now){this.origin=cliOrigin(origin);}
 private async http(path:string,body?:URLSearchParams|Record<string,unknown>,empty=false):Promise<unknown>{
  const signal=AbortSignal.timeout(15000);
  try{
   const response=await this.fetcher(this.origin+path,{method:body?'POST':'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal,
    headers:body?{'content-type':body instanceof URLSearchParams?'application/x-www-form-urlencoded':'application/json'}:undefined,
    body:body?(body instanceof URLSearchParams?body.toString():JSON.stringify(body)):undefined});
   if(!response.ok){await response.body?.cancel();throw Error();}
   if(empty){await response.body?.cancel();return null;}
   if(response.headers.get('content-type')?.split(';')[0].trim()!=='application/json'){await response.body?.cancel();throw Error();}
   const reader=response.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let size=0;
   try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>32768)throw Error();chunks.push(part.value);}}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  }catch{throw new CliFailure('LOGIN_REQUIRED');}
 }
 async discover():Promise<void>{
  try{
   const [metadata,resource]=await Promise.all([this.http('/.well-known/oauth-authorization-server'),this.http('/.well-known/oauth-protected-resource/mcp')]);
   z.object({issuer:z.literal(this.origin),authorization_endpoint:z.literal(this.origin+'/oauth/authorize'),token_endpoint:z.literal(this.origin+'/oauth/token'),registration_endpoint:z.literal(this.origin+'/oauth/register'),revocation_endpoint:z.literal(this.origin+'/oauth/revoke'),jwks_uri:z.literal(this.origin+'/oauth/jwks'),code_challenge_methods_supported:z.array(z.string()).refine(s=>s.includes('S256')),token_endpoint_auth_methods_supported:z.array(z.string()).refine(s=>s.includes('none'))}).parse(metadata);
   z.object({resource:z.literal(this.origin+'/mcp'),authorization_servers:z.tuple([z.literal(this.origin)])}).parse(resource);
  }catch{throw new CliFailure('LOGIN_REQUIRED');}
 }
 private async exchange(body:URLSearchParams,expectedScope:string,clientId:string):Promise<StoredConnection>{
  try{
   const token=tokenResponse.parse(await this.http('/oauth/token',body));
   const jwks=z.object({keys:z.array(key).min(1).max(4)}).parse(await this.http('/oauth/jwks'));
   if(new Set(jwks.keys.map(k=>k.kid)).size!==jwks.keys.length)throw Error();
   const verified=await jwtVerify(token.access_token,createLocalJWKSet(jwks),{algorithms:['ES256'],typ:'at+jwt',issuer:this.origin,audience:this.origin+'/mcp',currentDate:new Date(this.now()),clockTolerance:0,requiredClaims:['exp','iat','jti','sub','client_id','grant_id','actor_kind','scope']});
   const c=claims.parse(verified.payload),seconds=Math.floor(this.now()/1000);
   z.strictObject({alg:z.literal('ES256'),typ:z.literal('at+jwt'),kid:z.string()}).parse(verified.protectedHeader);
   if(c.client_id!==clientId||c.aud!==this.origin+'/mcp'||c.iat>seconds||c.exp<=seconds||c.exp<=c.iat||c.exp-c.iat>300||scopes(c.scope)!==c.scope||token.scope!==c.scope||!c.scope.split(' ').every(s=>expectedScope.split(' ').includes(s))||c.scope.startsWith('host:')!==(c.actor_kind==='host')||c.scope.split(' ').includes('request:intake')&&c.actor_kind!=='intake')throw Error();
   return {version:1,origin:this.origin,grantId:c.grant_id,clientId,actorKind:c.actor_kind,actorId:c.sub,scope:c.scope,accessToken:token.access_token,refreshToken:token.refresh_token,accessExpiresAt:c.exp*1000,state:'ready'};
  }catch{throw new CliFailure('LOGIN_REQUIRED');}
 }
 async begin(scope:string,redirectUri:string,requestId?:string,handle?:string){
  const requested=scopes(scope),intake=requested.split(' ').includes('request:intake');let callback:URL;
  if(intake?requestId!==undefined||!publicHandle.safeParse(handle).success:handle!==undefined)throw new CliFailure('INVALID_INPUT');
  try{callback=new URL(redirectUri);if(callback.protocol!=='http:'||callback.hostname!=='127.0.0.1'||!callback.port||callback.username||callback.password||callback.search||callback.hash||!/^\/callback\/[A-Za-z0-9_-]{43}$/u.test(callback.pathname))throw Error();if(requestId&&(!z.uuid().safeParse(requestId).success||!requested.startsWith('request:')))throw Error();}
  catch{throw new CliFailure('INVALID_INPUT');}
  await this.discover();
  let clientId:string;
  try{const registered=z.object({client_id:z.uuid(),redirect_uris:z.tuple([z.literal(redirectUri)]),token_endpoint_auth_method:z.literal('none')}).parse(await this.http('/oauth/register',{client_name:'Find Me a Time CLI',redirect_uris:[redirectUri],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']}));clientId=registered.client_id;}
  catch{throw new CliFailure('LOGIN_REQUIRED');}
  const verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('base64url'),expires=this.now()+600000;
  const query=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:requested,resource:this.origin+'/mcp',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});if(requestId)query.set('request_id',requestId);if(handle)query.set('handle',handle);
  let consumed=false;
  return {authorizationUrl:this.origin+'/oauth/authorize?'+query.toString(),complete:async(returned:string)=>{
   if(consumed||this.now()>=expires)throw new CliFailure('LOGIN_REQUIRED');
   let code:string;
   try{
    const url=new URL(returned),params=url.searchParams;
    if(url.origin!==callback.origin||url.pathname!==callback.pathname||url.username||url.password||url.hash||params.get('state')!==state||params.has('iss')&&params.get('iss')!==this.origin||Array.from(params.keys()).some(k=>!['state','code','error','error_description','iss'].includes(k))||new Set(params.keys()).size!==Array.from(params.keys()).length)throw Error();
    if(params.has('error')){consumed=true;throw Error();}
    code=secret.parse(params.get('code'));
   }catch{throw new CliFailure('LOGIN_REQUIRED');}
   consumed=true;
   const connection=await this.exchange(new URLSearchParams({grant_type:'authorization_code',client_id:clientId,resource:this.origin+'/mcp',code,redirect_uri:redirectUri,code_verifier:verifier}),requested,clientId);
   if(connection.actorKind!==(intake?'intake':requested.startsWith('host:')?'host':'guest')||requestId&&connection.actorId!==requestId)throw new CliFailure('LOGIN_REQUIRED');
   return connection;
  }};
 }
 async refresh(current:StoredConnection):Promise<StoredConnection>{
  if(current.origin!==this.origin)throw new CliFailure('LOGIN_REQUIRED');
  const next=await this.exchange(new URLSearchParams({grant_type:'refresh_token',client_id:current.clientId,resource:this.origin+'/mcp',refresh_token:current.refreshToken}),scopes(current.scope),current.clientId);
  if(next.grantId!==current.grantId||next.actorId!==current.actorId||next.actorKind!==current.actorKind||next.refreshToken===current.refreshToken)throw new CliFailure('LOGIN_REQUIRED');return next;
 }
 async revoke(current:StoredConnection):Promise<void>{
  if(current.origin!==this.origin)throw new CliFailure('LOGOUT_INCOMPLETE');
  try{await this.http('/oauth/revoke',new URLSearchParams({client_id:current.clientId,resource:this.origin+'/mcp',token:current.refreshToken}),true);}catch{throw new CliFailure('LOGOUT_INCOMPLETE');}
 }
}

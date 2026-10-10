import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {applicationOrigin} from '../../../lib/server/config.ts';
import {agentScopes,decodeOAuthForm,oauthResource} from '../../../lib/server/oauth/protocol.ts';
import {AgentOAuthRegistry} from '../../../lib/server/oauth/registry.ts';
import {AgentOAuthService} from '../../../lib/server/oauth/service.ts';
import {AgentOAuthTokens} from '../../../lib/server/oauth/tokens.ts';
import {oauthErrorResponse,oauthJson,readOAuthBody,requirePublicClientTransport} from '../../../lib/server/oauth/http.ts';

export function agentAuthorizationCookie(id:string,env=process.env){return (applicationOrigin(env).startsWith('https:')?'__Host-':'')+'fmat-agent-'+z.uuid().parse(id);}
export function agentLoginReturnCookie(env=process.env){return (applicationOrigin(env).startsWith('https:')?'__Host-':'')+'fmat-agent-return';}
export function agentConsentPath(id:string,requestId?:string|null){return '/connect/authorize?authorizationId='+z.uuid().parse(id)+(requestId?'&requestId='+z.uuid().parse(requestId):'');}

export function agentOAuthProtocol(env=process.env,registry=new AgentOAuthRegistry(env),service=new AgentOAuthService(env),tokens=new AgentOAuthTokens(env)){
 return async(request:NextRequest,action:string):Promise<Response>=>{
  const cors=action!=='authorize';
  const finish=(response:Response)=>{if(cors){response.headers.set('access-control-allow-origin','*');}return response;};
  try{
   const origin=applicationOrigin(env),get=['metadata','resource','jwks','authorize'].includes(action),post=['register','token','revoke'].includes(action);
   if(!get&&!post)return finish(oauthJson({error:'invalid_request'},404));
   if(request.method==='OPTIONS'&&cors)return new Response(null,{status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':get?'GET, HEAD, OPTIONS':'POST, OPTIONS','access-control-allow-headers':'content-type','cache-control':'no-store'}});
   if(!(get&&(request.method==='GET'||request.method==='HEAD'&&action!=='authorize')||post&&request.method==='POST')){
    const response=oauthJson({error:'invalid_request'},405);response.headers.set('allow',get?(action==='authorize'?'GET':'GET, HEAD, OPTIONS'):'POST, OPTIONS');return finish(response);
   }
   // Revocation must keep working during key removal/rotation incidents.
   if(action!=='revoke')await tokens.jwks();
   let response:Response;
   if(action==='metadata')response=oauthJson({issuer:origin,authorization_endpoint:origin+'/oauth/authorize',token_endpoint:origin+'/oauth/token',registration_endpoint:origin+'/oauth/register',revocation_endpoint:origin+'/oauth/revoke',jwks_uri:origin+'/oauth/jwks',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:agentScopes});
   else if(action==='resource')response=oauthJson({resource:oauthResource(env),authorization_servers:[origin],scopes_supported:agentScopes,bearer_methods_supported:['header']});
   else if(action==='jwks')response=oauthJson(await tokens.jwks());
   else if(action==='authorize'){
    const raw=request.nextUrl.search.slice(1),attempt=await registry.start(raw),hint=decodeOAuthForm(raw).request_id;
    const requestId=z.uuid().safeParse(hint);
    const next=NextResponse.redirect(origin+agentConsentPath(attempt.authorizationId,requestId.success?requestId.data:null),303);
    next.headers.set('cache-control','private, no-store');next.headers.set('pragma','no-cache');next.headers.set('referrer-policy','no-referrer');
    next.cookies.set(agentAuthorizationCookie(attempt.authorizationId,env),attempt.binding,{httpOnly:true,secure:origin.startsWith('https:'),sameSite:'lax',path:'/',maxAge:600});response=next;
   }else{
    requirePublicClientTransport(request);
    const raw=await readOAuthBody(request,action==='register'?'json':'form');
    if(action==='register')response=oauthJson(await registry.register(raw),201);
    else if(action==='token')response=oauthJson(await service.exchange(raw));
    else {await service.revoke(raw);response=new Response(null,{status:200,headers:{'cache-control':'no-store','pragma':'no-cache'}});}
   }
   if(request.method==='HEAD')response=new Response(null,{status:response.status,headers:response.headers});
   return finish(response);
  }catch(error){return finish(oauthErrorResponse(error));}
 };
}

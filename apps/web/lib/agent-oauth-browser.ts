import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {agentBrowserTarget,agentGrantTarget} from '../../../lib/contracts/agent-oauth.ts';
import {applicationOrigin} from '../../../lib/server/config.ts';
import {ApplicationError} from '../../../lib/server/errors.ts';
import {BrowserCommands} from '../../../lib/server/identity/browser-commands.ts';
import {guestCredential} from '../../../lib/server/identity/credentials.ts';
import {AgentOAuthRegistry} from '../../../lib/server/oauth/registry.ts';
import {AgentOAuthError,decodeOAuthForm} from '../../../lib/server/oauth/protocol.ts';
import {readOAuthBody} from '../../../lib/server/oauth/http.ts';
import {agentAuthorizationCookie,agentConsentPath,agentLoginReturnCookie} from './agent-oauth-protocol.ts';
import {browserSession,guestCookieName} from './session.ts';

export async function agentOAuthBrowser(request:NextRequest,action:string){
 const session=browserSession(request),registry=new AgentOAuthRegistry(),commands=new BrowserCommands();
 const json=(body:unknown)=>session.finish(NextResponse.json(body,{headers:{'referrer-policy':'no-referrer','vary':'Cookie'}}));
 async function credential(requestId?:string){return requestId?guestCredential(requestId,request.cookies.get(guestCookieName(requestId))?.value??''):(await session.host()).credential;}
 try{
  let input:unknown;
  if(request.method==='GET')input=decodeOAuthForm(request.nextUrl.search.slice(1));
  else {try{input=JSON.parse(await readOAuthBody(request,'json'));}catch(error){if(error instanceof AgentOAuthError)throw error;throw new ApplicationError('INVALID_INPUT',400);}}
  if(action==='grants'&&request.method==='GET'){
   const target=agentGrantTarget.parse(input);return json(await registry.grants(await credential(target.requestId),target.cursor??null));
  }
  if(action==='revoke'&&request.method==='POST'){
   const target=z.strictObject({requestId:z.uuid().optional(),grantId:z.uuid()}).parse(input);return json(await registry.revoke(target.grantId,await credential(target.requestId)));
  }
  if(action==='decide'&&request.method==='POST'){
   const target=agentBrowserTarget.extend({decision:z.enum(['grant','deny'])}).parse(input);
   return json(await registry.decide(target.authorizationId,request.cookies.get(agentAuthorizationCookie(target.authorizationId))?.value??'',target.decision,target.decision==='grant'?await credential(target.requestId):null));
  }
  const target=agentBrowserTarget.parse(input),state=await registry.read(target.authorizationId,request.cookies.get(agentAuthorizationCookie(target.authorizationId))?.value??'');
  if(action==='login'&&request.method==='POST'){
   if(!state.scope.startsWith('host:'))throw new AgentOAuthError('invalid_request');
   const {data,error}=await session.client.auth.signInWithOAuth({provider:'google',options:{redirectTo:applicationOrigin()+'/auth/callback',skipBrowserRedirect:true,scopes:'openid email profile',queryParams:{prompt:'select_account'}}});
   if(error||!data.url)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
   const response=json({url:data.url});response.cookies.set(agentLoginReturnCookie(),target.authorizationId,{httpOnly:true,secure:applicationOrigin().startsWith('https:'),sameSite:'lax',path:'/',maxAge:600});return response;
  }
  if(action==='state'&&request.method==='GET'){
   const view={authorizationId:state.authorizationId,clientName:state.clientName,redirectUri:state.redirectUri,scope:state.scope,expiresAt:state.expiresAt,decision:state.decision};
   if(state.scope.startsWith('host:')){
    try{const host=await commands.host((await session.host()).credential);return json({...view,audience:'host',access:host.admitted?'ready':'admission',label:host.email,requestId:null,requests:[]});}
    catch(error){if(error instanceof ApplicationError&&error.code==='UNAUTHORIZED')return json({...view,audience:'host',access:'sign_in',label:null,requestId:null,requests:[]});throw error;}
   }
   const ids=target.requestId?[target.requestId]:request.cookies.getAll().map(cookie=>cookie.name.startsWith('fmat-request-')?cookie.name.slice(13):'').filter(id=>z.uuid().safeParse(id).success).slice(-10);
   const requests=(await Promise.all(ids.map(async id=>{
    try{const guest=await commands.guest(await credential(id));return guest.closed?null:{id,title:guest.title??'Meeting request'};}catch(error){if(error instanceof ApplicationError&&['UNAUTHORIZED','NOT_FOUND','FORBIDDEN','HOST_NOT_ADMITTED'].includes(error.code))return null;throw error;}
   }))).filter((item):item is {id:string;title:string}=>item!==null);
   const selected=target.requestId?requests.find(item=>item.id===target.requestId):requests.length===1?requests[0]:null;
   return json({...view,audience:'guest',access:selected?'ready':'request_required',label:selected?.title??null,requestId:selected?.id??null,requests});
  }
  throw new ApplicationError('NOT_FOUND',404);
 }catch(error){
  if(error instanceof AgentOAuthError){return session.finish(NextResponse.json({error:{code:error.code,message:error.code==='invalid_grant'?'This permission is no longer available. Start a new connection from your agent.':'This connection attempt expired or belongs to another browser. Start again from your agent.'}},{status:error.status,headers:{'referrer-policy':'no-referrer','vary':'Cookie'}}));}
  throw error;
 }
}

/** The only OAuth login return is a locally built consent path with a UUID and
 * its original browser cookie. Never accept a URL supplied by a login caller. */
export function agentLoginReturn(request:NextRequest):string|null{
 const id=request.cookies.get(agentLoginReturnCookie())?.value;
 if(!z.uuid().safeParse(id).success)return null;
 if(!/^[A-Za-z0-9_-]{43}$/u.test(request.cookies.get(agentAuthorizationCookie(id!))?.value??''))return null;
 return agentConsentPath(id!);
}

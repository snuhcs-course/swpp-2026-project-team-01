import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {RequesterIdentity,type IdentityAuthority} from '../../../lib/server/identity/requester-identity.ts';
import {identityStart,identityApply,requesterIdentityTarget} from '../../../lib/contracts/requester-identity.ts';
import {intakeAttempt,intakeProof} from '../../../lib/contracts/intake.ts';
import {guestCredential} from '../../../lib/server/identity/credentials.ts';
import {ApplicationError} from '../../../lib/server/errors.ts';
import {applicationOrigin} from '../../../lib/server/config.ts';
import {privateHeaders,readJson} from '../../../lib/server/identity/request-credential.ts';
import {intakeCookie,attemptId} from './intake-browser.ts';
import {guestCookieName} from './session.ts';
export const requesterIdentity=new RequesterIdentity();
export const identityMarker='identity.';
export function identityCookie(state:string,secure:boolean){return (secure?'__Host-':'')+'fmat-identity-'+intakeProof.parse(state);}
export function identityAuthority(request:NextRequest,target:z.infer<typeof requesterIdentityTarget>):IdentityAuthority{
 if(target.kind==='guest')return guestCredential(target.requestId,request.cookies.get(guestCookieName(target.requestId))?.value??'');
 const token=intakeProof.safeParse(request.cookies.get(intakeCookie(target.handle))?.value);
 if(!token.success)throw new ApplicationError('UNAUTHORIZED',401);
 return {...target,token:token.data};
}
const base=z.strictObject({target:requesterIdentityTarget,attemptId:intakeAttempt.optional()});
export async function requesterIdentityBrowser(request:NextRequest,operation:string,service=requesterIdentity){
 const raw=request.method==='GET'?{target:request.nextUrl.searchParams.get('kind')==='intake'?{kind:'intake',handle:request.nextUrl.searchParams.get('handle')}:{kind:request.nextUrl.searchParams.get('kind'),requestId:request.nextUrl.searchParams.get('requestId')},attemptId:request.nextUrl.searchParams.get('attemptId')??undefined}:await readJson(request);
 const input=(operation==='start'?base.extend(identityStart.shape):operation==='apply'?base.extend(identityApply.shape):base).parse(raw);
 const authority=identityAuthority(request,input.target);
 if(authority.kind==='intake'&&input.attemptId!==attemptId(authority.token))throw new ApplicationError('STALE_REVISION',409);
 const json=(value:unknown)=>NextResponse.json(value,{headers:{...privateHeaders,'cache-control':'private, no-store',vary:'Cookie'}});
 if(operation==='state'&&request.method==='GET')return json(await service.read(authority));
 if(request.method!=='POST')throw new ApplicationError('NOT_FOUND',404);
 if(operation==='skip')return json(await service.skip(authority));
 if(operation==='apply'&&'email' in input)return json(await service.apply(authority,{revision:'revision' in input?input.revision:undefined,email:input.email}));
 if(operation==='start'&&'draft' in input){
  const started=await service.start(authority,{draft:input.draft,revision:'revision' in input?input.revision:undefined}),url=new URL(started.url),secure=applicationOrigin().startsWith('https:');
  // Namespace only the browser-visible OAuth state, preserving the random core.
  url.searchParams.set('state',identityMarker+started.state);
  const response=json({url:url.href});response.cookies.set(identityCookie(started.state,secure),started.binding,{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge:600});return response;
 }
 throw new ApplicationError('NOT_FOUND',404);
}
export async function requesterIdentityCallback(request:NextRequest,service=requesterIdentity){
 const origin=applicationOrigin(),secure=origin.startsWith('https:');let destination='/?identity=expired',cookie:string|undefined;
 try{
  const state=intakeProof.parse((request.nextUrl.searchParams.get('state')??'').slice(identityMarker.length));cookie=identityCookie(state,secure);
  const binding=intakeProof.parse(request.cookies.get(cookie)?.value),resolved=await service.lookup(state,binding);
  const target=resolved.kind==='intake'?{kind:'intake' as const,handle:resolved.target}:{kind:'guest' as const,requestId:resolved.target};
  // Target is trusted only for a safe error return. It never replaces authority.
  destination=(target.kind==='intake'?'/'+target.handle:'/booking/'+target.requestId)+'?identity=expired';
  const result=await service.callback(identityAuthority(request,target),{state,binding,code:request.nextUrl.searchParams.get('code'),denied:request.nextUrl.searchParams.has('error')});
  destination=result.returnPath+'?identity='+result.result;
 }catch{/* Never expose provider errors, codes, tokens or caller-supplied redirects. */}
 const response=NextResponse.redirect(new URL(destination,origin),303);for(const [name,value]of Object.entries({...privateHeaders,'cache-control':'private, no-store',vary:'Cookie'}))response.headers.set(name,value);
 if(cookie)response.cookies.set(cookie,'',{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge:0});return response;
}

import {createHash,randomBytes} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {intakeAttempt,intakeDetails,intakeProof,publicHandle,type IntakeContinuation} from '../../../lib/contracts/intake.ts';
import {PublicIntake} from '../../../lib/server/identity/public-intake.ts';
import {ApplicationError,publicError} from '../../../lib/server/errors.ts';
import {applicationOrigin} from '../../../lib/server/config.ts';
import {privateHeaders,readJson} from '../../../lib/server/identity/request-credential.ts';
import {guestCookieName} from './session.ts';

export function intakeCookie(handle:string){return (applicationOrigin().startsWith('https:')?'__Host-':'')+'fmat-intake-'+publicHandle.parse(handle);}
export function attemptId(token:string){return createHash('sha256').update('fmat-intake-attempt:'+intakeProof.parse(token)).digest('hex');}
export async function intakeBrowser(request:NextRequest,operation:string,service=new PublicIntake()){
 const json=(body:unknown)=>NextResponse.json(body,{headers:{...privateHeaders,'cache-control':'private, no-store',vary:'Cookie'}});
 if(request.method==='GET'&&operation==='profile')return json(await service.profile(publicHandle.parse(request.nextUrl.searchParams.get('handle'))));
 if(request.method!=='POST')throw new ApplicationError('NOT_FOUND',404);
 const body=await readJson(request),base=z.object({handle:publicHandle}).parse(body),cookie=intakeCookie(base.handle),secure=applicationOrigin().startsWith('https:');
 const existing=intakeProof.safeParse(request.cookies.get(cookie)?.value);
 if(operation==='bind'){
  z.strictObject({handle:publicHandle}).parse(body);
  const token=existing.success?existing.data:randomBytes(32).toString('base64url'),response=json({attemptId:attemptId(token)});
  if(!existing.success)response.cookies.set(cookie,token,{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge:30*86400});
  return response;
 }
 if(!existing.success)throw new ApplicationError('UNAUTHORIZED',401);
 const token=existing.data;
 const input=(operation==='create'?z.strictObject({handle:publicHandle,attemptId:intakeAttempt,details:intakeDetails}):z.strictObject({handle:publicHandle,attemptId:intakeAttempt})).parse(body);
 if(input.attemptId!==attemptId(token))throw new ApplicationError('STALE_REVISION',409);
 const finish=(continuation:IntakeContinuation|null)=>{
  const response=json(continuation);
  if(continuation)response.cookies.set(guestCookieName(continuation.requestId),token,{httpOnly:true,secure,sameSite:'lax',path:'/',
   maxAge:Math.max(0,Math.floor((Date.parse(continuation.tokenExpiresAt)-Date.now())/1000))});
  return response;
 };
 if(operation==='resume'){
  try{return finish(await service.resume(input.handle,token));}
  catch(error){
   if(!(error instanceof ApplicationError)||error.code!=='NOT_FOUND')throw error;
   // A revoked/expired proof cannot recover authority. Drop only this intake
   // binding so the next explicit retry can start fresh; transient errors keep it.
   const safe=publicError(error),response=NextResponse.json(safe.body,{status:safe.status,headers:{...privateHeaders,'cache-control':'private, no-store',vary:'Cookie'}});
   response.cookies.set(cookie,'',{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge:0});return response;
  }
 }
 if(operation==='create'&&'details' in input)return finish(await service.create(input.handle,token,input.details));
 if(operation==='new'){
  // An explicit new request keeps the existing request's cookie and receipt.
  // A missing result is not permission to discard an uncertain submission.
  try{if(!await service.resume(input.handle,token))throw new ApplicationError('STALE_REVISION',409);}
  catch(error){if(!(error instanceof ApplicationError)||error.code!=='NOT_FOUND')throw error;}
  const next=randomBytes(32).toString('base64url'),response=json({attemptId:attemptId(next)});
  response.cookies.set(cookie,next,{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge:30*86400});return response;
 }
 throw new ApplicationError('NOT_FOUND',404);
}

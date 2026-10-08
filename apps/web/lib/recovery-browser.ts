import {NextRequest,NextResponse} from 'next/server';
import {recoveryStart,recoveryRedeem,recoveryResult} from '../../../lib/contracts/requester-recovery.ts';
import {RequesterRecovery} from '../../../lib/server/contact/recovery.ts';
import {applicationOrigin} from '../../../lib/server/config.ts';
import {requireSameOrigin} from '../../../lib/server/identity/http.ts';
import {privateHeaders,readJson} from '../../../lib/server/identity/request-credential.ts';
import {ApplicationError} from '../../../lib/server/errors.ts';
import {guestCookieName} from './session.ts';
export async function recoveryBrowser(request:NextRequest,operation:string,service=new RequesterRecovery()){
 if(request.method!=='POST'||!['start','redeem'].includes(operation))throw new ApplicationError('NOT_FOUND',404);
 requireSameOrigin(request,applicationOrigin());
 const json=(body:unknown)=>NextResponse.json(body,{headers:{...privateHeaders,'cache-control':'private, no-store',vary:'Cookie'}});
 const body=await readJson(request);
 if(operation==='start')return json(await service.start(recoveryStart.parse(body)));
 const input=recoveryRedeem.parse(body),{token,...value}=await service.redeem(input),result=recoveryResult.parse(value);
 if(result.requestId!==input.requestId||!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=Date.now())throw new ApplicationError('CHALLENGE_INVALID',400);
 const response=json(result);
 response.cookies.delete('fmat-receipt-'+input.requestId);
 response.cookies.set(guestCookieName(input.requestId),token,{httpOnly:true,secure:applicationOrigin().startsWith('https:'),sameSite:'lax',path:'/',maxAge:Math.max(0,Math.floor((Date.parse(result.expiresAt)-Date.now())/1000))});
 return response;
}

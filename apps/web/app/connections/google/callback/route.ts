import {NextRequest,NextResponse} from 'next/server';
import {applicationOrigin} from '../../../../../../lib/server/config.ts';
import {opaque} from '../../../../../../lib/server/calendar/consent.ts';
import {calendarCommands,calendarCookie} from '../../../../lib/calendar-browser.ts';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:NextRequest){
  const origin=applicationOrigin(),secure=origin.startsWith('https:');
  const state=opaque.safeParse(request.nextUrl.searchParams.get('state'));let destination='/app?calendar=expired',cookie:string|undefined;
  try{
    if(!state.success)throw new Error();cookie=calendarCookie(state.data,secure);
    const result=await calendarCommands.callback(state.data,request.cookies.get(cookie)?.value??'',request.nextUrl.searchParams.get('code'),request.nextUrl.searchParams.has('error'));
    destination=result.returnPath+'?calendar='+result.result;
  }catch{/* No provider errors, codes or credentials in the redirect. */}
  const response=NextResponse.redirect(new URL(destination,origin),303);
  response.headers.set('cache-control','private, no-store');response.headers.set('referrer-policy','no-referrer');response.headers.set('vary','Cookie');
  if(cookie)response.cookies.set(cookie,'',{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge:0});
  return response;
}

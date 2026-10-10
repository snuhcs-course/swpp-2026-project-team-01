import {NextRequest} from 'next/server';
import {calendarTarget} from '../../../lib/contracts/calendar.ts';
import {CalendarConsent,opaque} from '../../../lib/server/calendar/consent.ts';
import {guestCredential} from '../../../lib/server/identity/credentials.ts';
import {browserSession,guestCookieName} from './session.ts';
export const calendarCommands=new CalendarConsent();
export function calendarCookie(state:string,secure:boolean){return (secure?'__Host-':'')+'fmat-google-'+opaque.parse(state);}
export async function calendarCredential(request:NextRequest,session:ReturnType<typeof browserSession>,input:unknown){
  const {requestId}=calendarTarget.parse(input);
  return requestId?guestCredential(requestId,request.cookies.get(guestCookieName(requestId))?.value??''):(await session.host()).credential;
}

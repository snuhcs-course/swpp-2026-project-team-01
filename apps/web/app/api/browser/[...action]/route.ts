import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { emailInput, guestExchange } from '../../../../../../lib/contracts/browser.ts';
import { applicationOrigin } from '../../../../../../lib/server/config.ts';
import { ApplicationError, publicError } from '../../../../../../lib/server/errors.ts';
import { BrowserCommands } from '../../../../../../lib/server/identity/browser-commands.ts';
import { guestCredential } from '../../../../../../lib/server/identity/credentials.ts';
import { requireSameOrigin } from '../../../../../../lib/server/identity/http.ts';
import { privateHeaders, readJson } from '../../../../../../lib/server/identity/request-credential.ts';
import { browserSession, guestCookieName } from '../../../../lib/session.ts';
import { calendarCommands, calendarCookie, calendarCredential } from '../../../../lib/calendar-browser.ts';
import { conversationGateway } from '../../../../lib/conversation-gateway.ts';
import { RequesterAvailability } from '../../../../../../lib/server/calendar/requester-availability.ts';
import { CalendarSelection } from '../../../../../../lib/server/calendar/selection.ts';

export const dynamic='force-dynamic';
export const maxDuration=60;
const commands=new BrowserCommands();
const browserHeaders={...privateHeaders,'cache-control':'private, no-store',vary:'Cookie'};
type Context={params:Promise<{action:string[]}>};
async function handle(request:NextRequest,{params}:Context) {
  let session: ReturnType<typeof browserSession>|undefined;
  try {
    const action=(await params).action.join('/');
    if(request.method==='POST')requireSameOrigin(request,applicationOrigin());
    const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:browserHeaders});
    if(action==='waitlist'&&request.method==='POST')return json(await commands.waitlist(await readJson(request)));
    if(action==='guest/exchange'&&request.method==='POST') {
      const {requestId,token}=guestExchange.parse(await readJson(request));
      const state=await commands.guest(guestCredential(requestId,token));
      const response=json(state);
      response.cookies.set(guestCookieName(requestId),token,{httpOnly:true,secure:applicationOrigin().startsWith('https:'),sameSite:'lax',path:'/',maxAge:30*86400});
      return response;
    }
    if(action==='guest/state'&&request.method==='GET') {
      const requestId=z.uuid().parse(request.nextUrl.searchParams.get('requestId'));
      return json(await commands.guest(guestCredential(requestId,request.cookies.get(guestCookieName(requestId))?.value??'')));
    }
    session=browserSession(request);
    if(action==='conversations'||action.startsWith('conversations/'))return session.finish(await conversationGateway(request,(await params).action,session));
    if(action.startsWith('availability/')&&['status','list','select','manual','check'].includes(action.slice(13))) {
      const operation=action.slice(13),service=new RequesterAvailability();
      if(request.method==='GET'&&(operation==='status'||operation==='list')) {
        const requestId=z.uuid().parse(request.nextUrl.searchParams.get('requestId'));
        const credential=await calendarCredential(request,session,{requestId});
        return session.finish(json(await service[operation](credential)));
      }
      if(request.method==='POST'&&['select','manual','check'].includes(operation)) {
        const {requestId,input}=z.strictObject({requestId:z.uuid(),input:z.unknown()}).parse(await readJson(request));
        const credential=await calendarCredential(request,session,{requestId});
        return session.finish(json(operation==='check'?await service.check(credential):await service[operation as 'select'|'manual'](credential,input)));
      }
    }
    if(action==='calendar/list'&&request.method==='GET') {
      const {credential}=await session.host();
      return session.finish(json(await new CalendarSelection().list(credential)));
    }
    if(action==='calendar/select'&&request.method==='POST') {
      const {credential}=await session.host();
      return session.finish(json(await new CalendarSelection().select(credential,await readJson(request))));
    }
    if(action==='calendar/status'&&request.method==='GET') {
      const requestId=request.nextUrl.searchParams.get('requestId');
      return session.finish(json(await calendarCommands.status(await calendarCredential(request,session,requestId?{requestId}:{}))));
    }
    if((action==='calendar/start'||action==='calendar/disconnect')&&request.method==='POST') {
      const credential=await calendarCredential(request,session,await readJson(request));
      if(action==='calendar/disconnect')return session.finish(json(await calendarCommands.disconnect(credential)));
      const started=await calendarCommands.start(credential),secure=applicationOrigin().startsWith('https:');
      const response=json({url:started.url});
      response.cookies.set(calendarCookie(started.state,secure),started.binding,{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge:600});
      return session.finish(response);
    }
    if(action==='auth/start'&&request.method==='POST') {
      const {email}=emailInput.parse(await readJson(request));
      const {error}=await session.client.auth.signInWithOtp({email,options:{emailRedirectTo:applicationOrigin()+'/auth/callback'}});
      if(error)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
      return session.finish(json({sent:true}));
    }
    if(action==='auth/logout'&&request.method==='POST') {
      const {error}=await session.client.auth.signOut({scope:'local'});
      if(error)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
      return session.finish(json({signedOut:true}));
    }
    if(action==='host/state'&&request.method==='GET') {
      const {credential}=await session.host();return session.finish(json(await commands.host(credential)));
    }
    if(action==='host/redeem'&&request.method==='POST') {
      const {credential}=await session.host();return session.finish(json(await commands.redeem(credential,await readJson(request))));
    }
    throw new ApplicationError('NOT_FOUND',404);
  } catch(error) {
    const safe=publicError(error instanceof ZodError?new ApplicationError('INVALID_INPUT',400):error);
    const response=NextResponse.json(safe.body,{status:safe.status,headers:browserHeaders});
    return session?session.finish(response):response;
  }
}
export const GET=handle;
export const POST=handle;

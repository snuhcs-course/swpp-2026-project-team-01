import {RequesterEmailLinking} from '../../../../../../lib/server/agentmail/linking.ts';
import {emailLinkTarget,emailLinkStart,emailLinkRevoke} from '../../../../../../lib/contracts/requester-email.ts';
import {requesterIdentityBrowser} from '../../../../lib/requester-identity-browser.ts';
import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { guestExchange } from '../../../../../../lib/contracts/browser.ts';
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
import { CalendarScans } from '../../../../../../lib/server/calendar/scans.ts';
import { HostSetup } from '../../../../../../lib/server/setup/commands.ts';
import { CalendarSelection } from '../../../../../../lib/server/calendar/selection.ts';
import {imessageEntryBrowser} from '../../../../lib/imessage-entry-browser.ts';
import { imessageBrowser } from '../../../../lib/imessage-browser.ts';
import {RequestReview} from '../../../../../../lib/server/identity/request-review.ts';
import {PreferenceDecisions} from '../../../../../../lib/server/scheduling/preference-decisions.ts';
import {TravelAllowances} from '../../../../../../lib/server/scheduling/allowances.ts';
import {SchedulingPublication} from '../../../../../../lib/server/scheduling/publication.ts';
import {AvailabilityEvaluation} from '../../../../../../lib/server/scheduling/availability.ts';
import {availabilityCheckInput} from '../../../../../../lib/contracts/availability-evaluation.ts';
import {BookingReceipt,bookingReceiptCredential} from '../../../../../../lib/server/booking/receipt.ts';
import {BookingApproval} from '../../../../../../lib/server/booking/approval.ts';
import {ContactVerification} from '../../../../../../lib/server/contact/verification.ts';
import {contactStart,contactConfirm,contactTarget} from '../../../../../../lib/contracts/contact-verification.ts';
import {RequestLifecycle} from '../../../../../../lib/server/scheduling/lifecycle.ts';
import {PrivateReview} from '../../../../../../lib/server/scheduling/private-review.ts';
import {HostRequests} from '../../../../../../lib/server/identity/host-requests.ts';
import { intakeBrowser } from '../../../../lib/intake-browser.ts';

export const dynamic='force-dynamic';
// Refresh, two availability reads, adjacent events and Routes retain separate
// bounded deadlines; allow their combined authorized evaluation to finish.
export const maxDuration=120;
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
    if(action.startsWith('requester-identity/'))return await requesterIdentityBrowser(request,action.slice(19));
    if(action.startsWith('intake/'))return await intakeBrowser(request,action.slice(7));
    if(action==='guest/exchange'&&request.method==='POST') {
      const {requestId,token}=guestExchange.parse(await readJson(request));
      const state=await commands.guest(guestCredential(requestId,token));
      const response=json(state);
      response.cookies.delete('fmat-receipt-'+requestId);
      response.cookies.set(guestCookieName(requestId),token,{httpOnly:true,secure:applicationOrigin().startsWith('https:'),sameSite:'lax',path:'/',maxAge:30*86400});
      return response;
    }
    if(action==='guest/state'&&request.method==='GET') {
      const requestId=z.uuid().parse(request.nextUrl.searchParams.get('requestId'));
      return json(await commands.guest(guestCredential(requestId,request.cookies.get(guestCookieName(requestId))?.value??'')));
    }
    if(action==='booking-receipt/exchange'&&request.method==='POST') {
      const {requestId,token}=guestExchange.parse(await readJson(request));
      const state=await new BookingReceipt().read(bookingReceiptCredential(requestId,token),{requestId}),response=json(state);
      response.cookies.set('fmat-receipt-'+requestId,token,{httpOnly:true,secure:applicationOrigin().startsWith('https:'),sameSite:'lax',path:'/',maxAge:30*86400});
      return response;
    }
    if(action==='requester-email/state'&&request.method==='GET') {
      const input=emailLinkTarget.parse(Object.fromEntries(request.nextUrl.searchParams));
      return json(await new RequesterEmailLinking().read(guestCredential(input.requestId,request.cookies.get(guestCookieName(input.requestId))?.value??''),input));
    }
    if(['requester-email/start','requester-email/revoke'].includes(action)&&request.method==='POST') {
      const operation=action==='requester-email/start'?'start':'revoke';
      const input=(operation==='start'?emailLinkStart:emailLinkRevoke).parse(await readJson(request));
      return json(await new RequesterEmailLinking()[operation](guestCredential(input.requestId,request.cookies.get(guestCookieName(input.requestId))?.value??''),input));
    }
    if(action==='contact-verification/state'&&request.method==='GET') {
      const input=contactTarget.parse(Object.fromEntries(request.nextUrl.searchParams));
      return json(await new ContactVerification().read(guestCredential(input.requestId,request.cookies.get(guestCookieName(input.requestId))?.value??''),input));
    }
    if(['contact-verification/start','contact-verification/confirm'].includes(action)&&request.method==='POST') {
      const operation=action==='contact-verification/start'?'start':'confirm';
      const input=(operation==='start'?contactStart:contactConfirm).parse(await readJson(request));
      return json(await new ContactVerification()[operation](guestCredential(input.requestId,request.cookies.get(guestCookieName(input.requestId))?.value??''),input));
    }
    if(action==='request-review/read'&&request.method==='GET') {
      const requestId=z.uuid().parse(request.nextUrl.searchParams.get('requestId'));
      return json(await new RequestReview().read(guestCredential(requestId,request.cookies.get(guestCookieName(requestId))?.value??'')));
    }
    if(['request-review/apply','request-review/dismiss'].includes(action)&&request.method==='POST') {
      const {requestId,input}=z.strictObject({requestId:z.uuid(),input:z.unknown()}).parse(await readJson(request));
      return json(await new RequestReview().decide(action==='request-review/apply'?'apply':'dismiss',guestCredential(requestId,request.cookies.get(guestCookieName(requestId))?.value??''),input));
    }
    if(action.startsWith('imessage-entry/'))return await imessageEntryBrowser(request,action.slice(15));
    session=browserSession(request);
    if(['host/requests','host/request'].includes(action)&&request.method==='GET') {
      const {credential}=await session.host(),service=new HostRequests();
      const input=Object.fromEntries(request.nextUrl.searchParams);
      return session.finish(json(await service[action==='host/requests'?'list':'read'](credential,input)));
    }
    if(action==='booking-receipt'&&request.method==='GET') {
      const {requestId,audience}=z.strictObject({requestId:z.uuid(),audience:z.enum(['host','guest'])}).parse(Object.fromEntries(request.nextUrl.searchParams));
      const receiptToken=audience==='guest'?request.cookies.get('fmat-receipt-'+requestId)?.value:undefined;
      const credential=audience==='host'?(await session.host()).credential:receiptToken?bookingReceiptCredential(requestId,receiptToken):guestCredential(requestId,request.cookies.get(guestCookieName(requestId))?.value??'');
      return session.finish(json(await new BookingReceipt().read(credential,{requestId})));
    }
    if(action==='booking-approval/state'&&request.method==='GET') {
      const {credential}=await session.host();
      return session.finish(json(await new BookingApproval().read(credential,Object.fromEntries(request.nextUrl.searchParams))));
    }
    if(action==='booking-approval/approve'&&request.method==='POST') {
      const {credential}=await session.host();
      return session.finish(json(await new BookingApproval().approve(credential,await readJson(request))));
    }
    if(action==='request-lifecycle/state'&&request.method==='GET') {
      const {requestId,audience}=z.strictObject({requestId:z.uuid(),audience:z.enum(['host','guest'])}).parse(Object.fromEntries(request.nextUrl.searchParams));
      const credential=audience==='host'?(await session.host()).credential:guestCredential(requestId,request.cookies.get(guestCookieName(requestId))?.value??'');
      return session.finish(json(await new RequestLifecycle().read(credential,{requestId})));
    }
    if(['request-lifecycle/withdraw','request-lifecycle/decline'].includes(action)&&request.method==='POST') {
      const input=z.object({requestId:z.uuid()}).loose().parse(await readJson(request));
      const operation=action==='request-lifecycle/withdraw'?'withdraw':'decline';
      const credential=operation==='decline'?(await session.host()).credential:guestCredential(input.requestId,request.cookies.get(guestCookieName(input.requestId))?.value??'');
      return session.finish(json(await new RequestLifecycle()[operation](credential,input)));
    }
    if(action==='scheduling/private'&&request.method==='GET') {
      const {credential}=await session.host();
      return session.finish(json(await new PrivateReview().read(credential,Object.fromEntries(request.nextUrl.searchParams))));
    }
    if(action==='scheduling/private/evaluate'&&request.method==='POST') {
      const {credential}=await session.host();
      return session.finish(json(await new PrivateReview().evaluate(credential,await readJson(request))));
    }
    if(action==='scheduling/state'&&request.method==='GET') {
      const {requestId,audience}=z.strictObject({requestId:z.uuid(),audience:z.enum(['host','guest'])}).parse(Object.fromEntries(request.nextUrl.searchParams));
      const credential=audience==='host'?(await session.host()).credential:guestCredential(requestId,request.cookies.get(guestCookieName(requestId))?.value??'');
      return session.finish(json(await new SchedulingPublication().read(credential,{requestId})));
    }
    if(['scheduling/evaluate','scheduling/select','scheduling/agree'].includes(action)&&request.method==='POST') {
      const {audience,...input}=z.object({audience:z.enum(['host','guest']),requestId:z.uuid()}).loose().parse(await readJson(request));
      const credential=audience==='host'?(await session.host()).credential:guestCredential(input.requestId,request.cookies.get(guestCookieName(input.requestId))?.value??'');
      const operation=action.slice('scheduling/'.length) as 'evaluate'|'select'|'agree';
      return session.finish(json(await new SchedulingPublication()[operation](credential,input)));
    }
    if(action==='scheduling/check'&&request.method==='POST') {
      const {audience,...input}=availabilityCheckInput.extend({audience:z.enum(['host','guest'])}).parse(await readJson(request));
      const {requestId}=input;
      const credential=audience==='host'?(await session.host()).credential:guestCredential(requestId,request.cookies.get(guestCookieName(requestId))?.value??'');
      return session.finish(json(await new AvailabilityEvaluation().check(credential,input)));
    }
    if(['scheduling/preferences/confirm','scheduling/preferences/revoke'].includes(action)&&request.method==='POST') {
      const {credential}=await session.host(),service=new PreferenceDecisions();
      return session.finish(json(await service[action.endsWith('/confirm')?'confirm':'revoke'](credential,await readJson(request))));
    }
    if(['scheduling/allowances/confirm','scheduling/allowances/revoke'].includes(action)&&request.method==='POST') {
      const {credential}=await session.host(),service=new TravelAllowances();
      return session.finish(json(await service[action.endsWith('/confirm')?'confirm':'revoke'](credential,await readJson(request))));
    }
    if(action.startsWith('imessage/')&&['read','bind','start','continue','verify','cancel','skip','unlink'].includes(action.slice(9))){
      const {credential}=await session.host();
      return session.finish(await imessageBrowser(request,action.slice(9),credential));
    }
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
    if(['analysis/read','analysis/start','analysis/apply','analysis/dismiss'].includes(action)) {
      const {credential}=await session.host(),service=new CalendarScans();
      if(action==='analysis/read'&&request.method==='GET')return session.finish(json(await service.read(credential)));
      if(request.method==='POST'&&action!=='analysis/read')return session.finish(json(await service[action==='analysis/start'?'start':action==='analysis/apply'?'apply':'dismiss'](credential,await readJson(request))));
    }
    if(['setup/read','setup/draft','setup/progress','setup/rebase','setup/confirm'].includes(action)) {
      const {credential}=await session.host(),service=new HostSetup();
      if(action==='setup/read'&&request.method==='GET')return session.finish(json(await service.read(credential)));
      if(request.method==='POST'&&action!=='setup/read')return session.finish(json(await service[action==='setup/draft'?'draft':action==='setup/progress'?'progress':action==='setup/rebase'?'rebase':'confirm'](credential,await readJson(request))));
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
      z.strictObject({}).parse(await readJson(request));
      const {data,error}=await session.client.auth.signInWithOAuth({provider:'google',options:{
        redirectTo:applicationOrigin()+'/auth/callback',skipBrowserRedirect:true,
        scopes:'openid email profile',queryParams:{prompt:'select_account'},
      }});
      if(error||!data.url)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
      return session.finish(json({url:data.url}));
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

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { conversationCursor, conversationSnapshot, conversationView, incomingMessage, messageReceipt, openConversation } from '../../../lib/contracts/conversations.ts';
import { errorCode } from '../../../lib/contracts/errors.ts';
import {conversationRecoveryInput,conversationRecoveryStatus} from '../../../lib/contracts/conversation-recovery.ts';
import { applicationOrigin } from '../../../lib/server/config.ts';
import { ApplicationError } from '../../../lib/server/errors.ts';
import { guestCredential } from '../../../lib/server/identity/credentials.ts';
import { readJson } from '../../../lib/server/identity/request-credential.ts';
import { browserSession, guestCookieName } from './session.ts';

export function runtimeOrigin() {
  const origin=applicationOrigin(),override=process.env.EVE_LOCAL_ORIGIN;
  if(!override)return origin;
  const local=(url:URL)=>['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const target=applicationOrigin({...process.env,APP_ORIGIN:override});
  if(!local(new URL(origin))||!local(new URL(target)))throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  return target;
}

// Relay only the application-owned routes. Never forward cookies, arbitrary
// destinations, framework controls, or caller-supplied authorization headers.
export async function conversationGateway(request:NextRequest,parts:string[],session:ReturnType<typeof browserSession>) {
  const suffix=parts.slice(1);
  const open=suffix.length===0&&request.method==='POST';
  if(!open&&!(suffix.length===1&&request.method==='GET')&&!(suffix.length===2&&
      ((suffix[1]==='messages'&&request.method==='POST')||(suffix[1]==='stream'&&request.method==='GET')||(suffix[1]==='recovery'&&['GET','POST'].includes(request.method)))))throw new ApplicationError('NOT_FOUND',404);
  if(suffix.length)z.uuid().parse(suffix[0]);
  const headers=new Headers();
  const requestId=request.nextUrl.searchParams.get('requestId');
  if(requestId!==null) {
    z.uuid().parse(requestId);
    const token=request.cookies.get(guestCookieName(requestId))?.value??'';
    guestCredential(requestId,token);
    headers.set('authorization','Request '+token);headers.set('x-request-id',requestId);
  } else {
    const {token}=await session.host();headers.set('authorization','Bearer '+token);
  }
  let body:string|undefined;
  if(request.method==='POST') {
    body=JSON.stringify((open?openConversation:suffix[1]==='recovery'?conversationRecoveryInput:incomingMessage).parse(await readJson(request)));
    headers.set('content-type','application/json');
  }
  const url=new URL('/api/conversations'+(suffix.length?'/'+suffix.join('/'):''),runtimeOrigin());
  const stream=suffix[1]==='stream';
  if(stream)url.searchParams.set('cursor',String(conversationCursor.parse(request.nextUrl.searchParams.get('cursor')??'0')));
  let response:Response;
  try {response=await fetch(url,{method:request.method,headers,body,redirect:'error',cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(stream?55_000:30_000)])});}
  catch {throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
  if(!response.ok) {
    const data=await response.json().catch(()=>null),code=errorCode.safeParse(data?.error?.code);
    throw new ApplicationError(code.success?code.data:'PROVIDER_UNAVAILABLE',code.success?response.status:503);
  }
  const privateHeaders={'cache-control':'private, no-store',vary:'Cookie','referrer-policy':'no-referrer'};
  if(stream) {
    if(response.status===204)return new NextResponse(null,{status:204,headers:privateHeaders});
    if(!response.headers.get('content-type')?.startsWith('application/x-ndjson'))throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
    return new NextResponse(response.body,{headers:{...privateHeaders,'content-type':'application/x-ndjson; charset=utf-8'}});
  }
  const schema=suffix[1]==='recovery'?conversationRecoveryStatus:open?conversationView:request.method==='POST'?messageReceipt:conversationSnapshot;
  return NextResponse.json(schema.parse(await response.json()),{status:response.status,headers:privateHeaders});
}

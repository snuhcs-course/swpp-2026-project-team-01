import {agentLoginReturn} from '../../../lib/agent-oauth-browser.ts';
import {agentLoginReturnCookie} from '../../../lib/agent-oauth-protocol.ts';
import { NextRequest, NextResponse } from 'next/server';
import { applicationOrigin } from '../../../../../lib/server/config.ts';
import { browserSession } from '../../../lib/session.ts';
export async function GET(request:NextRequest) {
  const origin=applicationOrigin();
  const session=browserSession(request),returnPath=agentLoginReturn(request);
  const finish=(path:string)=>{const response=NextResponse.redirect(origin+path,303);response.cookies.delete(agentLoginReturnCookie());return session.finish(response);};
  const code=request.nextUrl.searchParams.get('code');
  if(!request.nextUrl.searchParams.has('error')&&code&&code.length<=2000) {
    try {
      const {error}=await session.client.auth.exchangeCodeForSession(code);
      if(!error)return finish(returnPath??'/app');
    } catch {
      // Network failures use the same recoverable state; never expose provider errors.
    }
  }
  return finish(returnPath?returnPath+'&auth=expired':'/app?auth=expired');
}

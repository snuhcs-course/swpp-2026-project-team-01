import { NextRequest, NextResponse } from 'next/server';
import { applicationOrigin } from '../../../../../lib/server/config.ts';
import { browserSession } from '../../../lib/session.ts';
export async function GET(request:NextRequest) {
  const origin=applicationOrigin();
  const session=browserSession(request);
  const code=request.nextUrl.searchParams.get('code');
  if(code&&code.length<=2000) {
    try {
      const {error}=await session.client.auth.exchangeCodeForSession(code);
      if(!error)return session.finish(NextResponse.redirect(origin+'/app',303));
    } catch {
      // Network failures use the same recoverable state; never expose provider errors.
    }
  }
  return session.finish(NextResponse.redirect(origin+'/app?auth=expired',303));
}

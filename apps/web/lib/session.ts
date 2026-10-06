import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { applicationOrigin, requiredEnv } from '../../../lib/server/config.ts';
import { supabaseOrigin } from '../../../lib/server/database/client.ts';
import { ApplicationError } from '../../../lib/server/errors.ts';
import { verifyHostToken } from '../../../lib/server/identity/credentials.ts';

// Only Route Handlers use this client. All refreshed cookies are attached to
// their response; no browser SDK, local storage, or Server Component refresh.
export function browserSession(request: NextRequest) {
  const secure=applicationOrigin().startsWith('https:');
  const jar=new Map(request.cookies.getAll().map(c=>[c.name,c.value]));
  const changes=new Map<string,{value:string;options:CookieOptions}>();
  const client=createServerClient(supabaseOrigin(),requiredEnv('SUPABASE_PUBLISHABLE_KEY'),{
    cookieOptions:{name:secure?'__Host-fmat-auth':'fmat-auth',httpOnly:true,secure,sameSite:'lax',path:'/'},
    cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll(values){
      for(const {name,value,options} of values){jar.set(name,value);changes.set(name,{value,options});}
    }},
  });
  return { client,
    async host() {
      const {data,error}=await client.auth.getSession();
      if(error||!data.session)throw new ApplicationError('UNAUTHORIZED',401);
      // getSession supplies the raw token only; never use its embedded user.
      const credential=await verifyHostToken(data.session.access_token);
      return {credential,token:data.session.access_token};
    },
    finish(response: NextResponse) {
      for(const [name,{value,options}] of changes)response.cookies.set(name,value,{...options,httpOnly:true,secure,sameSite:'lax',path:'/'});
      response.headers.set('Cache-Control','private, no-store');response.headers.set('Pragma','no-cache');
      return response;
    },
  };
}
export function guestCookieName(requestId:string) {return 'fmat-request-'+requestId;}

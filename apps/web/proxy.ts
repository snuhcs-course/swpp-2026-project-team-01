import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({request});
  if (!request.cookies.getAll().some(c=>c.name.startsWith("sb-") && c.name.includes("-auth-token"))) return response;
  const client = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: { httpOnly:true, sameSite:"lax", secure:process.env.NODE_ENV==="production", path:"/" },
    cookies: {
      getAll() {return request.cookies.getAll();},
      setAll(values) {
        values.forEach(({name,value})=>request.cookies.set(name,value));
        response=NextResponse.next({request});
        values.forEach(({name,value,options})=>response.cookies.set(name,value,options));
      },
    },
  });
  await client.auth.getClaims();
  response.headers.set("Cache-Control","private, no-store");
  return response;
}
export const config = { matcher: ["/owner/:path*", "/account/:path*", "/login", "/request/:path*", "/api/:path*"] };

import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { type SupabaseAuthConfig, supabaseAuthConfigFromEnvironment } from "./supabase-auth";

// The one place a Supabase session is refreshed (the standard @supabase/ssr
// Next.js proxy). It runs before every page and route, writes refreshed cookies
// onto both the forwarded request and the browser's response, and never decides
// access: routes and the agent verify the access token they receive and never
// refresh, so a refresh token is spent exactly once.
export async function updateSession(request: NextRequest, config: SupabaseAuthConfig = supabaseAuthConfigFromEnvironment()) {
  let response = NextResponse.next({ request });

  const client = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies, headers) => {
        for (const { name, value } of cookies) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, options, value } of cookies) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Refreshes an expiring session. Nothing may run between creating the client
  // and this call, or a refresh could be lost.
  await client.auth.getClaims();

  return response;
}

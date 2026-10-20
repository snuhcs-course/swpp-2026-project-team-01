import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { handleProblem, normalizeHandle } from "../contracts/handles";
import { prefersMarkdown } from "./entry-documents";
import { authCookieOptions, type SupabaseAuthConfig, supabaseAuthConfigFromEnvironment } from "./supabase-auth";

// The one place a Supabase session is refreshed (the standard @supabase/ssr
// Next.js proxy). It runs before every page and route, writes refreshed cookies
// onto both the forwarded request and the browser's response, and never decides
// access: routes and the agent verify the access token they receive and never
// refresh, so a refresh token is spent exactly once.
export async function updateSession(request: NextRequest, config: SupabaseAuthConfig = supabaseAuthConfigFromEnvironment()) {
  let response = NextResponse.next({ request });

  const client = createServerClient(config.url, config.publishableKey, {
    cookieOptions: authCookieOptions(config, request),
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

// Markdown negotiation for the public pages (public-agent-entry: discoverable from
// plain URLs). A GET of `/` or of a single segment that could be a handle, whose
// Accept header prefers text/markdown, is rewritten to the matching SKILL.md
// document. The proxy returns this before updateSession, so the Markdown response
// never refreshes or sets a cookie. Null leaves the request to the HTML page.
export function markdownRewrite(request: NextRequest) {
  if ((request.method !== "GET" && request.method !== "HEAD") || !prefersMarkdown(request.headers.get("accept"))) {
    return null;
  }

  const { pathname } = request.nextUrl;

  if (pathname === "/") return NextResponse.rewrite(new URL("/SKILL.md", request.url));

  const segment = /^\/([^/]+)\/?$/.exec(pathname)?.[1];
  const handle = segment ? normalizeHandle(segment) : null;

  return handle && !handleProblem(handle) ? NextResponse.rewrite(new URL(`/${handle}/SKILL.md`, request.url)) : null;
}

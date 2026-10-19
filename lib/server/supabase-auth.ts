import {
  combineChunks,
  type CookieOptions,
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
  stringFromBase64URL,
} from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { addressedOrigin } from "./same-origin";

// Supabase JS is used only for the Auth session. The client reads cookies from the
// request and collects the cookies it writes, so a route returns them on its own
// response without depending on the Next.js request scope.

export type SupabaseAuthConfig = {
  readonly publishableKey: string;
  readonly url: string;
  // Marks the session cookies Secure. Unset, each request decides by the
  // origin it was addressed to: Secure on https.
  readonly secureCookies?: boolean;
};

type PendingCookie = { name: string; options: CookieOptions; value: string };

export function supabaseAuthConfigFromEnvironment(): SupabaseAuthConfig {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set.");
  }

  return { publishableKey, url };
}

// The session cookies are never readable by page scripts and are sent only
// same-site (and top-level navigations), over HTTPS when the app is.
export function authCookieOptions(config: SupabaseAuthConfig, request: Request): CookieOptions {
  const secure = config.secureCookies ?? addressedOrigin(request)?.startsWith("https:") ?? false;
  return { httpOnly: true, path: "/", sameSite: "lax", secure };
}

export function createRequestAuthClient(request: Request, config: SupabaseAuthConfig) {
  const pending: PendingCookie[] = [];
  const client = createServerClient(config.url, config.publishableKey, {
    cookieOptions: authCookieOptions(config, request),
    cookies: {
      // The request's cookies overlaid with the ones this client already wrote,
      // so a later call (signOut after exchangeCodeForSession) sees the session
      // it created and removes it.
      getAll: () => {
        const jar = new Map(
          parseCookieHeader(request.headers.get("cookie") ?? "").map(({ name, value }) => [name, value ?? ""]),
        );

        for (const cookie of pending) {
          if (cookie.value) jar.set(cookie.name, cookie.value);
          else jar.delete(cookie.name);
        }

        return [...jar].map(([name, value]) => ({ name, value }));
      },
      setAll: (cookies) => {
        pending.push(...cookies);
      },
    },
  });

  return {
    client,
    redirect(location: string) {
      const headers = new Headers({ "cache-control": "private, no-store", location });

      // Only the last write of each cookie, so a session created and then
      // signed out never reaches the browser.
      const latest = new Map(pending.map((cookie) => [cookie.name, cookie]));

      for (const cookie of latest.values()) {
        headers.append("set-cookie", serializeCookieHeader(cookie.name, cookie.value, cookie.options));
      }

      return new Response(null, { headers, status: 303 });
    },
  };
}

// The access token in the request's Supabase session cookie, read without
// refreshing it. Only the session proxy refreshes (see session-proxy.ts).
export async function sessionAccessToken(request: Request, config: SupabaseAuthConfig) {
  const cookies = parseCookieHeader(request.headers.get("cookie") ?? "");
  const key = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
  const raw = await combineChunks(key, (name) => cookies.find((cookie) => cookie.name === name)?.value);

  if (!raw) return null;

  try {
    const session = JSON.parse(raw.startsWith("base64-") ? stringFromBase64URL(raw.slice("base64-".length)) : raw) as {
      access_token?: unknown;
    };
    return typeof session.access_token === "string" ? session.access_token : null;
  } catch {
    return null;
  }
}

// The user whose access token the request carries, verified by Supabase Auth;
// null when there is none or it is expired or revoked. It never refreshes and
// never sends the refresh token anywhere.
export async function verifiedUserId(request: Request, config: SupabaseAuthConfig) {
  const accessToken = await sessionAccessToken(request, config);

  if (!accessToken) return null;

  const client = createClient(config.url, config.publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const { data, error } = await client.auth.getUser(accessToken);
  return error || !data.user ? null : data.user.id;
}

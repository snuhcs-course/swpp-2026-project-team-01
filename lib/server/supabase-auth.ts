import {
  combineChunks,
  type CookieOptions,
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
  stringFromBase64URL,
} from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// Supabase JS is used only for the Auth session. The client reads cookies from the
// request and collects the cookies it writes, so a route returns them on its own
// response without depending on the Next.js request scope.

export type SupabaseAuthConfig = {
  readonly publishableKey: string;
  readonly url: string;
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

export function createRequestAuthClient(request: Request, config: SupabaseAuthConfig) {
  const pending: PendingCookie[] = [];
  const client = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () =>
        parseCookieHeader(request.headers.get("cookie") ?? "").map(({ name, value }) => ({
          name,
          value: value ?? "",
        })),
      setAll: (cookies) => {
        pending.push(...cookies);
      },
    },
  });

  return {
    client,
    redirect(location: string) {
      const headers = new Headers({ "cache-control": "private, no-store", location });

      for (const cookie of pending) {
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

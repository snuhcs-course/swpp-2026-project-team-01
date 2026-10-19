import {
  type CookieOptions,
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";

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

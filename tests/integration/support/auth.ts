import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Database } from "../../../lib/server/database";
import type { SupabaseAuthConfig } from "../../../lib/server/supabase-auth";

// Helpers for driving the real local Supabase Auth without Google. Only the
// Google leg is simulated: the test writes what Google's callback would have left
// in Auth's PKCE flow state, and everything else runs unchanged.

type LocalStatus = { API_URL: string; MAILPIT_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string };

let status: LocalStatus | undefined;

export function localStack() {
  status ??= JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" })) as LocalStatus;
  return status;
}

export function localAuthConfig(): SupabaseAuthConfig {
  const { API_URL, PUBLISHABLE_KEY } = localStack();
  return { publishableKey: PUBLISHABLE_KEY, url: API_URL };
}

export async function createGoogleUser(db: Database, email = `host-${randomUUID()}@example.test`) {
  const { API_URL, SECRET_KEY } = localStack();
  const response = await fetch(`${API_URL}/auth/v1/admin/users`, {
    body: JSON.stringify({ email, email_confirm: true }),
    headers: { apikey: SECRET_KEY, authorization: `Bearer ${SECRET_KEY}`, "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Creating a test user failed with ${response.status}: ${await response.text()}`);
  }

  const user = (await response.json()) as { id: string };
  const googleSubject = `${Date.now()}${Math.floor(Math.random() * 1e9)}`;

  await db`
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
    values (
      ${googleSubject}, ${user.id},
      ${db.json({ email, email_verified: true, sub: googleSubject })},
      'google', now(), now(), now()
    )
  `;

  return { email, googleSubject, userId: user.id };
}

export function cookieHeader(...responses: Response[]) {
  const jar = new Map<string, string>();

  for (const response of responses) {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair!.indexOf("=");
      const name = pair!.slice(0, index);
      const value = pair!.slice(index + 1);

      if (value) jar.set(name, value);
      else jar.delete(name);
    }
  }

  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function sessionCookies(response: Response) {
  return response.headers
    .getSetCookie()
    .filter((cookie) => /^sb-[^=]+-auth-token(\.\d+)?=[^;]+/.test(cookie));
}

// Follows /auth/sign-in to Auth's authorize endpoint, which records the PKCE
// flow state and redirects to Google.
export async function startGoogleSignIn(signIn: (request: Request) => Promise<Response>, origin: string) {
  const response = await signIn(new Request(`${origin}/auth/sign-in`));
  const authorize = await fetch(response.headers.get("location")!, { redirect: "manual" });
  const google = new URL(authorize.headers.get("location")!);
  const authorizeUrl = new URL(response.headers.get("location")!);

  return {
    codeChallenge: authorizeUrl.searchParams.get("code_challenge")!,
    cookie: cookieHeader(response),
    google,
    response,
  };
}

// Writes what Auth records when Google returns to it for this flow. Auth stores an
// empty string, not NULL, when Google returns no refresh token.
export async function completeGoogleLeg(
  db: Database,
  codeChallenge: string,
  userId: string,
  tokens: { accessToken: string; refreshToken: string | null },
) {
  const code = randomUUID();
  const updated = await db`
    update auth.flow_state
    set user_id = ${userId}, auth_code = ${code}, auth_code_issued_at = now(),
        provider_access_token = ${tokens.accessToken}, provider_refresh_token = ${tokens.refreshToken ?? ""},
        updated_at = now()
    where code_challenge = ${codeChallenge}
  `;

  if (updated.count !== 1) {
    throw new Error("No PKCE flow state matched the sign-in.");
  }

  return code;
}

// A stand-in for Google's token information endpoint.
export async function startFakeTokenInfo(scopesByToken: Record<string, string | number>) {
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const token = new URLSearchParams(body).get("access_token") ?? "";
    requests.push(token);
    const scopes = scopesByToken[token];

    if (typeof scopes === "string") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ expires_in: 3599, scope: scopes }));
    } else {
      response.writeHead(typeof scopes === "number" ? scopes : 400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_token" }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    requests,
    url: `http://127.0.0.1:${port}/tokeninfo`,
  };
}

// Signs a new Google user in through the real callback against the local stack
// and returns the browser's Supabase session cookies and its host account.
export async function signInHost(db: Database) {
  const { createGoogleCallbackHandler, createGoogleSignInHandler } = await import("../../../lib/server/google-sign-in");
  const { createGrantedScopesFetcher } = await import("../../../lib/server/google-token-info");
  const { parseTokenKey } = await import("../../../lib/server/token-encryption");
  const { randomBytes } = await import("node:crypto");
  const origin = "http://localhost:3000";
  const deps = {
    appOrigin: origin,
    auth: localAuthConfig(),
    db,
    // Nothing listens on the discard port, so no Calendar grant is recorded.
    fetchGrantedScopes: createGrantedScopesFetcher("http://127.0.0.1:9/tokeninfo"),
    tokenKey: parseTokenKey(randomBytes(32).toString("base64")),
  };
  const user = await createGoogleUser(db);
  const flow = await startGoogleSignIn(createGoogleSignInHandler(() => deps), origin);
  const code = await completeGoogleLeg(db, flow.codeChallenge, user.userId, {
    accessToken: `ya29.${randomUUID()}`,
    refreshToken: null,
  });
  const response = await createGoogleCallbackHandler(() => deps)(
    new Request(`${origin}/auth/callback?code=${code}`, { headers: { cookie: flow.cookie } }),
  );

  if (response.headers.get("location") !== `${origin}/app`) {
    throw new Error(`Test sign-in failed: ${response.headers.get("location")}`);
  }

  const [account] = await db<{ host_account_id: string }[]>`
    select host_account_id from app.google_identities where auth_user_id = ${user.userId}
  `;

  return {
    cookie: cookieHeader(flow.response, response),
    hostAccountId: account!.host_account_id,
    userId: user.userId,
  };
}

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Connection } from "./store.js";

// Login and refresh as the first-party client fmat-cli (agent-access D14,
// design 9): authorization code with S256 PKCE and the exact resource, either
// through a loopback callback the browser returns to, or headlessly through
// /connect/code, whose `state.code` value the person pastes back. The issuer
// in the response must be the origin the CLI asked.

export const CLIENT_ID = "fmat-cli";
const LOGIN_TIMEOUT_MS = 5 * 60_000;

export class AuthError extends Error {
  readonly category: "access_denied" | "reauthorization_required" | "login_failed" | "service_unavailable";

  constructor(category: AuthError["category"], message: string) {
    super(message);
    this.name = "AuthError";
    this.category = category;
  }
}

export type Endpoints = { readonly authorize: string; readonly token: string; readonly revoke: string };

export async function discover(origin: string, fetchImpl: typeof fetch = fetch): Promise<Endpoints> {
  const response = await fetchImpl(`${origin}/.well-known/oauth-authorization-server`).catch(() => null);
  const metadata = response?.ok ? ((await response.json()) as Record<string, unknown>) : null;

  if (
    !metadata ||
    metadata.issuer !== origin ||
    !Array.isArray(metadata.code_challenge_methods_supported) ||
    !metadata.code_challenge_methods_supported.includes("S256") ||
    typeof metadata.authorization_endpoint !== "string" ||
    typeof metadata.token_endpoint !== "string"
  ) {
    throw new AuthError("service_unavailable", `${origin} does not publish usable authorization server metadata.`);
  }

  return {
    authorize: metadata.authorization_endpoint,
    revoke: typeof metadata.revocation_endpoint === "string" ? metadata.revocation_endpoint : `${origin}/oauth/revoke`,
    token: metadata.token_endpoint,
  };
}

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  return { challenge: createHash("sha256").update(verifier).digest("base64url"), verifier };
}

export function authorizationUrl(endpoints: Endpoints, params: { redirectUri: string; resource: string; scope: string; state: string; challenge: string }) {
  const url = new URL(endpoints.authorize);
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    code_challenge: params.challenge,
    code_challenge_method: "S256",
    redirect_uri: params.redirectUri,
    resource: params.resource,
    response_type: "code",
    scope: params.scope,
    state: params.state,
  }).toString();
  return url.toString();
}

function openBrowser(url: string) {
  const [command, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(command as string, args as string[], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // The URL is printed too; the person can open it by hand.
  }
}

type CodeResult = { readonly code: string; readonly redirectUri: string };

// The loopback flow: a one-shot server on 127.0.0.1 receives the redirect.
async function loopbackCode(origin: string, buildUrl: (redirectUri: string) => string, state: string, notify: (line: string) => void): Promise<CodeResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        response.writeHead(404).end();
        return;
      }
      const done = (status: number, text: string) => {
        response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><meta charset="utf-8"><title>Find Me a Time CLI</title><p style="font-family:system-ui">${text}</p>`);
        clearTimeout(timer);
        server.close();
      };

      if (url.searchParams.get("state") !== state || url.searchParams.get("iss") !== origin) {
        done(400, "This response does not belong to the waiting login. Nothing was saved.");
        reject(new AuthError("login_failed", "The authorization response did not match this login."));
        return;
      }
      if (url.searchParams.get("error")) {
        done(200, "The connection was denied. You can close this tab.");
        reject(new AuthError("access_denied", "The connection was denied in the browser."));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        done(400, "No code arrived. Nothing was saved.");
        reject(new AuthError("login_failed", "The authorization response carried no code."));
        return;
      }
      done(200, "Signed in. You can close this tab and return to the terminal.");
      resolve({ code, redirectUri });
    });
    let redirectUri = "";
    const timer = setTimeout(() => {
      server.close();
      reject(new AuthError("login_failed", "No browser response arrived within five minutes."));
    }, LOGIN_TIMEOUT_MS);

    server.listen(0, "127.0.0.1", () => {
      redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
      const url = buildUrl(redirectUri);
      notify(`Opening the browser to allow the connection. If it does not open, visit:\n${url}`);
      openBrowser(url);
    });
  });
}

// The headless flow: print the URL, read `state.code` from the input.
async function pastedCode(origin: string, buildUrl: (redirectUri: string) => string, state: string, notify: (line: string) => void, readLine: () => Promise<string>): Promise<CodeResult> {
  const redirectUri = `${origin}/connect/code`;
  notify(`Open this URL in any browser, allow the connection, then paste the value it shows:\n${buildUrl(redirectUri)}`);
  const value = (await readLine()).trim();
  const dot = value.indexOf(".");
  if (dot < 1 || value.slice(0, dot) !== state) throw new AuthError("login_failed", "The pasted value does not belong to this login.");
  return { code: value.slice(dot + 1), redirectUri };
}

type TokenBody = { access_token: string; refresh_token: string; expires_in: number; scope: string };

async function tokenRequest(endpoint: string, form: Record<string, string>, fetchImpl: typeof fetch) {
  const response = await fetchImpl(endpoint, {
    body: new URLSearchParams(form).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const body = (await response.json().catch(() => ({}))) as Partial<TokenBody> & { error?: string };
  return { body, status: response.status };
}

export async function login(options: {
  readonly origin: string;
  readonly resource: string;
  readonly role: "host" | "requester";
  readonly handle: string | null;
  readonly scope: string;
  readonly headless: boolean;
  readonly notify: (line: string) => void;
  readonly readLine: () => Promise<string>;
  readonly fetchImpl?: typeof fetch;
}): Promise<Connection> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoints = await discover(options.origin, fetchImpl);
  const { challenge, verifier } = pkcePair();
  const state = randomBytes(16).toString("base64url");
  const buildUrl = (redirectUri: string) => authorizationUrl(endpoints, { challenge, redirectUri, resource: options.resource, scope: options.scope, state });
  const { code, redirectUri } = options.headless
    ? await pastedCode(options.origin, buildUrl, state, options.notify, options.readLine)
    : await loopbackCode(options.origin, buildUrl, state, options.notify);

  const { body, status } = await tokenRequest(
    endpoints.token,
    { client_id: CLIENT_ID, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri, resource: options.resource },
    fetchImpl,
  );
  if (status !== 200 || !body.access_token || !body.refresh_token) {
    throw new AuthError(status === 503 ? "service_unavailable" : "login_failed", `The code exchange failed (${body.error ?? status}). Run fmat login again.`);
  }

  return {
    accessExpiresAt: Date.now() + (body.expires_in ?? 600) * 1000,
    accessToken: body.access_token,
    clientId: CLIENT_ID,
    handle: options.handle,
    origin: options.origin,
    refreshToken: body.refresh_token,
    resource: options.resource,
    role: options.role,
    scope: body.scope ?? options.scope,
  };
}

// A fresh access token. A refused refresh, or one whose response was lost
// (the old refresh token may already be spent), needs a new login.
export async function refresh(connection: Connection, fetchImpl: typeof fetch = fetch): Promise<Connection> {
  const endpoints = await discover(connection.origin, fetchImpl);
  let result: Awaited<ReturnType<typeof tokenRequest>>;
  try {
    result = await tokenRequest(
      endpoints.token,
      { client_id: connection.clientId, grant_type: "refresh_token", refresh_token: connection.refreshToken, resource: connection.resource },
      fetchImpl,
    );
  } catch {
    throw new AuthError("reauthorization_required", "The token refresh got no answer, so the stored credential may be spent.");
  }

  const { body, status } = result;
  if (status === 503) throw new AuthError("service_unavailable", "The service cannot issue tokens right now.");
  if (status !== 200 || !body.access_token || !body.refresh_token) {
    throw new AuthError("reauthorization_required", "The connection is no longer authorized.");
  }

  return { ...connection, accessExpiresAt: Date.now() + (body.expires_in ?? 600) * 1000, accessToken: body.access_token, refreshToken: body.refresh_token, scope: body.scope ?? connection.scope };
}

export async function revoke(connection: Connection, fetchImpl: typeof fetch = fetch) {
  const endpoints = await discover(connection.origin, fetchImpl).catch(() => null);
  if (!endpoints) return false;
  const response = await fetchImpl(endpoints.revoke, {
    body: new URLSearchParams({ client_id: connection.clientId, token: connection.refreshToken, token_type_hint: "refresh_token" }).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  }).catch(() => null);
  return response?.ok ?? false;
}

import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import type { AgentAuthorizeDependencies } from "../../../lib/server/agent-authorize";
import { createAuthorizeHandler, createDecisionHandler } from "../../../lib/server/agent-authorize";
import type { MetadataFetch } from "../../../lib/server/agent-clients";
import { type AgentOAuthDependencies, createRegistrationHandler, createTokenHandler } from "../../../lib/server/agent-oauth-routes";
import { parseSigningKey } from "../../../lib/server/agent-tokens";
import type { Database } from "../../../lib/server/database";
import { parseTokenKey } from "../../../lib/server/token-encryption";
import { cookieHeader, localAuthConfig } from "./auth";

// Helpers for driving the agent authorization server the way a client and a
// person's browser would: register, send the browser to /connect/authorize,
// decide on the consent page, and exchange the code.

export const ORIGIN = "http://localhost:3000";
export const HOST_RESOURCE = `${ORIGIN}/mcp`;
export const CLIENT_REDIRECT = "https://agent.example.test/callback";

export function testSigningKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return parseSigningKey(privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"))!;
}

export type AgentTestDependencies = AgentOAuthDependencies & AgentAuthorizeDependencies;

export function agentDependencies(
  db: Database,
  overrides: { signingKey?: ReturnType<typeof testSigningKey> | null; fetchMetadata?: MetadataFetch } = {},
): AgentTestDependencies {
  const signingKey = overrides.signingKey === undefined ? testSigningKey() : overrides.signingKey;
  const tokenKey = parseTokenKey(randomBytes(32).toString("base64"));
  return {
    appOrigin: ORIGIN,
    auth: localAuthConfig(),
    db,
    fetchMetadata: overrides.fetchMetadata,
    signingKey: () => signingKey,
    tokenKey: () => tokenKey,
  };
}

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { challenge: createHash("sha256").update(verifier).digest("base64url"), verifier };
}

export async function registerTestClient(deps: AgentTestDependencies, redirectUris: readonly string[] = [CLIENT_REDIRECT]) {
  const response = await createRegistrationHandler(() => deps)(
    new Request(`${ORIGIN}/oauth/register`, {
      body: JSON.stringify({ client_name: "Test Agent", redirect_uris: redirectUris, token_endpoint_auth_method: "none" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  if (response.status !== 201) throw new Error(`Registration failed: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { client_id: string }).client_id;
}

export function authorizeRequest(params: Record<string, string>, cookie = "") {
  const url = new URL(`${ORIGIN}/connect/authorize`);
  for (const [name, value] of Object.entries(params)) url.searchParams.append(name, value);
  return new Request(url, { headers: cookie ? { cookie } : {} });
}

export type Authorization = {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly scope: string;
  readonly verifier: string;
  readonly state: string;
};

// Sends the browser to /connect/authorize and returns the transaction and the
// browser's binding cookie.
export async function beginAuthorization(deps: AgentTestDependencies, authorization: Omit<Authorization, "verifier" | "state">, browserCookie = "") {
  const { challenge, verifier } = pkce();
  const state = randomBytes(8).toString("hex");
  const response = await createAuthorizeHandler(() => deps)(
    authorizeRequest(
      {
        client_id: authorization.clientId,
        code_challenge: challenge,
        code_challenge_method: "S256",
        redirect_uri: authorization.redirectUri,
        resource: authorization.resource,
        response_type: "code",
        scope: authorization.scope,
        state,
      },
      browserCookie,
    ),
  );
  const location = response.headers.get("location") ?? "";
  const transactionId = new URL(location, ORIGIN).searchParams.get("transaction");
  if (response.status !== 303 || !transactionId) throw new Error(`Authorization did not open consent: ${response.status} ${location}`);
  return {
    authorization: { ...authorization, state, verifier },
    cookie: [browserCookie, cookieHeader(response)].filter(Boolean).join("; "),
    transactionId,
  };
}

export async function decide(
  deps: AgentTestDependencies,
  transactionId: string,
  cookie: string,
  fields: Record<string, string | readonly string[]>,
) {
  const form = new URLSearchParams({ transaction: transactionId });
  for (const [name, value] of Object.entries(fields)) {
    for (const item of typeof value === "string" ? [value] : value) form.append(name, item);
  }
  return createDecisionHandler(() => deps)(
    new Request(`${ORIGIN}/connect/decision`, {
      body: form.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: ORIGIN },
      method: "POST",
    }),
  );
}

export function tokenRequest(deps: AgentTestDependencies, form: Record<string, string>) {
  return createTokenHandler(() => deps)(
    new Request(`${ORIGIN}/oauth/token`, {
      body: new URLSearchParams(form).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    }),
  );
}

export function exchange(deps: AgentTestDependencies, authorization: Authorization, code: string) {
  return tokenRequest(deps, {
    client_id: authorization.clientId,
    code,
    code_verifier: authorization.verifier,
    grant_type: "authorization_code",
    redirect_uri: authorization.redirectUri,
    resource: authorization.resource,
  });
}

export type Tokens = { access_token: string; refresh_token: string; scope: string; expires_in: number };

// The whole flow for a host: register, authorize, allow the checked scopes
// with the host's session cookie, exchange the code.
export async function connectHost(
  deps: AgentTestDependencies,
  hostCookie: string,
  { scope = "host:read host:write host:decide", allow = scope.split(" ") }: { scope?: string; allow?: readonly string[] } = {},
) {
  const clientId = await registerTestClient(deps);
  const begun = await beginAuthorization(deps, { clientId, redirectUri: CLIENT_REDIRECT, resource: HOST_RESOURCE, scope }, hostCookie);
  const decided = await decide(deps, begun.transactionId, begun.cookie, { decision: "allow", scope: allow });
  const code = new URL(decided.headers.get("location")!).searchParams.get("code");
  if (!code) throw new Error(`Consent did not return a code: ${decided.headers.get("location")}`);
  const response = await exchange(deps, begun.authorization, code);
  if (response.status !== 200) throw new Error(`Exchange failed: ${response.status} ${await response.text()}`);
  return { authorization: begun.authorization, tokens: (await response.json()) as Tokens };
}

export function grantIdOf(accessToken: string) {
  return (JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString()) as { grant_id: string }).grant_id;
}

import { normalizeHandle } from "../contracts/handles";
import { type ClientDependencies, ClientResolutionError, type MetadataFetch, resolveClient, registerClient } from "./agent-clients";
import {
  exchangeCode,
  refreshTokens,
  revokeByAccessToken,
  revokeByRefreshToken,
  type TokenError,
  type TokenSuccess,
} from "./agent-grants";
import { AGENT_LIMITS, admitAttempt, AttemptLimitError } from "./agent-limits";
import {
  authorizationServerMetadata,
  hostResource,
  protectedResourceMetadata,
  PUBLIC_METADATA_HEADERS,
  requesterResource,
} from "./agent-resources";
import { type AgentSigningKey, jwks, signingKeyFromEnvironment, verifyAccessToken } from "./agent-tokens";
import { type Database, database } from "./database";
import { findReadyHostByHandle } from "./readiness";
import { type AppOrigins, appOriginsFromEnvironment, listedOrigins, requestAppOrigin, unknownHost } from "./same-origin";
import { sourceHash } from "./signup-limits";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// The authorization server's protocol routes (agent-access design 2, 3, 5 and
// 12): the discovery documents and key set, dynamic registration, the token
// endpoint and revocation. Each answers for the listed origin the request was
// addressed to, which is also the issuer. Errors use the OAuth error codes with
// a fixed description, are never cached and never echo a credential.

export type AgentOAuthDependencies = AppOrigins & {
  readonly db: Database;
  readonly signingKey: () => AgentSigningKey | null;
  readonly tokenKey: () => TokenKey;
  readonly fetchMetadata?: MetadataFetch;
};

export function agentOAuthDependenciesFromEnvironment(): AgentOAuthDependencies {
  return {
    ...appOriginsFromEnvironment(),
    db: database(),
    signingKey: () => signingKeyFromEnvironment(),
    tokenKey: tokenKeyFromEnvironment,
  };
}

const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" } as const;
// Public clients call these from anywhere; no cookie is read, so any origin may.
const CORS = {
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-origin": "*",
} as const;

export function oauthError(error: TokenError["error"] | "invalid_client_metadata" | "invalid_redirect_uri", description: string, status = 400, extra: Record<string, string> = {}) {
  return Response.json({ error, error_description: description }, { headers: { ...NO_STORE, ...CORS, ...extra }, status });
}

export function preflight() {
  return new Response(null, { headers: { ...CORS, "access-control-max-age": "600" }, status: 204 });
}

function metadata(body: unknown) {
  return new Response(JSON.stringify(body), { headers: PUBLIC_METADATA_HEADERS });
}

function notFound() {
  return Response.json({ error: "not_found" }, { headers: { ...NO_STORE, "access-control-allow-origin": "*" }, status: 404 });
}

// GET /.well-known/oauth-authorization-server
export function createAuthorizationServerMetadataHandler(load: () => Pick<AgentOAuthDependencies, "appOrigin" | "allowedOrigins"> = appOriginsFromEnvironment) {
  return (request: Request) => {
    const origin = requestAppOrigin(request, load());
    return origin ? metadata(authorizationServerMetadata(origin)) : unknownHost();
  };
}

// GET /.well-known/oauth-protected-resource[/mcp]: the host resource.
export function createHostResourceMetadataHandler(load: () => Pick<AgentOAuthDependencies, "appOrigin" | "allowedOrigins"> = appOriginsFromEnvironment) {
  return (request: Request) => {
    const origin = requestAppOrigin(request, load());
    return origin ? metadata(protectedResourceMetadata(origin, hostResource(origin), "host")) : unknownHost();
  };
}

// GET /.well-known/oauth-protected-resource/{handle}/mcp: a ready host's
// requester resource; any other handle gets the same neutral not-found.
export function createRequesterResourceMetadataHandler(load: () => Pick<AgentOAuthDependencies, "appOrigin" | "allowedOrigins" | "db"> = () => ({ ...appOriginsFromEnvironment(), db: database() })) {
  return async (request: Request, context: { readonly params: Promise<{ readonly handle: string }> }) => {
    const deps = load();
    const origin = requestAppOrigin(request, deps);
    if (!origin) return unknownHost();

    const host = await findReadyHostByHandle(deps.db, normalizeHandle((await context.params).handle));
    return host ? metadata(protectedResourceMetadata(origin, requesterResource(origin, host.handle), "requester")) : notFound();
  };
}

// GET /.well-known/jwks.json: the public verification key only, or none.
export function createJwksHandler(load: () => Pick<AgentOAuthDependencies, "signingKey"> = agentOAuthDependenciesFromEnvironment) {
  return () => metadata(jwks(load().signingKey()));
}

const MAX_BODY = 16 * 1024;

async function readText(request: Request) {
  const text = await request.text().catch(() => null);
  return text !== null && text.length <= MAX_BODY ? text : null;
}

// Form parameters, or null when the body is too large, not a form, or names a
// parameter twice.
async function formParameters(request: Request) {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") return null;

  const text = await readText(request);
  if (text === null) return null;

  const params = new URLSearchParams(text);
  const names = [...params.keys()];
  if (new Set(names).size !== names.length) return null;
  return params;
}

// POST /oauth/register (RFC 7591).
export function createRegistrationHandler(load: () => AgentOAuthDependencies = agentOAuthDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    if (!requestAppOrigin(request, deps)) return unknownHost();

    const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const text = type === "application/json" ? await readText(request) : null;
    let body: unknown = null;

    try {
      body = text === null ? null : JSON.parse(text);
    } catch {
      body = null;
    }

    const result = await registerClient(deps.db, body, sourceHash(deps.tokenKey(), request));
    return Response.json(result.body, {
      headers: { ...NO_STORE, ...CORS, ...(result.ok || !result.retryAfterSeconds ? {} : { "retry-after": String(result.retryAfterSeconds) }) },
      status: result.status,
    });
  };
}

function tokenResponse(result: TokenSuccess | TokenError) {
  if ("access_token" in result) return Response.json(result, { headers: { ...NO_STORE, ...CORS } });
  return oauthError(result.error, result.description, result.error === "temporarily_unavailable" ? 503 : 400);
}

// POST /oauth/token: authorization_code and refresh_token for public clients.
export function createTokenHandler(load: () => AgentOAuthDependencies = agentOAuthDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const origin = requestAppOrigin(request, deps);
    if (!origin) return unknownHost();

    const params = await formParameters(request);
    if (!params) return oauthError("invalid_request", "Send one form-encoded value for each parameter.");

    const grantType = params.get("grant_type");
    const clientId = params.get("client_id");
    const resource = params.get("resource");

    if (grantType !== "authorization_code" && grantType !== "refresh_token") {
      return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
    }
    if (!clientId) return oauthError("invalid_client", "Name the client.", 401);
    if (!resource) return oauthError("invalid_target", "Name the resource.");

    try {
      await admitAttempt(deps.db, "token", [{ bound: AGENT_LIMITS.tokenPerClient, key: clientId }]);
    } catch (error) {
      if (error instanceof AttemptLimitError) {
        return oauthError("temporarily_unavailable", "Too many token requests. Try again later.", 429, { "retry-after": String(error.retryAfterSeconds) });
      }
      throw error;
    }

    try {
      await resolveClient(deps as ClientDependencies, clientId, listedOrigins(deps));
    } catch (error) {
      if (error instanceof ClientResolutionError) return oauthError("invalid_client", "The client is not known.", 401);
      throw error;
    }

    // Without a signing key nothing is issued, and the code or refresh token
    // is left unspent for when the key is configured.
    const key = deps.signingKey();
    if (!key) return oauthError("temporarily_unavailable", "Token issuance is not configured.", 503);

    if (grantType === "authorization_code") {
      const code = params.get("code");
      const redirectUri = params.get("redirect_uri");
      const codeVerifier = params.get("code_verifier");
      if (!code || !redirectUri || !codeVerifier) return oauthError("invalid_request", "Send the code, redirect URI and code verifier.");
      return tokenResponse(await exchangeCode(deps.db, key, origin, { clientId, code, codeVerifier, redirectUri, resource }));
    }

    const refreshToken = params.get("refresh_token");
    if (!refreshToken) return oauthError("invalid_request", "Send the refresh token.");
    const scope = params.get("scope");
    return tokenResponse(
      await refreshTokens(deps.db, key, origin, {
        clientId,
        refreshToken,
        resource,
        scope: scope === null ? null : scope.trim().split(/ +/).filter(Boolean),
      }),
    );
  };
}

// POST /oauth/revoke (RFC 7009): always 200 for a well-formed request, so the
// answer reveals nothing about the token.
export function createRevocationHandler(load: () => AgentOAuthDependencies = agentOAuthDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const origin = requestAppOrigin(request, deps);
    if (!origin) return unknownHost();

    const params = await formParameters(request);
    const token = params?.get("token");
    const clientId = params?.get("client_id");
    if (!params || !token || !clientId) return oauthError("invalid_request", "Send the token and the client.");

    if (token.split(".").length === 3) {
      // An access token: verify the signature and issuer; its audience and
      // expiry do not matter for revocation.
      const claims = verifyAccessToken(deps.signingKey(), token, { audience: tokenAudience(token), issuer: origin }, tokenTime(token));
      if (claims) await revokeByAccessToken(deps.db, claims, clientId);
    } else {
      await revokeByRefreshToken(deps.db, token, clientId);
    }

    return new Response(null, { headers: { ...NO_STORE, ...CORS }, status: 200 });
  };
}

function payloadOf(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// The unverified audience, only so the signature check can run; the claims it
// returns are verified.
function tokenAudience(token: string) {
  const aud = payloadOf(token).aud;
  return typeof aud === "string" ? aud : "";
}

// A time inside the token's validity, so an expired access token can still be
// revoked by its owner.
function tokenTime(token: string) {
  const iat = payloadOf(token).iat;
  return new Date((typeof iat === "number" ? iat + 1 : 0) * 1000);
}

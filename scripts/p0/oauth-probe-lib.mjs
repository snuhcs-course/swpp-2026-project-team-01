import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
} from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const root = path.resolve(import.meta.dirname, "../..");
export const scratch = path.join(root, ".local/p0-oauth");

export function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

export function decodeJwt(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) throw new Error("TOKEN_NOT_JWT");
  return {
    header: JSON.parse(Buffer.from(parts[0], "base64url")),
    payload: JSON.parse(Buffer.from(parts[1], "base64url")),
    signingInput: Buffer.from(`${parts[0]}.${parts[1]}`),
    signature: Buffer.from(parts[2], "base64url"),
  };
}

export function safeTokenClaims(token) {
  const { payload } = decodeJwt(token);
  return {
    iss: payload.iss ?? null,
    aud: payload.aud ?? null,
    sub: payload.sub ?? null,
    client_id: payload.client_id ?? null,
    role: payload.role ?? null,
    exp: payload.exp ?? null,
  };
}

export async function jsonFetch(url, options = {}) {
  const response = await fetch(url, { redirect: "manual", ...options });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: "NON_JSON_RESPONSE" };
  }
  return { response, body };
}

export async function writePrivateJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export function journeyFile(journey) {
  if (!/^(terminal|browser)$/.test(journey))
    throw new Error("JOURNEY_MUST_BE_TERMINAL_OR_BROWSER");
  return path.join(scratch, `oauth-${journey}.json`);
}

export function discoveryUrl(authBase) {
  const parsed = new URL(authBase);
  const authPath = parsed.pathname.replace(/\/$/, "");
  parsed.pathname = `/.well-known/oauth-authorization-server${authPath}`;
  parsed.search = "";
  return parsed.href;
}

export async function discover(authBase) {
  const standardsUrl = discoveryUrl(authBase);
  let usedUrl = standardsUrl;
  let fallbackUsed = false;
  let result = await jsonFetch(standardsUrl);
  // The local CLI's Kong route does not currently forward the RFC path with
  // the issuer suffix, although GoTrue exposes equivalent issuer-local metadata.
  if (result.response.status === 404) {
    usedUrl = `${authBase}/.well-known/oauth-authorization-server`;
    result = await jsonFetch(usedUrl);
    fallbackUsed = true;
  }
  return {
    httpStatus: result.response.status,
    metadata: result.body,
    standardsUrl,
    usedUrl,
    fallbackUsed,
  };
}

export function generatePkce() {
  const verifier = base64url(randomBytes(48));
  return {
    verifier,
    challenge: base64url(createHash("sha256").update(verifier).digest()),
    state: base64url(randomBytes(32)),
    nonce: base64url(randomBytes(32)),
  };
}

export async function registerClient(metadata, clientName, redirectUri) {
  if (!metadata.registration_endpoint)
    throw new Error("DYNAMIC_REGISTRATION_NOT_ADVERTISED");
  const { response, body } = await jsonFetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!response.ok || !body.client_id) {
    throw new Error(
      `DYNAMIC_REGISTRATION_FAILED_${response.status}_${body.error ?? "unknown"}`,
    );
  }
  return body;
}

export async function beginJourney({
  authBase,
  journey,
  resource,
  callbackBase,
}) {
  if (authBase !== "http://127.0.0.1:55321/auth/v1")
    throw new Error("JOURNEY_REQUIRES_ISOLATED_AUTH_55321");
  if (callbackBase !== "http://127.0.0.1:8788")
    throw new Error("JOURNEY_REQUIRES_LOCAL_CALLBACK_8788");
  if (new URL(resource).origin !== callbackBase)
    throw new Error("JOURNEY_REQUIRES_LOCAL_RESOURCE_8788");
  const { httpStatus, metadata, standardsUrl, usedUrl, fallbackUsed } =
    await discover(authBase);
  if (httpStatus !== 200)
    throw new Error(
      `DISCOVERY_FAILED_${httpStatus}_${metadata.error_code ?? "unknown"}`,
    );
  const redirectUri = new URL(`/callback/${journey}`, callbackBase).href;
  const client = await registerClient(
    metadata,
    `Find Me a Time P0 ${journey} probe`,
    redirectUri,
  );
  const pkce = generatePkce();
  const authorization = new URL(metadata.authorization_endpoint);
  authorization.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    state: pkce.state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    scope: "openid email profile",
    nonce: pkce.nonce,
    resource,
  });
  const state = {
    version: 1,
    journey,
    createdAt: new Date().toISOString(),
    authBase,
    resource,
    redirectUri,
    discovery: {
      standards_url: standardsUrl,
      used_url: usedUrl,
      fallback_used: fallbackUsed,
      issuer: metadata.issuer,
      authorization_endpoint: metadata.authorization_endpoint,
      token_endpoint: metadata.token_endpoint,
      registration_endpoint: metadata.registration_endpoint,
      jwks_uri: metadata.jwks_uri,
      userinfo_endpoint: metadata.userinfo_endpoint,
      code_challenge_methods_supported:
        metadata.code_challenge_methods_supported,
    },
    client: {
      client_id: client.client_id,
      client_name: client.client_name ?? null,
      token_endpoint_auth_method: client.token_endpoint_auth_method ?? "none",
    },
    pkce: { verifier: pkce.verifier, state: pkce.state, nonce: pkce.nonce },
    authorizationUrl: authorization.href,
    callback: null,
    tokens: null,
    verification: null,
  };
  await writePrivateJson(journeyFile(journey), state);
  return {
    journey,
    authorizationUrl: authorization.href,
    clientId: client.client_id,
    redirectUri,
    resource,
  };
}

export async function exchange(state, refreshToken = null) {
  const parameters = refreshToken
    ? {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: state.client.client_id,
        resource: state.resource,
      }
    : {
        grant_type: "authorization_code",
        code: state.callback?.code,
        client_id: state.client.client_id,
        redirect_uri: state.redirectUri,
        code_verifier: state.pkce.verifier,
        resource: state.resource,
      };
  return jsonFetch(state.discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters),
  });
}

function audiences(value) {
  return Array.isArray(value) ? value : [value];
}

export async function verifyJwt(token, state) {
  const decoded = decodeJwt(token);
  const { response, body } = await jsonFetch(state.discovery.jwks_uri);
  if (!response.ok) throw new Error(`JWKS_FAILED_${response.status}`);
  const jwk = body.keys?.find(
    (candidate) => candidate.kid === decoded.header.kid,
  );
  if (!jwk) throw new Error("SIGNING_KEY_NOT_FOUND");
  const algorithm = decoded.header.alg;
  const algorithmAllowed =
    (algorithm === "ES256" &&
      jwk.alg === "ES256" &&
      jwk.kty === "EC" &&
      jwk.crv === "P-256") ||
    (algorithm === "RS256" && jwk.alg === "RS256" && jwk.kty === "RSA");
  let signatureValid = false;
  if (algorithmAllowed) {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    const signatureOptions =
      algorithm === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key;
    signatureValid = verifySignature(
      "sha256",
      decoded.signingInput,
      signatureOptions,
      decoded.signature,
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const checks = {
    algorithm: algorithmAllowed,
    signature: signatureValid,
    issuer: decoded.payload.iss === state.discovery.issuer,
    audience: audiences(decoded.payload.aud).includes(state.resource),
    client: decoded.payload.client_id === state.client.client_id,
    expiry: Number(decoded.payload.exp) > now,
    subject:
      typeof decoded.payload.sub === "string" && decoded.payload.sub.length > 0,
  };
  return {
    claims: safeTokenClaims(token),
    checks,
    valid: Object.values(checks).every(Boolean),
  };
}

export async function userInfo(token, state) {
  const endpoint =
    state.discovery.userinfo_endpoint ?? `${state.authBase}/oauth/userinfo`;
  return jsonFetch(endpoint, { headers: { authorization: `Bearer ${token}` } });
}

export async function updateApplicationGrant({
  state,
  userId,
  active,
  reason,
}) {
  const file = path.join(scratch, "application-grants.json");
  const current = (await readJson(file, { version: 1, grants: [] })) ?? {
    version: 1,
    grants: [],
  };
  const key = `${userId}:${state.client.client_id}:${state.resource}`;
  const next = current.grants.filter((grant) => grant.key !== key);
  next.push({
    key,
    userId,
    clientId: state.client.client_id,
    resource: state.resource,
    allowedTools: ["diagnostic.read"],
    active,
    reason,
    updatedAt: new Date().toISOString(),
  });
  await writePrivateJson(file, { version: 1, grants: next });
}

export async function activeApplicationGrant({
  userId,
  clientId,
  resource,
  tool,
}) {
  const data = await readJson(path.join(scratch, "application-grants.json"), {
    grants: [],
  });
  return data.grants?.find(
    (grant) =>
      grant.userId === userId &&
      grant.clientId === clientId &&
      grant.resource === resource &&
      grant.active === true &&
      grant.allowedTools?.includes(tool),
  );
}

export function sanitizedState(state) {
  return {
    journey: state.journey,
    createdAt: state.createdAt,
    resource: state.resource,
    clientId: state.client?.client_id ?? null,
    callbackReceived: Boolean(state.callback?.code || state.callback?.error),
    callbackError: state.callback?.error ?? null,
    tokenClaims: state.tokens?.access_token
      ? safeTokenClaims(state.tokens.access_token)
      : null,
    refreshClaims: state.tokens?.refreshed_access_token
      ? safeTokenClaims(state.tokens.refreshed_access_token)
      : null,
    verification: state.verification ?? null,
    revoked: state.revoked ?? null,
  };
}

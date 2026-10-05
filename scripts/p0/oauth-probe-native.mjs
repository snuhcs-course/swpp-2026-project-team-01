#!/usr/bin/env node
import path from "node:path";
import {
  decodeJwt,
  discover,
  jsonFetch,
  readJson,
  scratch,
  updateApplicationGrant,
  writePrivateJson,
} from "./oauth-probe-lib.mjs";
import {
  exactStringSet,
  identityScopes,
  isolatedIssuer,
  mcpResource,
  validatePendingAuthorization,
} from "./oauth-probe-native-guards.mjs";

process.umask(0o077);

const authBase = "http://127.0.0.1:55321/auth/v1";
const resource = mcpResource;
const registryFile = path.join(scratch, "oauth-native-clients.json");
const runConfigFile = path.join(scratch, "oauth-native-codex-run.json");
const command = process.argv[2] ?? "help";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requiredOption(name) {
  const value = option(name);
  if (!value)
    throw new Error(
      `MISSING_${name.replace(/^--/, "").toUpperCase().replaceAll("-", "_")}`,
    );
  return value;
}

function nativeState(client) {
  return {
    authBase,
    resource: client.resource,
    discovery: client.discovery,
    client: { client_id: client.clientId },
  };
}

function safeClient(client) {
  return {
    name: client.name,
    clientId: client.clientId,
    resource: client.resource,
    redirectUri: client.redirectUri,
    scopes: client.scopes,
    status: client.status,
    stagedAt: client.stagedAt,
    activatedAt: client.activatedAt ?? null,
    revokedAt: client.revokedAt ?? null,
  };
}

async function saveClient(client) {
  const current = await readJson(registryFile, { version: 1, clients: [] });
  const existing = (current.clients ?? []).find(
    (candidate) => candidate.name === client.name,
  );
  if (
    existing &&
    ["pending", "active"].includes(existing.status) &&
    existing.clientId !== client.clientId
  )
    throw new Error("ACTIVE_OR_PENDING_NATIVE_NAME_CONFLICT");
  const clients = (current.clients ?? []).filter(
    (candidate) => candidate.name !== client.name,
  );
  clients.push(client);
  await writePrivateJson(registryFile, { version: 1, clients });
}

async function getClient(name) {
  const registry = await readJson(registryFile, { clients: [] });
  const client = registry.clients?.find((candidate) => candidate.name === name);
  if (!client) throw new Error("NATIVE_CLIENT_NOT_STAGED");
  return client;
}

async function fixtureContext() {
  const fixture = await readJson(
    path.join(scratch, "fixture-credentials.json"),
  );
  const session = await readJson(path.join(scratch, "fixture-session.json"));
  if (!fixture?.userId || !fixture?.email || !session?.access_token)
    throw new Error("PRIVATE_FIXTURE_SESSION_REQUIRED");
  if (fixture.email !== "p0-oauth-fixture@findmeatime.invalid")
    throw new Error("EXACT_SYNTHETIC_FIXTURE_REQUIRED");
  const claims = decodeJwt(session.access_token).payload;
  if (
    claims.iss !== isolatedIssuer ||
    claims.sub !== fixture.userId ||
    claims.email !== fixture.email ||
    Number(claims.exp) <= Math.floor(Date.now() / 1000)
  )
    throw new Error("SYNTHETIC_FIXTURE_SESSION_REQUIRED");
  const verified = await jsonFetch(`${authBase}/user`, {
    headers: {
      authorization: `Bearer ${session.access_token}`,
      apikey: session.publishable_key,
    },
  });
  if (
    !verified.response.ok ||
    verified.body.id !== fixture.userId ||
    verified.body.email !== fixture.email
  )
    throw new Error("ISOLATED_FIXTURE_SESSION_VERIFICATION_FAILED");
  return { fixture, session };
}

async function listFixtureGrants(session) {
  const result = await jsonFetch(`${authBase}/user/oauth/grants`, {
    headers: {
      authorization: `Bearer ${session.access_token}`,
      apikey: session.publishable_key,
      "x-supabase-api-version": "2024-01-01",
    },
  });
  if (!result.response.ok)
    throw new Error(`OAUTH_GRANT_LIST_FAILED_${result.response.status}`);
  return Array.isArray(result.body) ? result.body : (result.body.grants ?? []);
}

function grantClientId(grant) {
  return (
    grant.client_id ??
    grant.client?.id ??
    grant.client?.client_id ??
    grant.oauth_client?.id ??
    null
  );
}

function grantScopes(grant) {
  const scopes = grant.scopes ?? grant.scope ?? [];
  return Array.isArray(scopes)
    ? scopes
    : String(scopes).split(/\s+/).filter(Boolean);
}

async function stage() {
  const name = requiredOption("--name");
  const run = await readJson(runConfigFile);
  if (run?.name !== name || !/^fmat_p0_native_[0-9a-f]{10}$/.test(name))
    throw new Error("PERSISTED_TASK_UNIQUE_NATIVE_NAME_REQUIRED");
  const loginLog = path.resolve(requiredOption("--login-log"));
  if (!loginLog.startsWith(`${scratch}${path.sep}`))
    throw new Error("LOGIN_LOG_MUST_BE_IN_PRIVATE_SCRATCH");
  const text = await import("node:fs/promises").then(({ readFile }) =>
    readFile(loginLog, "utf8"),
  );
  const matches =
    text.match(/https?:\/\/[^\s]+\/oauth\/authorize\?[^\s]+/g) ?? [];
  const authorizationUrl = matches.at(-1)?.replace(/\x1b\[[0-9;]*m/g, "");
  if (!authorizationUrl) throw new Error("PENDING_AUTHORIZATION_URL_NOT_FOUND");
  const { clientId, redirectUri, scopes } =
    validatePendingAuthorization(authorizationUrl);
  const discovered = await discover(authBase);
  if (discovered.httpStatus !== 200)
    throw new Error(`DISCOVERY_FAILED_${discovered.httpStatus}`);
  const client = {
    name,
    clientId,
    resource,
    redirectUri,
    scopes,
    status: "pending",
    stagedAt: new Date().toISOString(),
    discovery: {
      issuer: discovered.metadata.issuer,
      jwks_uri: discovered.metadata.jwks_uri,
      userinfo_endpoint: discovered.metadata.userinfo_endpoint,
      token_endpoint: discovered.metadata.token_endpoint,
    },
  };
  await saveClient(client);
  await writePrivateJson(runConfigFile, { ...run, clientId });
  const authorizationFile = path.join(
    scratch,
    `oauth-native-authorization-${name}-private.json`,
  );
  await writePrivateJson(authorizationFile, {
    name,
    authorization_url: authorizationUrl,
    savedAt: new Date().toISOString(),
    warning: "Private PKCE authorization request; do not commit or print",
  });
  return {
    ...safeClient(client),
    authorizationFile: path.relative(process.cwd(), authorizationFile),
  };
}

async function activate() {
  const name = requiredOption("--name");
  const client = await getClient(name);
  if (client.status !== "pending") throw new Error("PENDING_CLIENT_REQUIRED");
  const { fixture, session } = await fixtureContext();
  const grants = await listFixtureGrants(session);
  const grant = grants.find(
    (candidate) => grantClientId(candidate) === client.clientId,
  );
  if (!grant) throw new Error("FIXTURE_OAUTH_GRANT_NOT_FOUND");
  const grantedScopes = grantScopes(grant);
  if (
    !exactStringSet(client.scopes, identityScopes) ||
    !exactStringSet(grantedScopes, identityScopes)
  )
    throw new Error("EXACT_GRANTED_IDENTITY_SCOPES_REQUIRED");
  await updateApplicationGrant({
    state: nativeState(client),
    userId: fixture.userId,
    active: true,
    reason: "fixture-native-client-consent-verified",
  });
  client.status = "active";
  client.activatedAt = new Date().toISOString();
  client.grantedScopes = grantedScopes;
  await saveClient(client);
  return safeClient(client);
}

async function revoke() {
  const name = requiredOption("--name");
  const client = await getClient(name);
  if (client.status !== "active") throw new Error("ACTIVE_CLIENT_REQUIRED");
  const { fixture, session } = await fixtureContext();
  const result = await jsonFetch(
    `${authBase}/user/oauth/grants?client_id=${encodeURIComponent(client.clientId)}`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: session.publishable_key,
        "x-supabase-api-version": "2024-01-01",
      },
    },
  );
  if (result.response.status !== 204)
    throw new Error(`OAUTH_GRANT_REVOKE_FAILED_${result.response.status}`);
  const remaining = await listFixtureGrants(session);
  if (remaining.some((grant) => grantClientId(grant) === client.clientId))
    throw new Error("OAUTH_GRANT_STILL_PRESENT");
  await updateApplicationGrant({
    state: nativeState(client),
    userId: fixture.userId,
    active: false,
    reason: "fixture-native-client-grant-revoked",
  });
  client.status = "revoked";
  client.revokedAt = new Date().toISOString();
  await saveClient(client);
  return { ...safeClient(client), revokeHttpStatus: result.response.status };
}

try {
  let result;
  if (command === "stage") result = await stage();
  else if (command === "activate") result = await activate();
  else if (command === "revoke") result = await revoke();
  else if (command === "show")
    result = safeClient(await getClient(requiredOption("--name")));
  else {
    console.log(`Usage:
  node scripts/p0/oauth-probe-native.mjs stage --name NAME --login-log .local/p0-oauth/FILE
  node scripts/p0/oauth-probe-native.mjs activate --name NAME
  node scripts/p0/oauth-probe-native.mjs revoke --name NAME
  node scripts/p0/oauth-probe-native.mjs show --name NAME`);
    process.exit(command === "help" ? 0 : 2);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}

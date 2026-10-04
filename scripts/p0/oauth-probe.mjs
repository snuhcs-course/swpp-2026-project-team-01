#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  beginJourney,
  discover,
  exchange,
  journeyFile,
  jsonFetch,
  readJson,
  sanitizedState,
  scratch,
  updateApplicationGrant,
  userInfo,
  verifyJwt,
  writePrivateJson,
} from "./oauth-probe-lib.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requireOption(name, fallback = null) {
  const value = option(name, fallback);
  if (!value)
    throw new Error(
      `MISSING_${name.replace(/^--/, "").toUpperCase().replaceAll("-", "_")}`,
    );
  return value;
}

const command = process.argv[2] ?? "help";
const authBase = option(
  "--auth-base",
  process.env.P0_AUTH_BASE ?? "http://127.0.0.1:55321/auth/v1",
).replace(/\/$/, "");
const callbackBase = option(
  "--callback-base",
  process.env.P0_PROBE_ORIGIN ?? "http://127.0.0.1:8788",
);
const resource = option(
  "--resource",
  process.env.P0_MCP_RESOURCE ?? "http://127.0.0.1:8788/mcp",
);

async function provisionFixture() {
  const statusFile = option("--status-file", path.join(scratch, "status.json"));
  const status = await readJson(statusFile);
  if (!status?.API_URL || !status?.SECRET_KEY)
    throw new Error("LOCAL_STATUS_WITH_API_URL_AND_SECRET_KEY_REQUIRED");
  if (status.API_URL !== "http://127.0.0.1:55321")
    throw new Error("FIXTURE_PROVISIONING_REQUIRES_ISOLATED_API_55321");
  const email = option("--email", "p0-oauth-fixture@findmeatime.invalid");
  if (email !== "p0-oauth-fixture@findmeatime.invalid")
    throw new Error("DISPOSABLE_FIXTURE_IDENTITY_REQUIRED");
  const password = randomBytes(24).toString("base64url");
  const headers = {
    authorization: `Bearer ${status.SECRET_KEY}`,
    apikey: status.SECRET_KEY,
    "content-type": "application/json",
  };
  const list = await jsonFetch(
    `${status.API_URL}/auth/v1/admin/users?page=1&per_page=100`,
    { headers },
  );
  if (!list.response.ok)
    throw new Error(`FIXTURE_LIST_FAILED_${list.response.status}`);
  const existing = list.body.users?.find((user) => user.email === email);
  const endpoint = existing
    ? `${status.API_URL}/auth/v1/admin/users/${existing.id}`
    : `${status.API_URL}/auth/v1/admin/users`;
  const result = await jsonFetch(endpoint, {
    method: existing ? "PUT" : "POST",
    headers,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { fixture: "p0-oauth-only" },
    }),
  });
  if (!result.response.ok)
    throw new Error(
      `FIXTURE_PROVISION_FAILED_${result.response.status}_${result.body.code ?? "unknown"}`,
    );
  await writePrivateJson(path.join(scratch, "fixture-credentials.json"), {
    email,
    password,
    userId: result.body.id,
    createdAt: new Date().toISOString(),
    purpose: "disposable-local-p0-oauth-probe",
  });
  return {
    email,
    userId: result.body.id,
    credentialsFile: ".local/p0-oauth/fixture-credentials.json",
  };
}

async function complete(journey) {
  const file = journeyFile(journey);
  const state = await readJson(file);
  if (!state) throw new Error("JOURNEY_NOT_STARTED");
  if (state.callback?.error)
    throw new Error(`AUTHORIZATION_${state.callback.error}`);
  if (!state.callback?.code) throw new Error("CALLBACK_NOT_RECEIVED");
  const first = await exchange(state);
  if (!first.response.ok)
    throw new Error(
      `TOKEN_EXCHANGE_FAILED_${first.response.status}_${first.body.error ?? "unknown"}`,
    );
  const access = await verifyJwt(first.body.access_token, state);
  const identity = await userInfo(first.body.access_token, state);
  const userMatches =
    identity.response.ok && identity.body.sub === access.claims.sub;
  const refreshed = await exchange(state, first.body.refresh_token);
  const refreshVerification = refreshed.response.ok
    ? await verifyJwt(refreshed.body.access_token, state)
    : { valid: false, checks: {}, claims: null };
  const refreshRotated =
    refreshed.response.ok &&
    refreshed.body.refresh_token &&
    refreshed.body.refresh_token !== first.body.refresh_token;
  const strictValid =
    access.valid && userMatches && refreshVerification.valid && refreshRotated;
  state.tokens = {
    access_token: first.body.access_token,
    refresh_token: refreshed.body.refresh_token ?? first.body.refresh_token,
    refreshed_access_token: refreshed.body.access_token ?? null,
    scope: refreshed.body.scope ?? first.body.scope ?? null,
  };
  state.verification = {
    access: access.checks,
    refresh: refreshVerification.checks,
    userInfoHttpStatus: identity.response.status,
    userMatches,
    refreshHttpStatus: refreshed.response.status,
    refreshRotated,
    strictValid,
  };
  await writePrivateJson(file, state);
  await updateApplicationGrant({
    state,
    userId: access.claims.sub,
    active: strictValid,
    reason: strictValid
      ? "oauth-and-resource-validation-passed"
      : "strict-oauth-validation-failed",
  });
  return sanitizedState(state);
}

async function revoke(journey) {
  const file = journeyFile(journey);
  const state = await readJson(file);
  if (!state?.tokens?.refresh_token || !state?.tokens?.access_token)
    throw new Error("COMPLETED_JOURNEY_REQUIRED");
  const claims = (
    await verifyJwt(
      state.tokens.refreshed_access_token ?? state.tokens.access_token,
      state,
    )
  ).claims;
  const session = await readJson(path.join(scratch, "fixture-session.json"));
  if (!session?.access_token)
    throw new Error("FIXTURE_BROWSER_SESSION_MISSING");
  const revokeResponse = await jsonFetch(
    `${state.authBase}/user/oauth/grants?client_id=${encodeURIComponent(state.client.client_id)}`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: session.publishable_key,
        "x-supabase-api-version": "2024-01-01",
      },
    },
  );
  const deniedRefresh = await exchange(state, state.tokens.refresh_token);
  const deniedAccess = await userInfo(
    state.tokens.refreshed_access_token ?? state.tokens.access_token,
    state,
  );
  await updateApplicationGrant({
    state,
    userId: claims.sub,
    active: false,
    reason: "user-revoked-oauth-grant",
  });
  state.revoked = {
    revokeHttpStatus: revokeResponse.response.status,
    refreshAfterRevokeHttpStatus: deniedRefresh.response.status,
    refreshDenied: !deniedRefresh.response.ok,
    accessAfterRevokeHttpStatus: deniedAccess.response.status,
    accessDenied: !deniedAccess.response.ok,
    checkedAt: new Date().toISOString(),
  };
  await writePrivateJson(file, state);
  return sanitizedState(state);
}

try {
  let result;
  if (command === "discover") {
    const discovered = await discover(authBase);
    result = {
      httpStatus: discovered.httpStatus,
      standardsUrl: discovered.standardsUrl,
      usedUrl: discovered.usedUrl,
      fallbackUsed: discovered.fallbackUsed,
      issuer: discovered.metadata.issuer ?? null,
      authorizationEndpoint: discovered.metadata.authorization_endpoint ?? null,
      tokenEndpoint: discovered.metadata.token_endpoint ?? null,
      registrationEndpoint: discovered.metadata.registration_endpoint ?? null,
      pkceS256:
        discovered.metadata.code_challenge_methods_supported?.includes(
          "S256",
        ) ?? false,
      resourceParameterAdvertised:
        discovered.metadata.resource_parameter_supported ?? false,
    };
  } else if (command === "begin") {
    result = await beginJourney({
      authBase,
      journey: requireOption("--journey"),
      resource,
      callbackBase,
    });
  } else if (command === "complete") {
    result = await complete(requireOption("--journey"));
  } else if (command === "revoke") {
    result = await revoke(requireOption("--journey"));
  } else if (command === "show") {
    result = sanitizedState(
      await readJson(journeyFile(requireOption("--journey")), {}),
    );
  } else if (command === "provision-fixture") {
    result = await provisionFixture();
  } else {
    console.log(`Usage:
  node scripts/p0/oauth-probe.mjs discover [--auth-base URL]
  node scripts/p0/oauth-probe.mjs begin --journey terminal|browser [--resource URL]
  node scripts/p0/oauth-probe.mjs complete --journey terminal|browser
  node scripts/p0/oauth-probe.mjs revoke --journey terminal|browser
  node scripts/p0/oauth-probe.mjs show --journey terminal|browser
  node scripts/p0/oauth-probe.mjs provision-fixture [--status-file FILE]

Secrets and tokens are written only to ignored .local/p0-oauth files with mode 0600.`);
    process.exit(command === "help" ? 0 : 2);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}

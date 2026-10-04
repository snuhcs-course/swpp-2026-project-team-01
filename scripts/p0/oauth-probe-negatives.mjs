#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  beginJourney,
  exchange,
  jsonFetch,
  readJson,
  safeTokenClaims,
  scratch,
  verifyJwt,
  writePrivateJson,
} from "./oauth-probe-lib.mjs";

const authBase = "http://127.0.0.1:55321/auth/v1";
const origin = "http://127.0.0.1:8788";
const mcpResource = `${origin}/mcp`;
const wrongResource = `${origin}/not-the-mcp-resource`;
const fixture = await readJson(path.join(scratch, "fixture-credentials.json"));
const status = await readJson(path.join(scratch, "status.json"));
const originalJourneys = {
  browser: await readJson(path.join(scratch, "oauth-browser.json")),
  terminal: await readJson(path.join(scratch, "oauth-terminal.json")),
};
if (
  status?.API_URL !== "http://127.0.0.1:55321" ||
  !status?.PUBLISHABLE_KEY ||
  !fixture?.email ||
  !fixture?.password
)
  throw new Error("ISOLATED_55321_FIXTURE_REQUIRED");

async function fixtureSession() {
  const { response, body } = await jsonFetch(
    `${authBase}/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: status.PUBLISHABLE_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: fixture.email,
        password: fixture.password,
      }),
    },
  );
  if (!response.ok)
    throw new Error(`FIXTURE_SIGN_IN_FAILED_${response.status}`);
  return body;
}

async function approve(state, session) {
  const started = await fetch(state.authorizationUrl, { redirect: "manual" });
  if (started.status < 300 || started.status >= 400)
    throw new Error(`AUTHORIZE_REDIRECT_FAILED_${started.status}`);
  const consent = new URL(started.headers.get("location"), origin);
  const authorizationId = consent.searchParams.get("authorization_id");
  if (!authorizationId) throw new Error("AUTHORIZATION_ID_MISSING");
  const headers = {
    authorization: `Bearer ${session.access_token}`,
    apikey: status.PUBLISHABLE_KEY,
    "content-type": "application/json",
  };
  const details = await jsonFetch(
    `${authBase}/oauth/authorizations/${encodeURIComponent(authorizationId)}`,
    { headers },
  );
  if (!details.response.ok)
    throw new Error(`AUTHORIZATION_DETAILS_FAILED_${details.response.status}`);
  let redirectUrl = details.body.redirect_url;
  if (!redirectUrl) {
    const decision = await jsonFetch(
      `${authBase}/oauth/authorizations/${encodeURIComponent(authorizationId)}/consent`,
      { method: "POST", headers, body: JSON.stringify({ action: "approve" }) },
    );
    if (!decision.response.ok || !decision.body.redirect_url)
      throw new Error(`CONSENT_FAILED_${decision.response.status}`);
    redirectUrl = decision.body.redirect_url;
  }
  const callback = await fetch(redirectUrl, { redirect: "manual" });
  if (callback.status !== 303)
    throw new Error(`CALLBACK_CAPTURE_FAILED_${callback.status}`);
}

async function issue(journey, resource, session) {
  await beginJourney({ authBase, journey, resource, callbackBase: origin });
  const stateFile = path.join(scratch, `oauth-${journey}.json`);
  let state = await readJson(stateFile);
  await approve(state, session);
  state = await readJson(stateFile);
  const token = await exchange(state);
  if (!token.response.ok)
    throw new Error(`TOKEN_EXCHANGE_FAILED_${token.response.status}`);
  return { state, token: token.body };
}

async function mcp(token, method, params = {}, id = 1) {
  return jsonFetch(mcpResource, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

async function revoke(state, session) {
  return jsonFetch(
    `${authBase}/user/oauth/grants?client_id=${encodeURIComponent(state.client.client_id)}`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: status.PUBLISHABLE_KEY,
        "x-supabase-api-version": "2024-01-01",
      },
    },
  );
}

const session = await fixtureSession();
const regularSessionMcp = await mcp(session.access_token, "initialize");

const unallowlisted = await issue("browser", mcpResource, session);
await writePrivateJson(
  path.join(scratch, "oauth-negative-unallowlisted.json"),
  unallowlisted.state,
);
const unallowlistedVerification = await verifyJwt(
  unallowlisted.token.access_token,
  unallowlisted.state,
);
const unallowlistedMcp = await mcp(
  unallowlisted.token.access_token,
  "initialize",
);

const fixedBeforeMapping = await issue("terminal", wrongResource, session);
await writePrivateJson(
  path.join(scratch, "oauth-negative-wrong-resource.json"),
  fixedBeforeMapping.state,
);
const mapping = spawnSync(
  process.execPath,
  [
    "scripts/p0/oauth-probe-hook.mjs",
    "allow-fixed-resource",
    "--journey",
    "terminal",
  ],
  { cwd: path.resolve(import.meta.dirname, "../.."), encoding: "utf8" },
);
if (mapping.status !== 0) throw new Error("FIXED_RESOURCE_MAPPING_FAILED");
const remappedRefresh = await exchange(
  fixedBeforeMapping.state,
  fixedBeforeMapping.token.refresh_token,
);
if (!remappedRefresh.response.ok)
  throw new Error(`REMAPPED_REFRESH_FAILED_${remappedRefresh.response.status}`);
const fixedMapped = {
  state: fixedBeforeMapping.state,
  token: remappedRefresh.body,
};
const fixedClaims = safeTokenClaims(fixedMapped.token.access_token);
const requestedResourceVerification = await verifyJwt(
  fixedMapped.token.access_token,
  fixedMapped.state,
);
const mcpStateVerification = await verifyJwt(fixedMapped.token.access_token, {
  ...fixedMapped.state,
  resource: mcpResource,
});
const clientMismatchVerification = await verifyJwt(
  fixedMapped.token.access_token,
  unallowlisted.state,
);
const fixedInitialize = await mcp(fixedMapped.token.access_token, "initialize");
const deniedTool = await mcp(fixedMapped.token.access_token, "tools/call", {
  name: "diagnostic.read",
  arguments: {},
});

const unallowlistedRevoke = await revoke(unallowlisted.state, session);
const fixedRevoke = await revoke(fixedMapped.state, session);
for (const [journey, state] of Object.entries(originalJourneys)) {
  if (state)
    await writePrivateJson(path.join(scratch, `oauth-${journey}.json`), state);
}

console.log(
  JSON.stringify(
    {
      regularSessionWrongAudience: {
        tokenAudience: safeTokenClaims(session.access_token).aud,
        mcpHttpStatus: regularSessionMcp.response.status,
      },
      unallowlistedOAuthClient: {
        tokenAudience: unallowlistedVerification.claims.aud,
        audienceCheck: unallowlistedVerification.checks.audience,
        mcpHttpStatus: unallowlistedMcp.response.status,
        revokeHttpStatus: unallowlistedRevoke.response.status,
      },
      fixedClientMappingWithWrongRequestedResource: {
        requestedResource: wrongResource,
        audienceBeforeMapping: safeTokenClaims(
          fixedBeforeMapping.token.access_token,
        ).aud,
        tokenAudience: fixedClaims.aud,
        requestedResourceAudienceCheck:
          requestedResourceVerification.checks.audience,
        mcpResourceAudienceCheck: mcpStateVerification.checks.audience,
        mcpInitializeHttpStatus: fixedInitialize.response.status,
        applicationGrantHttpStatus: deniedTool.response.status,
        revokeHttpStatus: fixedRevoke.response.status,
      },
      clientMismatch: {
        signatureCheck: clientMismatchVerification.checks.signature,
        audienceCheck: clientMismatchVerification.checks.audience,
        clientCheck: clientMismatchVerification.checks.client,
        strictValid: clientMismatchVerification.valid,
      },
    },
    null,
    2,
  ),
);

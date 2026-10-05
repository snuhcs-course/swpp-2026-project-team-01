const authOrigin = "http://127.0.0.1:55321";
const authPath = "/auth/v1/oauth/authorize";
export const isolatedIssuer = `${authOrigin}/auth/v1`;
export const mcpResource = "http://127.0.0.1:8788/mcp";
export const identityScopes = ["email", "offline_access", "openid", "profile"];

export function assertCodexRunReplacementAllowed({
  run,
  registry,
  loginRunning,
}) {
  if (!run?.name) return;
  if (loginRunning) throw new Error("CODEX_LOGIN_ALREADY_RUNNING");
  const client = registry?.clients?.find(
    (candidate) => candidate.name === run.name,
  );
  if (client && ["pending", "active"].includes(client.status))
    throw new Error("OLD_NATIVE_CLIENT_MUST_BE_REVOKED_OR_INACTIVE");
}

export function proveCodexRefresh({ before, after, observations }) {
  if (!before || !after || !Array.isArray(observations))
    throw new Error("REFRESH_EVIDENCE_REQUIRED");
  if (
    before.serverName !== after.serverName ||
    before.clientId !== after.clientId ||
    before.fixtureUserId !== after.fixtureUserId
  )
    throw new Error("REFRESH_IDENTITY_CHANGED");
  if (observations.length !== 2)
    throw new Error("EXACTLY_TWO_TOKEN_OBSERVATIONS_REQUIRED");
  const [first, second] = observations;
  const exactObservation = (observation) =>
    observation.serverName === before.serverName &&
    observation.clientId === before.clientId &&
    observation.fixtureUserId === before.fixtureUserId &&
    observation.issuer === isolatedIssuer &&
    (observation.audience === mcpResource ||
      (Array.isArray(observation.audience) &&
        observation.audience.includes(mcpResource))) &&
    /^[0-9a-f]{64}$/.test(observation.tokenSha256 ?? "") &&
    observation.method === "tools/call" &&
    observation.tool === "diagnostic.read" &&
    observation.applicationGrantActive === true &&
    [
      "algorithm",
      "signature",
      "issuer",
      "audience",
      "client",
      "expiry",
      "subject",
    ].every((name) => observation.verificationChecks?.[name] === true);
  if (!exactObservation(first) || !exactObservation(second))
    throw new Error("STRICT_VERIFIED_TOKEN_OBSERVATIONS_REQUIRED");
  if (
    first.tokenSha256 === second.tokenSha256 ||
    !Number.isInteger(first.issuedAt) ||
    !Number.isInteger(second.issuedAt) ||
    second.issuedAt <= first.issuedAt ||
    !Number.isInteger(first.expiresAt) ||
    !Number.isInteger(second.expiresAt) ||
    second.expiresAt <= first.expiresAt
  )
    throw new Error("NEWER_ACCESS_TOKEN_NOT_PROVEN");
  if (Date.parse(second.observedAt) < first.expiresAt * 1000)
    throw new Error("NATURAL_ACCESS_TOKEN_EXPIRY_NOT_REACHED");
  const firstObserved = Date.parse(first.observedAt);
  const secondObserved = Date.parse(second.observedAt);
  const beforeCapturedAt = Date.parse(before.capturedAt);
  const afterCapturedAt = Date.parse(after.capturedAt);
  const utcInstant = (value) =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
  if (
    !utcInstant(first.observedAt) ||
    !utcInstant(second.observedAt) ||
    !utcInstant(before.capturedAt) ||
    !utcInstant(after.capturedAt) ||
    !Number.isFinite(firstObserved) ||
    !Number.isFinite(secondObserved) ||
    !Number.isFinite(beforeCapturedAt) ||
    !Number.isFinite(afterCapturedAt) ||
    afterCapturedAt <= beforeCapturedAt ||
    firstObserved > beforeCapturedAt ||
    secondObserved <= beforeCapturedAt ||
    secondObserved > afterCapturedAt
  )
    throw new Error("TOKEN_OBSERVATION_WINDOW_INVALID");
  const beforeSession = before.authSession;
  const afterSession = after.authSession;
  if (
    !beforeSession?.id ||
    beforeSession.id !== afterSession?.id ||
    beforeSession.oauthClientId !== before.clientId ||
    afterSession.oauthClientId !== after.clientId ||
    beforeSession.userId !== before.fixtureUserId ||
    afterSession.userId !== after.fixtureUserId
  )
    throw new Error("EXACT_OAUTH_SESSION_CONTINUITY_NOT_PROVEN");
  if (
    !exactStringSet(
      String(beforeSession.scopes ?? "")
        .split(/\s+/)
        .filter(Boolean),
      identityScopes,
    ) ||
    !exactStringSet(
      String(afterSession.scopes ?? "")
        .split(/\s+/)
        .filter(Boolean),
      identityScopes,
    )
  )
    throw new Error("EXACT_OAUTH_SESSION_SCOPES_NOT_PROVEN");
  const beforeRefreshedAt = Date.parse(beforeSession.refreshedAt);
  const afterRefreshedAt = Date.parse(afterSession.refreshedAt);
  const refreshTokens = after.refreshTokenState;
  const linkedParentCreatedAt = Date.parse(
    refreshTokens?.linkedParentCreatedAt,
  );
  const linkedParentRevokedAt = Date.parse(
    refreshTokens?.linkedParentRevokedAt,
  );
  const linkedChildCreatedAt = Date.parse(
    refreshTokens?.linkedChildCreatedAt,
  );
  const rotatedLegacyRefreshState =
    beforeSession.refreshTokenCounter === null &&
    beforeSession.refreshedAt === null &&
    afterSession.refreshTokenCounter === null &&
    refreshTokens?.rowCount === 2 &&
    refreshTokens.activeCount === 1 &&
    refreshTokens.revokedCount === 1 &&
    refreshTokens.parentLinkedCount === 1 &&
    refreshTokens.linkedRotationCount === 1 &&
    utcInstant(refreshTokens.linkedParentCreatedAt) &&
    utcInstant(refreshTokens.linkedParentRevokedAt) &&
    utcInstant(refreshTokens.linkedChildCreatedAt) &&
    linkedParentCreatedAt <= beforeCapturedAt &&
    linkedParentRevokedAt > beforeCapturedAt &&
    linkedChildCreatedAt > beforeCapturedAt &&
    Math.abs(linkedChildCreatedAt - second.issuedAt * 1000) <=
      15_000 &&
    Math.abs(linkedParentRevokedAt - second.issuedAt * 1000) <=
      15_000;
  const advancedExistingRefreshState =
    Number.isInteger(beforeSession.refreshTokenCounter) &&
    Number.isInteger(afterSession.refreshTokenCounter) &&
    afterSession.refreshTokenCounter > beforeSession.refreshTokenCounter &&
    Number.isFinite(beforeRefreshedAt) &&
    Number.isFinite(afterRefreshedAt) &&
    afterRefreshedAt > beforeRefreshedAt;
  if (
    after.evidenceSchemaVersion !== 2 ||
    after.timestampNormalization !== "database-utc-rfc3339" ||
    !utcInstant(afterSession.refreshedAt) ||
    (!rotatedLegacyRefreshState && !advancedExistingRefreshState) ||
    !Number.isFinite(afterRefreshedAt) ||
    Math.abs(afterRefreshedAt - second.issuedAt * 1000) > 15_000
  )
    throw new Error("AUTH_SESSION_REFRESH_NOT_PROVEN");
  const latestAudit = after.latestTokenRefreshedEvent;
  const latestAuditAt = Date.parse(latestAudit?.createdAt);
  if (
    !Number.isInteger(before.tokenRefreshedAuditCount) ||
    !Number.isInteger(after.tokenRefreshedAuditCount) ||
    after.tokenRefreshedAuditCount !== before.tokenRefreshedAuditCount + 1 ||
    !/^[0-9a-f-]{36}$/i.test(latestAudit?.id ?? "") ||
    latestAudit?.actorId !== before.fixtureUserId ||
    latestAudit?.action !== "token_refreshed" ||
    latestAudit?.logType !== "token" ||
    !utcInstant(latestAudit?.createdAt) ||
    !Number.isFinite(latestAuditAt) ||
    latestAuditAt <= beforeCapturedAt ||
    Math.abs(latestAuditAt - second.issuedAt * 1000) > 15_000
  )
    throw new Error("TOKEN_REFRESHED_AUDIT_NOT_PROVEN");
  return {
    proven: true,
    serverName: before.serverName,
    clientId: before.clientId,
    fixtureUserId: before.fixtureUserId,
    authSessionId: beforeSession.id,
    accessTokenChanged: true,
    firstIssuedAt: first.issuedAt,
    firstExpiresAt: first.expiresAt,
    secondIssuedAt: second.issuedAt,
    secondExpiresAt: second.expiresAt,
    refreshTokenCounterBefore: beforeSession.refreshTokenCounter,
    refreshTokenCounterAfter: afterSession.refreshTokenCounter,
    refreshTokenStorage:
      rotatedLegacyRefreshState ? "rotated-database-row" : "session-counter",
    tokenRefreshedAuditDelta:
      after.tokenRefreshedAuditCount - before.tokenRefreshedAuditCount,
  };
}

export function codexLoginArgs({ name, mcpUrl: requestedMcpUrl }) {
  if (!/^fmat_p0_native_[0-9a-f]{10}$/.test(name))
    throw new Error("PERSISTED_TASK_UNIQUE_NATIVE_NAME_REQUIRED");
  if (requestedMcpUrl !== mcpResource)
    throw new Error("EXACT_MCP_RESOURCE_REQUIRED");
  return [
    "mcp",
    "login",
    "-c",
    `mcp_servers.${name}.url=${JSON.stringify(requestedMcpUrl)}`,
    "--oauth-client-registration",
    "dcr",
    "--scopes",
    "openid,email,profile,offline_access",
    name,
  ];
}

export function exactStringSet(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  return (
    actualSet.size === actual.length &&
    expected.every((value) => actualSet.has(value))
  );
}

export function validatePendingAuthorization(authorizationUrl) {
  const authorization = new URL(authorizationUrl);
  if (
    authorization.username ||
    authorization.password ||
    authorization.hash ||
    authorization.origin !== authOrigin ||
    authorization.pathname !== authPath
  )
    throw new Error("ISOLATED_AUTHORIZATION_ENDPOINT_REQUIRED");
  const clientId = authorization.searchParams.get("client_id");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      clientId ?? "",
    )
  )
    throw new Error("DCR_UUID_CLIENT_REQUIRED");
  const resources = authorization.searchParams.getAll("resource");
  if (resources.length !== 1 || resources[0] !== mcpResource)
    throw new Error("EXACT_MCP_RESOURCE_REQUIRED");
  const rawRedirect = authorization.searchParams.get("redirect_uri");
  if (!rawRedirect) throw new Error("CODEX_LOOPBACK_REDIRECT_REQUIRED");
  const redirectUri = new URL(rawRedirect);
  if (
    redirectUri.protocol !== "http:" ||
    redirectUri.hostname !== "127.0.0.1" ||
    !redirectUri.port ||
    !redirectUri.pathname.startsWith("/callback/")
  )
    throw new Error("CODEX_LOOPBACK_REDIRECT_REQUIRED");
  const scopes = (authorization.searchParams.get("scope") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (!exactStringSet(scopes, identityScopes))
    throw new Error("EXACT_IDENTITY_SCOPES_REQUIRED");
  return {
    clientId,
    resource: mcpResource,
    redirectUri: redirectUri.href,
    scopes,
  };
}

function parseJsonLines(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function extractCodexFailureEvidence(jsonl) {
  return parseJsonLines(jsonl)
    .filter((event) =>
      ["error", "turn.failed", "item.failed"].includes(event.type),
    )
    .map((event) => {
      const serialized = JSON.stringify(event.error ?? event.message ?? event);
      let category = "other";
      if (/MCP tool call requires approval|approval policy is never/i.test(serialized))
        category = "approval_policy_denied";
      else if (/application_grant_denied/i.test(serialized))
        category = "application_grant_denied";
      else if (/403|forbidden|denied/i.test(serialized)) category = "forbidden";
      else if (/401|unauthorized|invalid_token/i.test(serialized))
        category = "unauthorized";
      else if (/initializ|handshake|mcp server/i.test(serialized))
        category = "mcp_initialization_failure";
      return { eventType: event.type, category };
    });
}

function textContent(result) {
  const content = result?.content ?? result?.result?.content ?? [];
  if (!Array.isArray(content)) return [];
  return content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text);
}

function parsedDiagnostic(texts) {
  for (const text of texts) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // A prose response is not accepted as structured tool evidence.
    }
  }
  return null;
}

function errorCategory(item) {
  const error = JSON.stringify(item.error ?? item.result?.error ?? "");
  if (/MCP tool call requires approval|approval policy is never/i.test(error))
    return "approval_policy_denied";
  if (/application_grant_denied/i.test(error))
    return "application_grant_denied";
  if (/403|forbidden|denied/i.test(error)) return "forbidden";
  if (/401|unauthorized|invalid_token/i.test(error)) return "unauthorized";
  return item.error ? "other" : null;
}

export function extractCodexMcpEvidence({
  jsonl,
  serverName,
  clientId,
  fixtureUserId,
}) {
  const calls = parseJsonLines(jsonl)
    .map((event) => ({ event, item: event.item ?? event }))
    .filter(
      ({ item }) =>
        item?.type === "mcp_tool_call" &&
        (item.server === serverName || item.server_name === serverName) &&
        (item.tool === "diagnostic.read" || item.name === "diagnostic.read"),
    );
  if (calls.length === 0)
    throw new Error("ACTUAL_DIAGNOSTIC_MCP_TOOL_CALL_EVENT_NOT_FOUND");
  return calls.map(({ event, item }) => {
    const diagnostic = parsedDiagnostic(textContent(item.result));
    return {
      eventType: event.type ?? null,
      itemStatus: item.status ?? (item.error ? "failed" : null),
      server: item.server ?? item.server_name,
      tool: item.tool ?? item.name,
      toolResultPresent: item.result != null,
      errorCategory: errorCategory(item),
      diagnostic: diagnostic
        ? {
            issuer: diagnostic.issuer ?? null,
            audience: diagnostic.audience ?? null,
            grant: diagnostic.grant ?? null,
            issuerMatches: diagnostic.issuer === isolatedIssuer,
            audienceMatches: diagnostic.audience === mcpResource,
            grantMatches: diagnostic.grant === "diagnostic.read",
            clientMatches: diagnostic.clientId === clientId,
            fixtureSubjectMatches: diagnostic.userId === fixtureUserId,
          }
        : null,
    };
  });
}

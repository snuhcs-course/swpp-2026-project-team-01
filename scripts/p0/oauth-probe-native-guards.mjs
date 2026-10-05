const authOrigin = "http://127.0.0.1:55321";
const authPath = "/auth/v1/oauth/authorize";
export const isolatedIssuer = `${authOrigin}/auth/v1`;
export const mcpResource = "http://127.0.0.1:8788/mcp";
export const identityScopes = ["email", "offline_access", "openid", "profile"];

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

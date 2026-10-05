import assert from "node:assert/strict";
import test from "node:test";
import {
  codexLoginArgs,
  exactStringSet,
  extractCodexFailureEvidence,
  extractCodexMcpEvidence,
  identityScopes,
  validatePendingAuthorization,
} from "./oauth-probe-native-guards.mjs";

const clientId = "123e4567-e89b-42d3-a456-426614174000";
const serverName = "fmat_p0_native_0123456789";
const fixtureUserId = "67a1eb2e-e91e-4662-a06f-642fab1e3954";

function authorizationUrl(overrides = {}) {
  const url = new URL(
    overrides.endpoint ?? "http://127.0.0.1:55321/auth/v1/oauth/authorize",
  );
  url.search = new URLSearchParams({
    client_id: clientId,
    resource: "http://127.0.0.1:8788/mcp",
    redirect_uri: "http://127.0.0.1:54548/callback/private-state",
    scope: "openid email profile offline_access",
    ...overrides.parameters,
  });
  return url.href;
}

test("pending native authorization is bound to the isolated endpoint, resource, redirect, and scopes", () => {
  const parsed = validatePendingAuthorization(authorizationUrl());
  assert.equal(parsed.clientId, clientId);
  assert.equal(parsed.resource, "http://127.0.0.1:8788/mcp");
  assert.equal(
    parsed.redirectUri,
    "http://127.0.0.1:54548/callback/private-state",
  );
  assert.equal(exactStringSet(parsed.scopes, identityScopes), true);

  assert.throws(
    () =>
      validatePendingAuthorization(
        authorizationUrl({
          endpoint: "http://127.0.0.1:54321/auth/v1/oauth/authorize",
        }),
      ),
    /ISOLATED_AUTHORIZATION_ENDPOINT_REQUIRED/,
  );
  assert.throws(
    () =>
      validatePendingAuthorization(
        authorizationUrl({
          parameters: { resource: "https://example.test/mcp" },
        }),
      ),
    /EXACT_MCP_RESOURCE_REQUIRED/,
  );
  const repeatedResource = `${authorizationUrl()}&resource=${encodeURIComponent("http://127.0.0.1:8788/mcp")}`;
  assert.throws(
    () => validatePendingAuthorization(repeatedResource),
    /EXACT_MCP_RESOURCE_REQUIRED/,
  );
  assert.throws(
    () => validatePendingAuthorization(`${authorizationUrl()}#fragment`),
    /ISOLATED_AUTHORIZATION_ENDPOINT_REQUIRED/,
  );
  assert.throws(
    () =>
      validatePendingAuthorization(
        authorizationUrl({
          endpoint:
            "http://user:password@127.0.0.1:55321/auth/v1/oauth/authorize",
        }),
      ),
    /ISOLATED_AUTHORIZATION_ENDPOINT_REQUIRED/,
  );
  assert.throws(
    () =>
      validatePendingAuthorization(
        authorizationUrl({
          parameters: {
            redirect_uri: "http://localhost:54548/callback/private-state",
          },
        }),
      ),
    /CODEX_LOOPBACK_REDIRECT_REQUIRED/,
  );
  assert.throws(
    () =>
      validatePendingAuthorization(
        authorizationUrl({
          parameters: { scope: "openid email profile calendar.read" },
        }),
      ),
    /EXACT_IDENTITY_SCOPES_REQUIRED/,
  );
});

test("Codex login uses the installed CLI's lowercase DCR choice and bounded identity request", () => {
  const args = codexLoginArgs({
    name: serverName,
    mcpUrl: "http://127.0.0.1:8788/mcp",
  });
  assert.deepEqual(args.slice(0, 2), ["mcp", "login"]);
  assert.equal(args[args.indexOf("--oauth-client-registration") + 1], "dcr");
  assert.equal(
    args[args.indexOf("--scopes") + 1],
    "openid,email,profile,offline_access",
  );
  assert.equal(args.at(-1), serverName);
  assert.throws(
    () =>
      codexLoginArgs({
        name: "unbounded",
        mcpUrl: "http://127.0.0.1:8788/mcp",
      }),
    /PERSISTED_TASK_UNIQUE_NATIVE_NAME_REQUIRED/,
  );
});

test("evidence requires an actual diagnostic MCP tool event and exact bindings", () => {
  const finalTextOnly = JSON.stringify({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: "I called diagnostic.read successfully",
    },
  });
  assert.throws(
    () =>
      extractCodexMcpEvidence({
        jsonl: finalTextOnly,
        serverName,
        clientId,
        fixtureUserId,
      }),
    /ACTUAL_DIAGNOSTIC_MCP_TOOL_CALL_EVENT_NOT_FOUND/,
  );

  const actualToolEvent = JSON.stringify({
    type: "item.completed",
    item: {
      type: "mcp_tool_call",
      server: serverName,
      tool: "diagnostic.read",
      status: "completed",
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              issuer: "http://127.0.0.1:55321/auth/v1",
              audience: "http://127.0.0.1:8788/mcp",
              clientId,
              userId: fixtureUserId,
              grant: "diagnostic.read",
            }),
          },
        ],
      },
    },
  });
  const [evidence] = extractCodexMcpEvidence({
    jsonl: actualToolEvent,
    serverName,
    clientId,
    fixtureUserId,
  });
  assert.equal(evidence.itemStatus, "completed");
  assert.deepEqual(evidence.diagnostic, {
    issuer: "http://127.0.0.1:55321/auth/v1",
    audience: "http://127.0.0.1:8788/mcp",
    grant: "diagnostic.read",
    issuerMatches: true,
    audienceMatches: true,
    grantMatches: true,
    clientMatches: true,
    fixtureSubjectMatches: true,
  });
});

test("structured initialization failure is recorded without inventing a tool call", () => {
  const jsonl = [
    JSON.stringify({
      type: "turn.failed",
      error: {
        message: "MCP server initialization failed with 401 unauthorized",
      },
    }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "diagnostic.read was denied" },
    }),
  ].join("\n");
  assert.deepEqual(extractCodexFailureEvidence(jsonl), [
    { eventType: "turn.failed", category: "unauthorized" },
  ]);
  assert.throws(
    () =>
      extractCodexMcpEvidence({
        jsonl,
        serverName,
        clientId,
        fixtureUserId,
      }),
    /ACTUAL_DIAGNOSTIC_MCP_TOOL_CALL_EVENT_NOT_FOUND/,
  );
});

test("structured tool approval denial stays distinct from server authorization denial", () => {
  const jsonl = JSON.stringify({
    type: "item.completed",
    item: {
      type: "mcp_tool_call",
      server: serverName,
      tool: "diagnostic.read",
      status: "failed",
      error:
        "MCP tool call requires approval, but approval policy is never",
    },
  });
  const [evidence] = extractCodexMcpEvidence({
    jsonl,
    serverName,
    clientId,
    fixtureUserId,
  });
  assert.equal(evidence.toolResultPresent, false);
  assert.equal(evidence.errorCategory, "approval_policy_denied");
  assert.equal(evidence.diagnostic, null);
});

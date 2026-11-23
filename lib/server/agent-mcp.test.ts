import { describe, expect, it } from "vitest";
import { AGENT_SCOPES, REQUESTER_SCOPES } from "../contracts/agent-access";
import { ACCOUNT_REQUESTER_TOOLS } from "./agent-account-requester-tools";
import { HOST_TOOLS } from "./agent-host-tools";
import { callable, challengeScopes, visibleTools } from "./agent-mcp";
import { REQUESTER_TOOLS } from "./agent-requester-tools";
import { protectedResourceMetadata } from "./agent-resources";
import type { GrantAccess } from "./agent-grants";

// The 401 challenge names every scope a tool of the endpoint needs, because
// clients request the challenged scopes on a fresh connection; a missing one
// leaves its tools out of every grant made from it.
describe("challengeScopes", () => {
  it("names every scope the host endpoint's tools need, the account requester tools included", () => {
    const needed = new Set([...HOST_TOOLS, ...ACCOUNT_REQUESTER_TOOLS].map((tool) => tool.scope));
    expect(new Set(challengeScopes("host"))).toEqual(needed);
    expect(challengeScopes("host")).toEqual([...AGENT_SCOPES]);
  });

  it("names the requester scopes on a requester endpoint", () => {
    expect(new Set(challengeScopes("requester"))).toEqual(new Set(REQUESTER_TOOLS.map((tool) => tool.scope)));
    expect(challengeScopes("requester")).toEqual([...REQUESTER_SCOPES]);
  });

  it("matches the scopes the resource metadata supports", () => {
    expect(challengeScopes("host")).toEqual(protectedResourceMetadata("https://example.test", "https://example.test/mcp", "host").scopes_supported);
    expect(challengeScopes("requester")).toEqual(protectedResourceMetadata("https://example.test", "https://example.test/h/mcp", "requester").scopes_supported);
  });
});

// The server is stateless and cannot push notifications/tools/list_changed,
// and clients such as Claude load tools/list once per conversation, so an
// unbound bootstrap grant must already list the tools the request needs after
// create_request, or the agent cannot find times in the same conversation (#323).
describe("requester tool visibility", () => {
  const unbound: GrantAccess = {
    bootstrap: true,
    clientId: "client",
    closed: false,
    creationRetryKey: null,
    grantId: "grant",
    hostAccountId: "host",
    requestId: null,
    resource: "https://example.test/h/mcp",
    role: "requester",
    scopes: [...REQUESTER_SCOPES],
    sourceHash: "source",
  };
  const bound: GrantAccess = { ...unbound, creationRetryKey: "create-0001", requestId: "request" };
  const names = (access: GrantAccess) => visibleTools(access).map((tool) => tool.name);
  const tool = (name: string) => REQUESTER_TOOLS.find((candidate) => candidate.name === name)!;

  it("lists every requester tool on an unbound bootstrap grant, before the request exists", () => {
    expect(names(unbound)).toEqual(REQUESTER_TOOLS.map((candidate) => candidate.name));
    expect(names(unbound)).toEqual(expect.arrayContaining(["get_host", "create_request", "get_request", "find_times", "choose_time", "agree_to_proposal"]));
  });

  it("keeps the same tools listed after create_request binds the grant, except create_request", () => {
    expect(names(bound)).toEqual(names(unbound).filter((name) => name !== "create_request"));
  });

  it("runs only the bootstrap tools until the grant is bound", () => {
    expect(REQUESTER_TOOLS.filter((candidate) => callable(unbound, candidate)).map((candidate) => candidate.name)).toEqual(["get_host", "create_request"]);
    expect(callable(bound, tool("find_times"))).toBe(true);
    expect(callable(bound, tool("create_request"))).toBe(true);
  });

  it("still lists only the tools the grant's scopes permit", () => {
    const readOnly: GrantAccess = { ...unbound, scopes: ["request:read"] };
    expect(names(readOnly)).toEqual(REQUESTER_TOOLS.filter((candidate) => candidate.scope === "request:read").map((candidate) => candidate.name));
    expect(callable(readOnly, tool("create_request"))).toBe(false);
  });
});

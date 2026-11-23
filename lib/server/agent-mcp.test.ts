import { describe, expect, it } from "vitest";
import { AGENT_SCOPES, REQUESTER_SCOPES } from "../contracts/agent-access";
import { ACCOUNT_REQUESTER_TOOLS } from "./agent-account-requester-tools";
import { HOST_TOOLS } from "./agent-host-tools";
import { callable, challengeScopes, uncallableRefusal, visibleTools } from "./agent-mcp";
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

  it("points an unbound grant's refusal at create_request, which it can run", () => {
    expect(uncallableRefusal(unbound)).toEqual({ category: "request_unavailable", message: "Create the request first with create_request.", nextAction: "Call create_request, then try again." });
    expect(uncallableRefusal(bound).category).toBe("already_created");
    expect(uncallableRefusal({ ...bound, closed: true }).category).toBe("request_closed");
  });

  it("still lists only the tools the grant's scopes permit", () => {
    const readOnly: GrantAccess = { ...unbound, scopes: ["request:read"] };
    expect(names(readOnly)).toEqual(REQUESTER_TOOLS.filter((candidate) => candidate.scope === "request:read").map((candidate) => candidate.name));
    expect(callable(readOnly, tool("create_request"))).toBe(false);
  });
});

// Testing baseline rows marked supported that the MCP tool lists decide
// (module test map): H03 P-4, H04 P-2, G03 P-2, R01 P-1, P-4, P-5 and P-7.
describe("tools the testing baseline names", () => {
  const host: GrantAccess = {
    bootstrap: false,
    clientId: "client",
    closed: false,
    creationRetryKey: null,
    grantId: "grant",
    hostAccountId: "host",
    requestId: null,
    resource: "https://example.test/mcp",
    role: "host",
    scopes: [...AGENT_SCOPES],
    sourceHash: "source",
  };
  const names = (access: GrantAccess) => visibleTools(access).map((tool) => tool.name);

  it("lets a host's agent waive the weekly limit, allow a trip and check a booking (H03 P-4, H04 P-2)", () => {
    expect(names(host)).toEqual(expect.arrayContaining(["waive_weekly_limit", "allow_host_trip", "evaluate_request", "check_booking"]));
  });

  it("offers received and sent requests side by side on one host connection (R01 P-4, P-5, P-7)", () => {
    expect(names(host)).toEqual(expect.arrayContaining(["list_requests", "list_sent_requests", "get_sent_request", "check_sent_booking", "create_request"]));
  });

  it("needs the request permissions before a host-only grant can create a request (R01 P-1)", () => {
    const hostOnly: GrantAccess = { ...host, scopes: ["host:read", "host:write", "host:decide"] };
    const create = ACCOUNT_REQUESTER_TOOLS.find((tool) => tool.name === "create_request")!;

    expect(names(hostOnly)).not.toContain("create_request");
    expect(callable(hostOnly, create)).toBe(false);
    expect(callable(host, create)).toBe(true);
    expect(challengeScopes("host")).toEqual(expect.arrayContaining(["request:write"]));
  });

  it("lets a guest's agent check its booking once the request exists (G03 P-2)", () => {
    const guest: GrantAccess = { ...host, creationRetryKey: "create-0001", requestId: "request", resource: "https://example.test/h/mcp", role: "requester", scopes: [...REQUESTER_SCOPES] };
    const check = REQUESTER_TOOLS.find((tool) => tool.name === "check_booking")!;

    expect(callable(guest, check)).toBe(true);
  });
});

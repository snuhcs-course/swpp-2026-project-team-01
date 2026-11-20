import { describe, expect, it } from "vitest";
import { AGENT_SCOPES, REQUESTER_SCOPES } from "../contracts/agent-access";
import { ACCOUNT_REQUESTER_TOOLS } from "./agent-account-requester-tools";
import { HOST_TOOLS } from "./agent-host-tools";
import { challengeScopes } from "./agent-mcp";
import { REQUESTER_TOOLS } from "./agent-requester-tools";
import { protectedResourceMetadata } from "./agent-resources";

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

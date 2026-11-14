import { describe, expect, it } from "vitest";
import { HOST_TOOLS } from "./agent-host-tools";
import { toolDefinition } from "./agent-tools";

// The host's decision tools (agent-decisions-in-words D1 and D2): what an agent
// sees before it calls them, and the inputs they refuse before any command runs.

function tool(name: string) {
  const found = HOST_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

const requestId = "7d5f4a8e-6b1c-4f7e-9a2d-3c8b1e0f5a6d";

describe("host decision tools", () => {
  it("replace the review-link tool and need host:decide", () => {
    expect(HOST_TOOLS.map((candidate) => candidate.name)).not.toContain("request_host_decision");
    expect(tool("approve_proposal").scope).toBe("host:decide");
    expect(tool("decline_request").scope).toBe("host:decide");
  });

  it("require the host's words, the retry key and the expected revision", () => {
    expect(toolDefinition(tool("approve_proposal")).inputSchema.required).toEqual(
      expect.arrayContaining(["requestId", "version", "expectedRevision", "hostInstruction", "retryKey"]),
    );
    expect(toolDefinition(tool("decline_request")).inputSchema.required).toEqual(
      expect.arrayContaining(["requestId", "expectedRevision", "hostInstruction", "retryKey"]),
    );
  });

  it("refuse a missing, blank or overlong instruction and a decline with conditions as extra fields", () => {
    const approve = tool("approve_proposal").input;
    const base = { expectedRevision: 3, requestId, retryKey: "approve-0001", version: 2 };
    expect(approve.safeParse({ ...base, hostInstruction: "Approve it" }).success).toBe(true);
    expect(approve.safeParse(base).success).toBe(false);
    expect(approve.safeParse({ ...base, hostInstruction: "  " }).success).toBe(false);
    expect(approve.safeParse({ ...base, hostInstruction: "x".repeat(501) }).success).toBe(false);

    const decline = tool("decline_request").input;
    const declineBase = { expectedRevision: 3, hostInstruction: "Decline it", requestId, retryKey: "decline-0001" };
    expect(decline.safeParse(declineBase).success).toBe(true);
    expect(decline.safeParse({ ...declineBase, expectedRevision: undefined }).success).toBe(false);
    expect(decline.safeParse({ ...declineBase, onlyIf: "they can't move it" }).success).toBe(false);
  });

  it("mark the decline destructive and tell the agent when it may decide", () => {
    expect(toolDefinition(tool("decline_request")).annotations.destructiveHint).toBe(true);
    expect(toolDefinition(tool("approve_proposal")).annotations.readOnlyHint).toBe(false);
    for (const name of ["approve_proposal", "decline_request"]) {
      expect(tool(name).description).toMatch(/clearly told you, in their own words/);
      expect(tool(name).description).toMatch(/never on your own judgment/);
      expect(tool(name).description).toMatch(/condition/);
    }
  });
});

import { describe, expect, it } from "vitest";
import { ACCOUNT_REQUESTER_TOOLS } from "./agent-account-requester-tools";

// R01 P-2 (account-request-identity): the account connection's create_request
// takes no name or email; the account supplies them.
describe("account create_request", () => {
  const tool = ACCOUNT_REQUESTER_TOOLS.find((entry) => entry.name === "create_request")!;
  const base = { hostHandle: "dodo", retryKey: "retry-key-1" };

  it("needs neither identity nor timezone", () => {
    expect(tool.input.safeParse(base).success).toBe(true);
    expect(tool.input.safeParse({ ...base, timezone: "Asia/Seoul", details: { purpose: "Compilers" } }).success).toBe(true);
  });

  it("refuses a typed name or email", () => {
    expect(tool.input.safeParse({ ...base, name: "Grace" }).success).toBe(false);
    expect(tool.input.safeParse({ ...base, email: "grace@example.test" }).success).toBe(false);
  });

  it("tells the agent not to ask for the person's identity", () => {
    expect(tool.description).toContain("never ask the person for their name or email");
    expect(tool.description).not.toContain("stated identity");
  });
});

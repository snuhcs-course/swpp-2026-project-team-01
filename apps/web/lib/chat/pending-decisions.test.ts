import { describe, expect, it } from "vitest";
import { badgeText, pendingDecisionCount, pendingDecisionLabel } from "./pending-decisions";

describe("pending host decisions", () => {
  it("counts only the requests that need the host's decision", () => {
    expect(pendingDecisionCount([{ needsDecision: true }, { needsDecision: false }, { needsDecision: true }])).toBe(2);
    expect(pendingDecisionCount([{ needsDecision: false }])).toBe(0);
    expect(pendingDecisionCount([])).toBe(0);
  });

  it("caps the badge at 9+ and names the count in words", () => {
    expect(badgeText(1)).toBe("1");
    expect(badgeText(9)).toBe("9");
    expect(badgeText(12)).toBe("9+");
    expect(pendingDecisionLabel(1)).toBe("1 request needs your decision");
    expect(pendingDecisionLabel(3)).toBe("3 requests need your decision");
  });
});

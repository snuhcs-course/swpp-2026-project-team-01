import { describe, expect, it } from "vitest";
import { DEFENSE_CASES } from "./defense-cases";

// The defense set is append-only (documentation 10): eval ids follow the
// array's order, so a case inserted in the middle would renumber later ones.
const DECLARED_BEFORE_2026_11_23 = [
  ...Array.from({ length: 18 }, (_, index) => `G-E${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 6 }, (_, index) => `G-M0${index + 1}`),
  "G-F01",
  "G-R01",
];

describe("the guest defense set", () => {
  it("keeps every earlier case in its place and appends new ones after them", () => {
    expect(DEFENSE_CASES.slice(0, DECLARED_BEFORE_2026_11_23.length).map((entry) => entry.id)).toEqual(DECLARED_BEFORE_2026_11_23);
    expect(new Set(DEFENSE_CASES.map((entry) => entry.id)).size).toBe(DEFENSE_CASES.length);
  });

  it("balances attacks with at least 15 over-refusal controls (#151)", () => {
    const controls = DEFENSE_CASES.filter((entry) => entry.category === "over-refusal");

    expect(controls.length).toBeGreaterThanOrEqual(15);
    // A control is never an attack: it names no OWASP category, and every graded turn has a check.
    for (const entry of controls) {
      expect(entry.owasp).toEqual([]);
      expect(entry.turns.every((turn) => turn.checks.length > 0)).toBe(true);
    }
  });

  it("checks the draft in the database for every control that asks for a change, as G-E18 does", () => {
    const drafting = DEFENSE_CASES.filter((entry) => entry.category === "over-refusal" && entry.expectedReview);

    expect(drafting.map((entry) => entry.id)).toEqual(["G-E18", "G-E19", "G-E21", "G-E25", "G-E28", "G-E29"]);
    for (const entry of drafting) {
      // Real tools run only in S1, so only there can a draft be checked.
      expect(entry.state).toBe("S1");
      expect(entry.calledTools).toContain("draft_request_review");
    }
  });
});

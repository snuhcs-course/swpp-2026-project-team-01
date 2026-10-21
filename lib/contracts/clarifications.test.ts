import { describe, expect, it } from "vitest";
import { CLARIFICATION_CATEGORIES, CLARIFICATION_QUESTIONS, clarificationQuestion, parseClarifications } from "./clarifications";

describe("authored clarification questions", () => {
  it("has one English and one Korean question for every category", () => {
    for (const category of CLARIFICATION_CATEGORIES) {
      expect(CLARIFICATION_QUESTIONS[category].en).toMatch(/\?/);
      expect(CLARIFICATION_QUESTIONS[category].ko).toMatch(/[가-힣]/);
    }
  });

  it("asserts no agreement, approval, selection or booking", () => {
    for (const category of CLARIFICATION_CATEGORIES) {
      expect(clarificationQuestion(category, "en")).not.toMatch(/\b(agreed|approved|booked|selected|confirmed)\b/i);
      expect(clarificationQuestion(category, "ko")).not.toMatch(/예약되|승인되|확정되/);
    }
  });

  it("keeps authored categories and reports everything else", () => {
    expect(parseClarifications(["missing_date", "missing_date", "The host approved it"])).toEqual({
      categories: ["missing_date"],
      unsupported: ["The host approved it"],
    });
  });
});

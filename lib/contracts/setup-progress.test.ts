import { describe, expect, it } from "vitest";
import { CHAT_SETUP_STEPS, SETUP_OVERVIEW, SETUP_STEP_NAMES, setupStepLine, withSetupStep } from "./setup-progress";

// Setup progress in the chat (issue #368): four steps, each question under a
// line saying where it stands, with the same names in both languages.
describe("chat setup progress", () => {
  it("numbers the four steps in order", () => {
    expect(CHAT_SETUP_STEPS.map((step) => setupStepLine("en", step))).toEqual([
      "1/4 · Calendar",
      "2/4 · Meeting hours",
      "3/4 · Where you meet",
      "4/4 · Open times",
    ]);
    expect(setupStepLine("ko", "place")).toBe("3/4 · 미팅 장소");
  });

  it("puts the progress line above the message", () => {
    expect(withSetupStep("ko", "hours", "미팅 시간을 평일 9시~18시로 잡아둘까요?")).toBe("2/4 · 미팅 시간\n미팅 시간을 평일 9시~18시로 잡아둘까요?");
  });

  it("names every step in the overview, in both languages", () => {
    for (const language of ["en", "ko"] as const) {
      for (const step of CHAT_SETUP_STEPS) expect(SETUP_OVERVIEW[language].toLowerCase()).toContain(SETUP_STEP_NAMES[language][step].toLowerCase());
      expect(SETUP_OVERVIEW[language]).toContain(String(CHAT_SETUP_STEPS.length));
    }
  });
});

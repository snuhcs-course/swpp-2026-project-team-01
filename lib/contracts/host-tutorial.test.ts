import { describe, expect, it } from "vitest";
import { TUTORIAL_FEEDBACK, TUTORIAL_TEXT } from "./host-tutorial";

// The tutorial offer (issue #377): it says what the tutorial is before asking,
// that no real person is messaged, and the Korean says the same as the English.
describe("tutorial offer", () => {
  it("explains the sample request before the question", () => {
    expect(TUTORIAL_TEXT.en.offer).toMatch(/^A pretend guest sends you a sample request[^?]*\. Nobody real gets a message\. Want to try\?$/);
    expect(TUTORIAL_TEXT.ko.offer).toMatch(/^가상의 게스트가 샘플 요청을[^?]*실제로는 아무에게도 메시지가 가지 않아요\. 해보실래요\?$/);
  });

  it("calls the sample a sample request in Korean too, as the English does", () => {
    for (const text of [TUTORIAL_TEXT.ko.offer, TUTORIAL_FEEDBACK.ko.approve, TUTORIAL_FEEDBACK.ko.decline, TUTORIAL_FEEDBACK.ko.change]) {
      expect(text).toContain(TUTORIAL_TEXT.ko.sample);
      expect(text).not.toContain("튜토리얼 요청");
    }
    expect(TUTORIAL_TEXT.en.offer).toContain(TUTORIAL_TEXT.en.sample.toLowerCase());
  });

  it("stays one short message", () => {
    for (const language of ["en", "ko"] as const) expect(TUTORIAL_TEXT[language].offer.length).toBeLessThanOrEqual(140);
  });
});

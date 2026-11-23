import { describe, expect, it } from "vitest";
import { assistantModelChoice, formatModelChoice, parseModelChoice, rankingModelChoice } from "./model-choice";

describe("model choice", () => {
  it("parses provider/model strings for the direct providers", () => {
    expect(parseModelChoice("openai/gpt-5.6-terra")).toEqual({ modelId: "gpt-5.6-terra", provider: "openai" });
    expect(parseModelChoice(" anthropic/claude-sonnet-5-5 ")).toEqual({ modelId: "claude-sonnet-5-5", provider: "anthropic" });
    expect(formatModelChoice(parseModelChoice("anthropic/claude-opus-5-5"))).toBe("anthropic/claude-opus-5-5");
  });

  it("rejects bare IDs, empty parts and providers it cannot call directly", () => {
    for (const value of ["gpt-5.6-terra", "/gpt-5.6-terra", "openai/", "openai/gpt 5", "openai/a/b"]) {
      expect(() => parseModelChoice(value), value).toThrow(/provider\/model/);
    }
    expect(() => parseModelChoice("google/gemini-3.5-flash")).toThrow(/not one of openai, anthropic/);
  });

  it("keeps gpt-5.6-terra for both assistants unless the environment chooses", () => {
    expect(assistantModelChoice({})).toEqual({ modelId: "gpt-5.6-terra", provider: "openai" });
    expect(rankingModelChoice({ FMAT_RANKING_MODEL: "  " })).toEqual({ modelId: "gpt-5.6-terra", provider: "openai" });
    expect(assistantModelChoice({ FMAT_ASSISTANT_MODEL: "anthropic/claude-sonnet-5-5" }).provider).toBe("anthropic");
    // Each assistant reads its own variable.
    expect(rankingModelChoice({ FMAT_ASSISTANT_MODEL: "anthropic/claude-sonnet-5-5" }).provider).toBe("openai");
    expect(() => assistantModelChoice({ FMAT_ASSISTANT_MODEL: "claude-sonnet-5-5" })).toThrow();
  });
});

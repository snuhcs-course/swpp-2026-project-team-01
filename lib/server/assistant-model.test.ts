import { wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { ASSISTANT_CONTEXT_WINDOW_TOKENS, assistantModelFields, sessionKeyMiddleware } from "./assistant-model";
import { sessionIdHash } from "./model-limits";

type Captured = { providerOptions?: Record<string, Record<string, unknown>> };

const answer = {
  content: [{ text: "ok", type: "text" as const }],
  finishReason: { raw: "stop", unified: "stop" as const },
  usage: {
    inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
    outputTokens: { reasoning: 0, text: 1, total: 1 },
  },
  warnings: [],
};

describe("assistant model", () => {
  it("keeps the static OpenAI model and its options by default", () => {
    const fields = assistantModelFields({ modelId: "gpt-5.6-terra", provider: "openai" });
    expect(fields.model).toMatchObject({ modelId: "gpt-5.6-terra", provider: "openai.responses" });
    expect(fields).toMatchObject({
      modelContextWindowTokens: ASSISTANT_CONTEXT_WINDOW_TOKENS,
      modelOptions: { providerOptions: { openai: { serviceTier: "default", store: false } } },
    });
  });

  it("resolves another provider per call, wrapped with the session's key", async () => {
    const fields = assistantModelFields({ modelId: "claude-sonnet-5-5", provider: "anthropic" }) as {
      model: { events: Record<string, (event: unknown, ctx: unknown) => { model: { modelId: string; provider: string }; modelContextWindowTokens: number }> };
    };
    expect(Object.keys(fields)).toEqual(["model"]);
    const selection = await fields.model.events["step.started"]!({}, { session: { id: "wrun_1" } });
    expect(selection.model).toMatchObject({ modelId: "claude-sonnet-5-5" });
    expect(selection.model.provider).toMatch(/^anthropic/);
    expect(selection.modelContextWindowTokens).toBe(ASSISTANT_CONTEXT_WINDOW_TOKENS);
  });

  it("writes the key before an inner wrapper, such as the limit middleware, reads the options", async () => {
    let seen: Captured = {};
    const inner = wrapLanguageModel({
      middleware: {
        specificationVersion: "v4",
        transformParams: async ({ params }) => {
          seen = params as Captured;
          return params;
        },
      },
      model: new MockLanguageModelV4({ doGenerate: async () => answer, modelId: "claude-sonnet-5-5", provider: "anthropic.messages" }),
    });
    const model = wrapLanguageModel({ middleware: sessionKeyMiddleware("wrun_1"), model: inner });

    await model.doGenerate({ prompt: [{ content: [{ text: "hi", type: "text" }], role: "user" }], providerOptions: { anthropic: { effort: "medium" } } });

    expect(seen.providerOptions).toEqual({ anthropic: { effort: "medium" }, openai: { promptCacheKey: sessionIdHash("wrun_1") } });
  });
});

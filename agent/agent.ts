import { defineAgent } from "eve";
import { openai } from "eve/models/openai";
import { limitModel } from "../lib/server/model-limits";

// Direct OpenAI with the team's key (design decision 5). Every provider call,
// including eve's retries and compaction, passes the model limit middleware
// (decision 6); the wrapper keeps the provider and model ID, so eve still adds
// OpenAI's safety identifier and prompt cache key.
export default defineAgent({
  model: limitModel(openai("gpt-5.6-terra")),
  // Reasoning tokens count against the 4,096-token output cap; medium effort
  // used about 120 of them on a scheduling question (measured 2026-10-19).
  reasoning: "medium",
  modelContextWindowTokens: 32_000,
  modelOptions: {
    providerOptions: {
      openai: { serviceTier: "default", store: false },
    },
  },
  // Compacting at about 19,000 tokens keeps the compaction call itself under the
  // 128 KiB serialized-input cap.
  compaction: { thresholdPercent: 0.6 },
  // Host discussions can outlive eve's 30-day default; a lifetime ending is not a
  // confirmed runtime failure (decision 7).
  limits: { sessionTimeoutMs: false },
});

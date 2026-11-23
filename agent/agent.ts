import { defineAgent } from "eve";
import { ASSISTANT_REASONING, assistantModelFields } from "../lib/server/assistant-model";

// Direct provider access with the team's key (design decision 5), the model
// chosen by FMAT_ASSISTANT_MODEL and gpt-5.6-terra by default
// (lib/server/model-choice.ts). Every provider call, including eve's retries and
// compaction, passes the model limit middleware (decision 6); the wrapper keeps
// the provider and model ID, so eve still adds the provider's safety identifier
// and, for OpenAI, the prompt cache key (lib/server/assistant-model.ts).
export default defineAgent({
  ...assistantModelFields(),
  reasoning: ASSISTANT_REASONING,
  // Compacting at about 19,000 tokens keeps the compaction call itself under the
  // 128 KiB serialized-input cap.
  compaction: { thresholdPercent: 0.6 },
  // Host discussions can outlive eve's 30-day default; a lifetime ending is not a
  // confirmed runtime failure (decision 7).
  limits: { sessionTimeoutMs: false },
  // No tools until a phase registers its own (agent configuration, permission
  // layers): no eve defaults and no built-in agent tool.
  defaultTools: false,
  tool: false,
});

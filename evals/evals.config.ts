import { defineEvalConfig } from "eve/evals";
import { closeHostEvalDatabase } from "./host-review/support";
import { closeEvalDatabase } from "./requester/support";
import { startStoryRuntime, stopStoryRuntime } from "./story/runtime";

// Evals check the soft layer (agent configuration: permission layers, layer
// 5): what the live model says and which tools it calls. The defense and
// approval sets stub every tool; the story sets run the tools for real against
// the local database and a fake Google this setup starts (story/runtime.ts),
// before eve starts its dev server. They need the local Supabase stack
// (`supabase start`), a model key and FMAT_EVAL_AUDIENCE: requester for
// evals/requester (`npm run eval` sets it), host_review for evals/host-review.
export default defineEvalConfig({
  maxConcurrency: 2,
  setup: async () => {
    await startStoryRuntime();
  },
  teardown: async () => {
    await stopStoryRuntime();
    await closeEvalDatabase();
    await closeHostEvalDatabase();
  },
  timeoutMs: 120_000,
});

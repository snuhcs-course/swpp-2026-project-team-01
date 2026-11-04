import { defineEvalConfig } from "eve/evals";
import { closeHostEvalDatabase } from "./host-review/support";
import { closeEvalDatabase } from "./requester/support";

// Evals check the soft layer (agent configuration: permission layers, layer
// 5): what the live model says and which tools it calls, with every tool
// stubbed. They need the local Supabase stack (`supabase start`), a model key
// and FMAT_EVAL_AUDIENCE: requester for evals/requester (`npm run eval` sets
// it), host_review for evals/host-review.
export default defineEvalConfig({
  maxConcurrency: 2,
  teardown: async () => {
    await closeEvalDatabase();
    await closeHostEvalDatabase();
  },
  timeoutMs: 120_000,
});

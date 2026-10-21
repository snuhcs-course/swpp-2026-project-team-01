import { defineEvalConfig } from "eve/evals";
import { closeEvalDatabase } from "./requester/support";

// Evals check the soft layer (agent configuration: permission layers, layer
// 5): what the live model says and which tools it calls, with every tool
// stubbed. They need the local Supabase stack (`supabase start`), a model key
// and FMAT_EVAL_AUDIENCE=requester, which `npm run eval` sets.
export default defineEvalConfig({
  maxConcurrency: 2,
  teardown: closeEvalDatabase,
  timeoutMs: 120_000,
});

import { SETUP_CASES } from "./setup-cases";
import { DEFAULT_TRIALS, setupEval } from "./setup-runner";

// The fixed host setup set (setup-cases.ts), graded by setup-runner.ts.
// Run with FMAT_EVAL_AUDIENCE=host_setup, which admits host setup sessions only.
export default SETUP_CASES.flatMap((entry) =>
  Array.from({ length: entry.trials ?? DEFAULT_TRIALS }, (_, index) => setupEval(entry, index + 1)),
);

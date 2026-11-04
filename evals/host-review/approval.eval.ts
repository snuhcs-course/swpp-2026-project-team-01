import { APPROVAL_CASES } from "./approval-cases";
import { approvalEval, DEFAULT_TRIALS } from "./approval-runner";

// The fixed host approval set (approval-cases.ts), graded by approval-runner.ts.
// Run with FMAT_EVAL_AUDIENCE=host_review, which admits host-review sessions only.
export default APPROVAL_CASES.flatMap((entry) =>
  Array.from({ length: entry.trials ?? DEFAULT_TRIALS }, (_, index) => approvalEval(entry, index + 1)),
);

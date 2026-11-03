import { DEFENSE_CASES } from "./defense-cases";
import { DEFAULT_TRIALS, defenseEval } from "./defense-runner";

// The fixed requester defense set (defense-cases.ts), graded by defense-runner.ts.
export default DEFENSE_CASES.flatMap((entry) =>
  Array.from({ length: entry.trials ?? DEFAULT_TRIALS }, (_, index) => defenseEval(entry, index + 1)),
);

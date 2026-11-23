import { evalTrials } from "../tags";
import { JOURNEY_CASES } from "./journey-cases";
import { DEFAULT_TRIALS, journeyEval } from "./journey-runner";

// The simulated guest journey set (journey-cases.ts), graded by journey-runner.ts.
// Run with FMAT_EVAL_AUDIENCE=requester: `npx eve eval requester/journey`.
export default JOURNEY_CASES.flatMap((entry) =>
  Array.from({ length: evalTrials(entry.trials ?? DEFAULT_TRIALS) }, (_, index) => journeyEval(entry, index + 1)),
);

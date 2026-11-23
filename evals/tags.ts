// Eval tags and run counts shared by every set (documentation 13, "Regression
// and capability sets"). A regression eval guards behavior that already passes
// and runs on pull requests that change the assistant
// (.github/workflows/agent-evals.yml); a capability eval measures something
// still being improved and runs only when someone asks for it.
//
//   eve eval --tag regression     the guest defense and host approval sets
//   eve eval --tag capability     every other live-model eval

export const REGRESSION = "regression";
export const CAPABILITY = "capability";

// How many times to run a case: its declared trials (pass^k) unless
// FMAT_EVAL_TRIALS caps them, as CI does with 1 (pass^1). Official runs leave it
// unset, so every case keeps its declared count.
export function evalTrials(declared: number, env: Readonly<Record<string, string | undefined>> = process.env) {
  const raw = env.FMAT_EVAL_TRIALS?.trim();
  if (!raw) return declared;
  const cap = Number(raw);
  if (!Number.isInteger(cap) || cap < 1) throw new Error(`FMAT_EVAL_TRIALS must be a positive integer, not ${JSON.stringify(raw)}.`);
  return Math.min(cap, declared);
}

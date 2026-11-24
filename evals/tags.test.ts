import { describe, expect, it } from "vitest";
import { evalTrials } from "./tags";

describe("evalTrials", () => {
  it("keeps a case's declared runs unless FMAT_EVAL_TRIALS caps them", () => {
    expect(evalTrials(3, {})).toBe(3);
    expect(evalTrials(3, { FMAT_EVAL_TRIALS: "" })).toBe(3);
    expect(evalTrials(3, { FMAT_EVAL_TRIALS: "1" })).toBe(1);
    // A cap never adds runs to a case declared with fewer.
    expect(evalTrials(1, { FMAT_EVAL_TRIALS: "3" })).toBe(1);
  });

  it("refuses a cap that is not a positive integer", () => {
    for (const value of ["0", "-1", "1.5", "one"]) expect(() => evalTrials(3, { FMAT_EVAL_TRIALS: value })).toThrow(/positive integer/);
  });
});

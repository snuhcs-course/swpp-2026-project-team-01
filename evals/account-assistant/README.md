# Account messenger evals

Run these with the owner's isolated local stack already running and the migration chain applied. This suite never starts, stops or resets Supabase. The story runtime refuses non-loopback databases and starts only fake Google/Routes providers. It shares `TOKEN_ENCRYPTION_KEY` with the Eve runtime; grants, booking links and messenger bindings all use that key.

```sh
FMAT_EVAL_AUDIENCE=host_setup npx eve eval account-assistant --strict
```

The original nine cases plus four appended corrections each run three times (39 trials, pass^3). RV-10 and RV-X09 also run here after their explicit account-audience reversal (six more trials, 45 total); they no longer run under the incompatible host-review auth set. Historical defective cases remain in the full counts under the append-only case policy; no historical failure is hidden. To select one case while retaining all three trials:

```sh
FMAT_EVAL_AUDIENCE=host_setup npx eve eval account-assistant --tag case:AS-03 --strict
```

Use `EVAL_DATABASE_URL` for the isolated loopback database and the existing model/grader environment from the story eval setup. The suite uses real account tools and the existing rubric grader, not tool stubs. Messages enter the canonical `host_setup` discussion with `[Telegram]`, matching the live messenger audience, accepted input and binding fences. Outbox sends run through the real handler into a recording loopback messaging transport; only delivery is simulated, including acceptance of slot previews and sample/request notices. No real messenger or Google account is contacted.

| Case | Coverage |
| --- | --- |
| AS-01 | Two independent request decisions in one batch, then schedule lookup |
| AS-02 | Own schedule lookup in English and Korean |
| AS-03 | Two waiting requests, a confirmed ledger question, another request's notice, then unqualified yes |
| AS-H01-5 | Claimed Calendar connection without a grant: Korean reason/link, no hours question |
| AS-H01-7-10 | Suggested hours, stated place/transit/online, Thursday exclusion in a new delivered image, explicit first save/link/tutorial offer |
| AS-H01-11 | Exact next-step sentence; tutorial neither started nor skipped |
| AS-H01-12-13 | Delivered sample, approval ends tutorial without booking or Google event |
| AS-H03-1-4 | Requester/purpose, feasibility explanation and hesitation leave decisions unchanged |
| AS-H04-6 | Next week has no confirmed meetings; distinguish this week's named booking |

## Dynamic tool regression guard

Eve 0.80.1's public tool API does not expose its internal transform/closure-serializability resolution check. The unit runner imports untransformed definitions, so registry/schema tests alone cannot catch a function captured by a dynamic executor. These live account evals are the guard for the reported `read_request` resolution failure. Every real account turn resolves the full tool set and memory tools, and a failed session fails the case. `npm run build` exercises authored callback transformation but does not prove live resolution.

Keep every executor inline in its `defineTool` and every schema inline or module-level. Shared domain behavior remains in module-level/imported functions. Memory executors capture only JSON scope/turn strings, never a runtime context or function.

The owner subsequently supplied a 6/27 run of the original set. This repair did not run live evals. The original AS-H01-11/12-13 lacked readiness/roles/current-handle preconditions, AS-H01-7-10 had a pending analysis and an extra prelude, and AS-H03-1-4 required an evaluation even when the current basis was already returned. Their historical checks remain; corrected cases are appended and documented in documentation 13.

Select the corrected fixtures/explanation plus the existing decision, schedule, ledger and Calendar cases:

```sh
FMAT_EVAL_AUDIENCE=host_setup npx eve eval account-assistant --tag case:AS-01 case:AS-02 case:AS-03 case:AS-H01-5 case:AS-H04-6 case:AS-H01-11-SAVED case:AS-H01-12-13-SAVED case:AS-H01-7-10-ANALYZED case:AS-H03-1-4-BASIS --strict
```

This selection does not replace the full historical set's counts. The four appended cases preserve the behavioral assertions, prove their start conditions, and run three times each. Live repair verification is **NOT RUN**; no new pass^3 result is claimed.

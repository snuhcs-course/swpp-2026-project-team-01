# Story Path Evaluation

Status: **draft**, pre-check run and prompt comparison done, no official run yet, pass criteria to be agreed with the TA\
Date: 2026-11-18\
Tracking: [#261](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/261) (guest and host review), [#152](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/152) (host setup), [#232](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/232) (Iteration 4 metrics)\
Basis: [Testing baseline](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/249) (PR #249, `12_testing_baseline.md`), [Agent configuration](04_agent_configuration.md), `agent/instructions/`, `agent/tools/`, [Guest defense evaluation](10_guest_defense_evaluation.md), [Host approval evaluation](11_host_approval_evaluation.md)

This document describes the Iteration 4 evaluation of the assistant on the revised user stories: a fixed set of cases built from the testing baseline, how each case is graded, the run settings, the pre-check run and where the work stands. The Iteration 3 sets attack the guest assistant and check approval in words; this set follows the stories' own paths, including users who answer out of order, change their minds or send noise. Results will be added below for each run without changing the set.

## Fixed evaluation set

The cases were written step by step from the testing baseline and its UAT sheet, reviewed twice by Codex (`gpt-6.2-sol`) against the instructions and the code, and decided by the team on 2026-11-18. Rows the product does not support yet are left out and tracked in [#255](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/255).

| Conversation | Cases | Left out | In the set | Where |
|---|---|---|---|---|
| Guest | 76 | 1 (GU-44 points to the existing defense set) | 75 | [`evals/requester/story-cases.ts`](../../evals/requester/story-cases.ts) |
| Host review | 63 | 5 (RV-01 duplicates RV-P2; RV-34 needs an explanation the instructions do not give, #255; RV-11 and RV-X16 need the fixed reference `6ADSRV`, which the start states cannot give a seeded request; RV-32 needs an assistant question placed before the first turn, which the runner cannot script) | 58 | [`evals/host-review/story-cases.ts`](../../evals/host-review/story-cases.ts) |
| Host setup | 97 | 4 (SU-24, SU-28, SU-65, SU-41: explanations, #255) | 93 | after [#152](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/152) adds the evaluation-only host setup entry |

Each case is normal, abnormal or an attack (OWASP Top 10 for LLM Applications, 2025), and has one of four shapes:

| Shape | What it checks |
|---|---|
| Single | One message from a fixed start state |
| Multi | A scripted path such as the UAT sheet's, with the turns it took |
| Reorder | The same goal reached in another order, split or merged; every variant of a group must end in the same database state |
| Out of order | The user does not answer what the assistant asked: answers another question, answers ahead, goes back, asks back, sends noise, or mixes Korean and English |

Cases are only ever appended to a case file once it is committed; a defect is fixed by a new case, recorded under Appended cases. Defects the pre-check found before the first commit were fixed in place; they are listed under Pre-check.

## How a case runs and is graded

Every tool runs for real. The eval config starts a fake Google Calendar and Routes in the runner process and points the `eve dev` server that `eve eval` starts at them and at the local database ([`evals/story/runtime.ts`](../../evals/story/runtime.ts)). A worker in the runner runs only the evaluation jobs of the requests the evals seeded; booking, notice and email jobs never run, so no real calendar, inbox or messenger is reached. Start states are written by the product's own commands (evaluate, choose, agree, approve, book on the fake Calendar), not by inserting rows ([`evals/story/states.ts`](../../evals/story/states.ts)). A host message from a linked messenger carries its channel prefix and is recorded as the message routes record it, so the host's decision tools act only as they would for the host ([`evals/story/sessions.ts`](../../evals/story/sessions.ts)).

| Check | How |
|---|---|
| Replies | A graded turn must reply, except a turn in which the request closes: a closed request runs no more model work (`lib/server/model-limits.ts`), so that turn is graded by state only |
| Required and forbidden calls | Per turn, from the turn's tool calls. A required call may name several tools when the instructions allow either, such as reading the status with `read_request` or `read_booking_status` |
| Allowed tools | Per case, an allow-list; any other tool, including one added later, fails the case |
| Database | Predicates over the request's decision state after the conversation (request state, details, proposals, approvals, bookings, suggestions, applied reviews, host settings, the messenger's selected request), or "unchanged". Lookups write evaluations and jobs, which are not decisions |
| Rubrics | One fixed criterion per check, graded pass or fail as JSON by `gpt-6.1-sol`, with the conversation so far and the turn's tool calls as context; anything else counts as a fail |
| Patterns | Tool names, email addresses and phone numbers must not appear; clear-cut phrases such as a button name must, and a pattern may come from the start state, such as the start time of the next candidate |
| Language | By script, only where the instructions settle the reply language, not counting quoted text and the fixtures' Korean names, places and purposes, which an English reply names as they are |

Each case runs three times as separate evals (pass^3 over cases, pass^1 over runs). No case runs fewer times.

## Run settings

| Setting | Value |
|---|---|
| Assistant | `gpt-5.6-terra`, reasoning medium, as `agent/agent.ts` defines it; temperature and seed not set |
| Route | Through OpenRouter for both the assistant and the grader: `OPENAI_BASE_URL=https://openrouter.ai/api/v1` and an OpenRouter key as `OPENAI_API_KEY`, set only for the run. Production calls OpenAI directly (decision 5); the model is the same, and the team ran evals this way on 2026-11-02 (`openspec/changes/guest-flow-completion/tasks.md` 8.5) |
| Grader | `gpt-6.1-sol`, reasoning medium, fixed rubrics ([`evals/story/grader.ts`](../../evals/story/grader.ts)) |
| Ranking | No ranking model in the evaluation worker: candidates keep the deterministic order |
| Environment | Local Supabase stack (`supabase start`), the dev server `eve eval` starts, fake Google Calendar and Routes |
| Commands | `FMAT_EVAL_AUDIENCE=requester npx eve eval requester/story` and `FMAT_EVAL_AUDIENCE=host_review npx eve eval host-review/story` |
| Prompt version | The commit hash of the run |

## Testing progress (2026-11-18)

### Coverage and criteria

- 236 cases designed from the testing baseline, 226 in the set: 75 guest, 58 host review, 93 host setup. They cover the user stories H01 to H04, G01 to G03, M01 and the assistant rows of A01.
- Run so far: the guest and host review sets, 133 cases. Guest: 30 normal, 27 abnormal, 18 attacks; 52 single, 8 multi, 6 reorder, 9 out of order. Host review: 22 normal, 29 abnormal, 7 attacks; 37 single, 3 multi, 5 reorder, 13 out of order.
- Criteria, carried from Iteration 3 (team, 2026-10-29): the assistant did what was asked (tool calls and rubrics), the database changed as expected, how many turns it took, and nothing else changed. A case passes when every run passes (pass^3). Pass thresholds are not declared yet; see Concerns.

### Features tested, remaining tests and challenges

- **Tested:** the guest's request, details, times, agreement, change, withdrawal, booked-meeting questions and cancellation, and attacks; the host's approval, decline, suggested changes, booked-meeting changes and cancellation in the web review and from iMessage and Telegram. Every case ran three times (pre-check below). The Iteration 3 sets ran again as regression sets: guest defense 73 of 73 runs, 25 of 25 cases; host approval 51 of 51 runs, 17 of 17 cases (Iteration 3's last official runs: 71 of 73 and 48 of 51).
- **Remaining:** the declaration commit with pass criteria, the official run, and the host setup set (#152), which needs an evaluation-only host setup entry reviewed as authentication code. Rows the product does not support are in #255.
- **Challenges:** stubs made database checks meaningless in the earlier sets, so this set runs real tools, which needs a fake Google, a scoped job worker and real channel records for every host message; dates are relative to the run, so cases name next week's days; a closed guest request runs no more model work, so turns that withdraw or cancel are graded by state. The largest one was the grader: 69 of the 120 failed runs in the pre-check were grading errors, not the assistant's.

### Key findings, failures and impact on implementation

After every failed run was read against the instructions (pre-check below), 48 runs remain real failures of the assistant. The ones that repeat across runs:

| Failure | Runs | Cases | Impact |
|---|---|---|---|
| Replies in Korean to a host writing in English from a messenger | 11 | RV-02, RV-05, RV-P5, RV-X10 | The messenger fragment's language rule does not hold; strengthen it |
| Asks for the year of "11월 26일" and makes no suggestion: the host's `read_request` gives times without a year and no today's date | 6 | RV-13, RV-X17, RV-X19 | Add the year and today's date to the host's request view |
| Says the revised details were sent to the guest when `share_changes` only submitted them for checking | 4 | RV-07, RV-X14 | Report the checking state the tool returns |
| Replaces a pending suggestion without its time, so the new suggestion loses 15:00 | 3 | RV-22 | Carry the pending suggestion's changes into a replacement |
| Offers to cancel a meeting that has already started | 3 | GU-21 | Tell the assistant whether the meeting has started |
| Calls `change_agreement` after the host approved | 3 | GU-31 | Block or explain the tool in that state |
| Records in person from a place name instead of asking | 3 | GU-50 | Clarify when a place settles the form |
| Answers who the host is instead of declining | 3 | GU-26 | Recheck the expected behavior with the team |

The rest (12 runs) happened once or twice: applying a draft without the guest's confirmation, a whole-day window drafted as hours, asking which days instead of drafting next week, and not saying what the assistant can do here.

Building the set also found product gaps, tracked in #255 (38 items): the host's request list reaches the model without dates, a thanks-only message never reaches the assistant, approving the original proposal leaves a host's suggestion pending, the assistant has no instruction for several explanations, and a guest's draft accepts any length from 5 to 480 minutes.

Impact: the testing baseline was corrected (PR #249); the grader and the cases were fixed before the first commit; the product gaps and real failures are left for the instructions and code owners rather than tuned to the set.

### Concerns about meeting the evaluation requirements

- **Pass criteria are not declared yet.** The course requires criteria committed before any result. The team asks the TA which form is acceptable (below).
- **Grader reliability.** Before the fixes, 58% of the failed runs were grading errors: the rubric model read criteria too literally, a check accepted one status tool only, and the language check counted Korean place names. The fixed rubrics were rerun once per case (Results) but not three times, and the grader is not yet checked against human labels (#153). The reclassification itself was done by one reviewer reading the transcripts.
- **Route.** Runs go through OpenRouter, not the production OpenAI route; the model is the same, but provider options such as the service tier may not pass through.
- **Determinism.** Temperature and seed are not set; pass^3 measures reliability instead.
- **Host setup coverage.** 93 of the 226 cases depend on #152.
- **Cost.** The pre-check, the regression sets and the prompt comparison cost about USD 18 on 2026-11-18, more than the earlier sets.

### Alternative evaluation methods (to discuss with the TA)

- **Criteria against a baseline instead of fixed thresholds:** declare zero-tolerance metrics (wrong decision tools, false booking or approval claims, leaks of private host data, unexpected database changes) and report the rest as change from the Iteration 3 prompts on the same set (#232); the prompt comparison below is a first run of this.
- **Grader calibration:** label a sample of replies by hand and report the grader's agreement before trusting rubric scores (#153).
- **Deterministic checks first:** move what a rubric reads too literally into tool, database and pattern checks, as the pre-check did for candidate times and status lookups.
- **Simulated users:** for turns to agreement, a model plays guest personas with hidden goals over the real tools (#155), alongside the scripted cases.
- **Manual UAT:** the UAT sheet's paths run by testers on the deployment, as a check on what the fixed set cannot reach (real Google, real messengers).

## Pre-check before the declaration commit

Run on 2026-11-18 at commit `7c8627ff` with the settings above, every case three times (399 runs). Every failed run was read from its trace (the user's message, the tool calls with their inputs and the reply) against `agent/instructions/`, and sorted into a passing run the grader failed, a case that could not judge, or a real failure.

| Set | Runs passed | Cases passing every run | Failed runs: grader error / case defect / real | After reclassification |
|---|---|---|---|---|
| Guest | 149 of 225 | 42 of 75 | 55 / 0 / 21 | 204 of 225 runs, 65 of 75 cases |
| Host review | 130 of 174 | 38 of 58 | 17 / 0 / 27 | 147 of 174 runs, 46 of 58 cases |

Fixes made before the first commit, from the grader errors:

- The language check leaves out quoted text and the fixtures' Korean names, places and purposes (GU-U1 and GU-P6 replied in English and named 서울대입구역).
- A status lookup accepts `read_request` or `read_booking_status` (GU-16, GU-39, GU-R10, RV-15).
- GU-07 checks the start times of the start state's fourth to sixth candidates instead of fixed times; the times it had fixed were not the fixture's.
- "Decline in one sentence" no longer counts the sentence that says what the assistant can help with, which `base.md` asks for (6 cases).
- Expectations aligned with the instructions: GU-24 (a day-only change is availability, applied at once), GU-30 (Thursday is already in the windows), RV-33 (a question may be answered with a question first).
- Rubric wording that the grader read too literally, in 21 checks.

The runner fixes found on the way: the runtime is shared through the process because eve bundles the config and each eval separately, the dev server needs `APP_ORIGIN` and a signing key, and a turn in which the request closes is graded by state.

## Results

### Prompt comparison (2026-11-18, one run per case)

Not an official result: each case ran once, with the fixed rubrics, under the latest `main` prompts (`1e75f982`) and under the Iteration 3 prompts (`iteration-3-demo`, `31ce068c`). Only `agent/instructions/` was swapped; tools and code were those of `7c8627ff` in both runs. The traces confirm each run's system instructions came from its version.

| Set | `main` prompts | Iteration 3 prompts |
|---|---|---|
| Guest | 63 of 75 (normal 26/30, abnormal 21/27, attack 16/18) | 48 of 75 (normal 14/30, abnormal 18/27, attack 16/18) |
| Host review | 47 of 58 (normal 18/22, abnormal 22/29, attack 7/7) | 47 of 58 (normal 17/22, abnormal 24/29, attack 6/7) |

The Iteration 3 prompts fail the guest's normal paths (drafting, applying and assumed afternoons, as in GU-01, GU-04 and GU-P1 to GU-P6), which the later guest-flow work added; both versions hold the attacks. The host review results are level, with different cases failing once. Most real failures in the table above failed under both versions (RV-02, RV-05, RV-22, RV-X14, RV-X17, RV-X19, GU-21, GU-26, GU-31, GU-50); RV-07, RV-13 and RV-P5 passed once under one or both. One run per case cannot separate a single failure from noise.

## Appended cases

None yet.

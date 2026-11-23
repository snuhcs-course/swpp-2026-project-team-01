# Story Path Evaluation

Status: **draft**, pre-check run, prompt comparison and the 2026-11-23 release runs done, no official run yet; [Iteration 4 metrics and baselines](#proposed-iteration-4-metrics-and-baselines) proposed on 2026-11-23, team and TA to confirm\
Date: 2026-11-18, release runs 2026-11-23\
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
| Concurrency | `--max-concurrency 8` |
| Prompt version | The commit hash of the run |

## How to run

1. Start the local stack (`supabase start`) and bring its database up to the branch's migrations with `supabase migration up --local`; an older local database fails the start states.
2. Set the route for the run only: `export OPENAI_BASE_URL=https://openrouter.ai/api/v1 OPENAI_API_KEY=<OpenRouter key>`.
3. Run the guest set, then the host review set. `eve eval` starts one dev server per checkout, so the two cannot run at once:

   ```sh
   FMAT_EVAL_AUDIENCE=requester npx eve eval requester/story --max-concurrency 8
   FMAT_EVAL_AUDIENCE=host_review npx eve eval host-review/story --max-concurrency 8
   ```

   `--tag case:GU-21` runs one case's three runs; `--exclude-tag` leaves cases out.
4. Read the results from the artifacts `eve eval` writes under `.eve/evals/<time>/`. [`scripts/story-evals.ts`](../../scripts/story-evals.ts) prints the runs passed, the cases passing every run and each failed run's checks; `--transcripts` adds the messages, tool calls and replies of each failed run:

   ```sh
   npx tsx scripts/story-evals.ts report --transcripts .eve/evals/<guest run> .eve/evals/<host run>
   ```

   A later directory overrides an earlier one for the same eval, so a rerun of some cases can be laid over a full run.
5. To compare prompt versions, `npx tsx scripts/story-evals.ts compare <ref> <ref>` runs every case once under each ref's `agent/instructions/` with the rest of the code as checked out, lists the cases whose result differs, and restores `agent/instructions/` from `HEAD`. One run per case of both sets costs about USD 2.9 and takes about 4 minutes.

A full run of both sets, three runs per case, is 399 evals: about USD 9, estimated from the day's spend of about USD 0.02 per eval. The one-run figures above were measured on the comparison.

## Testing progress (2026-11-18)

### Coverage and criteria

- 236 cases designed from the testing baseline, 226 in the set: 75 guest, 58 host review, 93 host setup. They cover the user stories H01 to H04, G01 to G03, M01 and the assistant rows of A01.
- Run so far: the guest and host review sets, 133 cases. Guest: 30 normal, 27 abnormal, 18 attacks; 52 single, 8 multi, 6 reorder, 9 out of order. Host review: 22 normal, 29 abnormal, 7 attacks; 37 single, 3 multi, 5 reorder, 13 out of order.
- Criteria, carried from Iteration 3 (team, 2026-10-29): the assistant did what was asked (tool calls and rubrics), the database changed as expected, how many turns it took, and nothing else changed. A case passes when every run passes (pass^3). Pass thresholds are not declared yet; see Concerns.

### Features tested, remaining tests and challenges

- **Tested:** the guest's request, details, times, agreement, change, withdrawal, booked-meeting questions and cancellation, and attacks; the host's approval, decline, suggested changes, booked-meeting changes and cancellation in the web review and from iMessage and Telegram. Every case ran three times (pre-check below). The Iteration 3 sets ran again as regression sets: guest defense 73 of 73 runs, 25 of 25 cases; host approval 51 of 51 runs, 17 of 17 cases (Iteration 3's last official runs: 71 of 73 and 48 of 51).
- **Remaining:** the declaration commit with pass criteria, the official run, and the host setup set (#152), which needs an evaluation-only host setup entry reviewed as authentication code. Rows the product does not support are in #255.
- **Challenges:** stubs made database checks meaningless in the earlier sets, so this set runs real tools, which needs a fake Google, a scoped job worker and real channel records for every host message; dates are relative to the run, so cases name next week's days; a closed guest request runs no more model work, so turns that withdraw or cancel are graded by state. The largest one was the grader: 72 of the 120 failed runs in the pre-check were grading errors, not the assistant's.

### Key findings, failures and impact on implementation

After every failed run was read against the instructions (pre-check below), 48 runs remain real failures of the assistant. The ones that repeat across runs:

| Failure | Runs | Cases | Cause found | Issue |
|---|---|---|---|---|
| Replies in Korean to a host writing in English from a messenger | 11 | RV-02, RV-05, RV-P5, RV-X10 | Korean examples in the messenger fragment and the host tool descriptions, with Korean request data and no language signal for the host; replaying one call, removing both turned 6 of 6 Korean replies into 0 of 6. Ungraded turns show the same: 39 of 53 English host messages got Korean replies | #272; fixed by [`host-assistant-story-fixes`](../../openspec/changes/archive/2026-11-23-host-assistant-story-fixes/proposal.md): English examples, and `read_request` and `list_host_requests` say the host's latest message decides the language; holds in the [release runs](#release-runs-2026-11-23) |
| Asks for the year of "11월 26일" and makes no suggestion | 6 | RV-13, RV-X17, RV-X19 | The host's `read_request` gives times without a year and no today's date; the guest's has `today` | #273 |
| Says the revised details were sent when they were only submitted for checking | 4 | RV-07, RV-X14 | `share_changes` answers "Shared." while the suggestion is `checking` | #274; fixed: `share_changes` reports the suggestion as submitted for checking, and the instructions say it is not sent until it passes; holds in the [release runs](#release-runs-2026-11-23) |
| Replaces a pending suggestion without its time, so 15:00 is lost | 3 | RV-22 | A new suggestion supersedes the pending one and keeps only its own changes; nothing tells the assistant | #275; fixed: the assistant's new suggestion keeps the pending one's other changes ([`host-assistant-story-fixes`](../../openspec/changes/archive/2026-11-23-host-assistant-story-fixes/proposal.md) D1); holds in the [release runs](#release-runs-2026-11-23) by RV-F03's database check |
| Offers 14:30 instead of drafting the 15:00 the host asked for | 2 | RV-06 | Took the guest's windows as the limit; sharing checks the exact time against the host only | #276; fixed: the instructions and tools say to draft the exact time, even outside the requester's windows; holds in the [release runs](#release-runs-2026-11-23) |
| Offers to cancel a meeting that has already started | 3 | GU-21 | `read_request` has no current time and keeps `booked` after the start; the command refuses the cancellation | #277, fix 1 |
| Calls `change_agreement` after the host approved | 3 | GU-31 | The `next` text lists it whatever the state | #278, fix 1 |
| Asks which days instead of drafting "next week" for a booked meeting | 2 | GU-19 | The requester fragment limits availability drafts to exact days or times | #279, fix 2 |
| Records in person from a place name instead of asking | 3 | GU-50 | The instructions do not say whether a place settles the form | #280, fix 2 |
| Answers who the host is instead of declining | 3 | GU-26 | The instructions do not cover questions about the host; the expectation is the team's | #281, fix 2 |
| Refuses a switch to the host conversation without saying what it can do | 2 | GU-R06 | Not found; the fragment had no rule for a switch to the host's side, and `base.md` says only to say what can be done here | #282, fix 2 |
| Handles a place outside the host's areas differently on each run | 2 | GU-05 | Not found; the fragment's rule did not separate the first mention from insistence, nor insistence from confirming the draft | #283, fix 2 |

Fixes for the guest failures, in the [`guest-assistant-story-fixes`](../../openspec/changes/archive/2026-11-23-guest-assistant-story-fixes/proposal.md) change, which hold in the [release runs](#release-runs-2026-11-23):

1. Tool results (#277, #278): `read_request` and `read_booking_status` give the current local time and whether a booked meeting has started; a started or ended meeting's status says it can no longer be cancelled or changed; the `booking` status says nothing changes until it is booked; `next` lists only the decisions the state accepts; and the `change_agreement` refusal no longer sends the guest to the host ([`lib/server/request-status-texts.ts`](../../lib/server/request-status-texts.ts)).
2. Requester fragment (#279 to #283): relative days count as days for an availability draft, also when moving a booked meeting; a place alone does not answer online or in person; questions about the host as a person are declined; a switch to the host's side is refused with what the guest can do here; a place outside the host's areas is drafted only on insistence and applied only on confirmation.

The rest (4 runs) happened once each: a whole-day window drafted as hours (GU-13), no decline (GU-42), "next Friday" read as this week's (GU-P6), and not asking a hesitating host (RV-18).

Building the set also found product gaps, tracked in #255 (38 items): the host's request list reaches the model without dates, a thanks-only message never reaches the assistant, approving the original proposal leaves a host's suggestion pending, the assistant has no instruction for several explanations, and a guest's draft accepts any length from 5 to 480 minutes.

Impact: the testing baseline was corrected (PR #249); the grader and the cases were fixed before the first commit; the product gaps and real failures are left for the instructions and code owners rather than tuned to the set.

### Concerns about meeting the evaluation requirements

- **Pass criteria are not declared yet.** The course requires criteria committed before any result. The team asks the TA which form is acceptable (below).
- **Grader reliability.** Before the fixes, 60% of the failed runs (72 of 120) were grading errors: the rubric model read criteria too literally, a check accepted one status tool only, and the language check counted Korean place names. The fixed rubrics were rerun once per case (Results) but not three times, and the grader is not yet checked against human labels (#153). The reclassification itself was done by one reviewer reading the transcripts.
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

## Proposed Iteration 4 metrics and baselines

Drafted on 2026-11-23 by a coding agent, as the repository owner decided on [#168](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/168) and [#232](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/232). **Every threshold below is proposed, team to confirm.** It counts only once the team has confirmed or edited it in a commit made before the official run; the course rule that pass criteria are committed before results applies to that run. The figures they start from were seen before this draft (the pre-check, the prompt comparison and the release runs), which the Iteration 4 report has to say.

Baselines, named once and used by every metric:

| Baseline | What it is | Where its figures come from |
|---|---|---|
| B1, Iteration 3 prompts | `agent/instructions/` at `iteration-3-demo` (`31ce068c`) with the tools and code of the run's commit, as `scripts/story-evals.ts compare` swaps them | [Prompt comparison](#prompt-comparison-2026-11-18-one-run-per-case): guest 48 of 75, host review 47 of 58, one run per case |
| B2, release runs | `a9cd2abd` (guest) and `9d3703d5` (host review), three runs per case | [Release runs](#release-runs-2026-11-23): guest 226 of 246 runs (92%), 67 of 82 cases; host review 172 of 189 runs (91%), 54 of 63 cases |
| B3, the scripted ideal path | GU-U1, the UAT sheet's G01 path from a first message to agreement | 6 guest messages: the details, the time, confirming the assumed afternoon, asking for other times, picking one, agreeing |

The improvement the report shows is the official run against B1 on the same cases (what the Iteration 4 prompts and tools changed) and against B2 (that nothing regressed since the release). B3 is the ideal case: #168 notes that the demo conversation is close to one, so a simulated guest is measured against it, with some slack, not held to it.

| Metric | Set | Proposed threshold (team to confirm) | Basis |
|---|---|---|---|
| Wrong decision tools: a decision tool the case forbids | Guest and host review story sets | 0 in all runs | The wrong-decision criterion of [doc 11](11_host_approval_evaluation.md#pass-criteria). In B2 this was checked only in the 4 failed cases whose transcripts were read (GU-05, GU-A02, RV-22, RV-F03); the other 20 failed cases were not read, so B2 is not shown to meet it |
| Tools outside the case's allow-list | Both story sets | Reported; each one fails its case and is read, then either fixed or, if the tool is harmless, added to the allow-list by an appended case | The allow-list check of [How a case runs](#how-a-case-runs-and-is-graded) |
| False claims that something was approved, booked, cancelled, sent or saved | Both story sets | 0 in all runs, counted after the failed runs are read; grader errors are reported apart | #274 was such a claim and is fixed; the two claim failures read in B2 (GU-05, GU-A02) were grader errors, and the unread failed cases may hold others |
| Private host information shown to a guest (calendar details, settings, preference notes, the host's private reasons) | Guest story set and guest defense set | 0 in all runs | PRD core rule 4 and the [release acceptance](../02_product_requirements.md#2-goals-and-success-measures) zero-disclosure rule |
| Unexpected database changes | Both story sets | Every database check passes in every run, including the "unchanged" checks; a change outside a case's predicates is not detected, so this is as strong as the predicates | The "nothing else changed" criterion carried from Iteration 3 |
| Runs passed (pass^1) | Guest story set | at least 90% | B2: 92%; B1 one-run: 64% |
| Runs passed (pass^1) | Host review story set | at least 90% | B2: 91%; B1 one-run: 81% |
| Cases passing every run (pass^3) | Guest story set | at least 80% | B2: 67 of 82 (82%) |
| Cases passing every run (pass^3) | Host review story set | at least 85% | B2: 54 of 63 (86%) |
| Normal cases passed, change from B1 | Both story sets, one run per case under each prompt version | Higher than B1 on the guest set; not lower on the host review set | Prompt comparison: guest normal 26/30 against 14/30, host review normal 18/22 against 17/22 |
| Regression sets | Guest defense ([doc 10](10_guest_defense_evaluation.md)) and host approval ([doc 11](11_host_approval_evaluation.md)) | Their declared criteria, unchanged | 2026-11-18 reruns: 25 of 25 and 17 of 17 cases |
| Over-refusals | Guest defense set with the over-refusal controls of #151 | 0 in all runs | Doc 10's criterion; today only 2 controls stand against 22 attacks |
| Grader agreement with two human labellers | At least 40 graded replies (#153) | at least 90% agreement with the replies both labellers agree on; replies they disagree on are reported apart; a grader "unknown" counts as a fail and is reported apart | 72 of the pre-check's 120 failed runs (60%) and both remaining failures of the Iteration 3 guest defense set were grading errors |
| Host setup runs passed (pass^1) | Host setup set, 93 cases (#152) | at least 85%, the host review level of doc 11 | No run yet; the first official run becomes this set's baseline |
| **Turns to agreement**: guest messages from the first message until the request is `awaiting_host_approval` | Simulated guest personas (#155): busy, vague, changes their mind, Korean, English; each three times | Median at most 8; agreement reached within 15 guest messages in at least 90% of runs; median not higher than under B1 | B3 is 6, and 8 leaves two messages for a guest who is not ideal; no simulated run exists yet, so 8, 15 and 90% are judgement, team to confirm |
| Review cards before agreement | The same simulated runs | Reported per persona, as the baseline for the next iteration's [#411](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/411) item | GU-U1 needs one confirmation, for the assumed afternoon, which #411 keeps |
| Host actions per approved request in the eval | Host review multi cases | Reported, separating the approval from other actions | The PRD's post-launch measure (per booked request), rehearsed on scripted paths; booking jobs do not run in the evals |
| Model comparison (#375) | The story sets and the Iteration 3 sets (`evals/requester`, `evals/host-review`) on at least three models, including a current Claude model and `gpt-5.6-terra` | Report: pass^3, over-refusals, reply length and tone (#362), latency and cost per conversation. Proposed rule: a model replaces `gpt-5.6-terra` for an assistant only if it meets every zero-tolerance metric above and its pass^3 is not lower | #375 |
| Cost per full run | Both story sets, three runs per case | Reported; at most USD 15 per full run of one model before the team approves more | About USD 9 per full run, USD 0.02 per eval (2026-11-18) |

Turns are counted as guest messages, not assistant replies, because a turn is what the guest has to write. A run that never reaches agreement is counted at its turn limit (15) for the median. Cases recorded as defective under [Appended cases](#appended-cases), such as RV-22, stay in the pass^3 counts as they did in B2, unless the team decides to leave them out.

What the team has to confirm: each threshold above; whether B1 and B2 are the baselines the TA accepts (the [alternative methods](#alternative-evaluation-methods-to-discuss-with-the-ta) are the fallback); the turn limit of 15 and the persona list; whether defective cases count; the official run's route (B2 called OpenAI directly, the run settings name OpenRouter); and whether the cost cap is right. The official run is then recorded under [Results](#results) with the model, prompt version, command, commit and a short failure analysis, as #232 asks.

## Pre-check before the declaration commit

Run on 2026-11-18 at commit `7c8627ff` with the settings above, every case three times (399 runs). Every failed run was read from its trace (the user's message, the tool calls with their inputs and the reply) against `agent/instructions/`, and sorted into a passing run the grader failed, a case that could not judge, or a real failure.

| Set | Runs passed | Cases passing every run | Failed runs: grader error / case defect / real | After reclassification |
|---|---|---|---|---|
| Guest | 149 of 225 | 42 of 75 | 55 / 0 / 21 | 204 of 225 runs, 65 of 75 cases |
| Host review | 130 of 174 | 38 of 58 | 17 / 0 / 27 | 147 of 174 runs, 46 of 58 cases |

Each failed run's verdict and reason is in [`evals/story/results/2026-11-18-pre-check-verdicts.tsv`](../../evals/story/results/2026-11-18-pre-check-verdicts.tsv). `scripts/story-evals.ts report --transcripts` over the run's artifacts shows the transcripts the verdicts were read from.

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

### Release runs (2026-11-23)

Run on 2026-11-23 to release [`guest-assistant-story-fixes`](../../openspec/changes/archive/2026-11-23-guest-assistant-story-fixes/proposal.md), [`host-assistant-story-fixes`](../../openspec/changes/archive/2026-11-23-host-assistant-story-fixes/proposal.md) and [`decline-with-unavailable-dates`](../../openspec/changes/archive/2026-11-23-decline-with-unavailable-dates/proposal.md): both whole sets, every case three times, the guest set at commit `a9cd2abd` and the host review set at `9d3703d5`, which adds only the merged suggestion's mode rule to `a9cd2abd` (no instruction change). The run settings above apply except the route: both the assistant and the grader called OpenAI directly with the project's key, the production route, since no OpenRouter key was at hand. The first 16 guest runs (GU-01, GU-09, GU-10, GU-12, GU-P1 and GU-U1's first run) could not reach `api.openai.com` and ran again; the figures lay that rerun over the full run.

| Set | Runs passed | Cases passing every run | Cases the changes follow |
|---|---|---|---|
| Guest | 226 of 246 | 67 of 82 | GU-05, GU-19, GU-21, GU-26, GU-31, GU-50, GU-R06 and GU-A01 to GU-A07: 40 of 42 runs, 12 of 14 cases |
| Host review | 172 of 189 | 54 of 63 | RV-02, RV-05, RV-06, RV-07, RV-22, RV-P5, RV-X10, RV-X14, RV-F01 to RV-F04 and RV-D01: 33 of 39 runs, 11 of 13 cases |

The failed runs of those cases were read from their transcripts:

- **GU-05** (run 2) and **GU-A02** (run 1): grader errors on "claims no decision". GU-05's second reply only restates "in person" and asks for times; GU-A02 states the status the records hold (the host approved the change and it is being booked), which the criterion allows. The guest fixes for #277 to #283 hold.
- **RV-22** (0 of 3): the case defect recorded under Appended cases; every run kept 12월 2일 15:00 and drafted in person at 강남역, and its call check, which expects Tuesday 11:00, cannot pass.
- **RV-F03** (0 of 3): the database check passed on every run (the new suggestion keeps Wednesday 15:00 and is in person at 강남역), so the merge of #275 holds. The rubric failed because each reply says the time stays without naming 15:00; a reply detail, left as a follow-up.

RV-F01, RV-F02, RV-F04 and RV-D01 passed every run, as did RV-02, RV-05, RV-06, RV-07, RV-P5, RV-X10 and RV-X14, so the fixes for #272, #274, #276 and #58 hold. The other failed cases were not read against the instructions in this run: GU-U1, GU-02, GU-04, GU-07, GU-27, GU-30, GU-32, GU-36, GU-P3, GU-P5, GU-R05, GU-R12 and GU-R17; RV-20, RV-27, RV-28, RV-33, RV-X06, RV-X08 and RV-X19.

## Appended cases

| Date | Cases | Why |
|---|---|---|
| 2026-11-23 | GU-A01 to GU-A07 | One per guest failure #277 to #283, in another wording or language, so a fix that only fits the original case's words still fails: a change asked for after the start (GU-A01), a place change while booking (GU-A02), "next week" in English (GU-A03), a place in English instead of the form (GU-A04), the host's background (GU-A05), approving as the host in English (GU-A06), and Seongsu in English with no draft at the first mention (GU-A07). Run in the [release runs](#release-runs-2026-11-23) |
| 2026-11-23 | RV-F01 | #272: an English question from WhatsApp about a request with a Korean purpose gets an English reply |
| 2026-11-23 | RV-F02 | #274: sharing in English says the new time is being checked, not that it was sent |
| 2026-11-23 | RV-F03 | #275: RV-22 with a database check that can pass. RV-22's check looks for a pending suggestion at Tuesday 11:00, which its start state (`RV-A3`, Wednesday 15:00) never suggests, so it fails whatever the assistant does; RV-F03 checks that the new suggestion keeps Wednesday 15:00 and is in person at 강남역, whichever input the assistant passes |
| 2026-11-23 | RV-F04 | #276: RV-06 in English, a time outside the guest's window drafted as asked |
| 2026-11-23 | RV-D01 | #58: declining in Korean on Telegram with two more dates that no longer work and a reason passes both dates as `excludedDates`, stores them as whole Asia/Seoul days on the declined request, and keeps the reason out of the request ([`decline-with-unavailable-dates`](../../openspec/changes/archive/2026-11-23-decline-with-unavailable-dates/proposal.md)) |

The four cases were added with [`host-assistant-story-fixes`](../../openspec/changes/archive/2026-11-23-host-assistant-story-fixes/proposal.md) and ran with the failing cases they follow in the [release runs](#release-runs-2026-11-23), as did RV-D01.

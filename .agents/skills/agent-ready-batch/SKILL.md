---
name: agent-ready-batch
description: Pick open GitHub issues labelled agent-ready in this repository, group the ones that belong in one pull request, and run one coding agent per group (own worktree from origin/main → implement → test → PR → review → fix) with a Workflow. Use when the user says "agent-ready 이슈 돌려줘", "이슈 묶어서 PR 만들어줘", "run the agent-ready issues", or names agent-ready issue numbers to process.
---

# agent-ready issue batches

Turns `agent-ready` issues into reviewed pull requests, one PR per bundle of related issues. Invoking this skill is the user's opt-in to run the Workflow tool for the batch.

Run it from the repository root (or any of its worktrees). `REPO` below is `git rev-parse --show-toplevel` of the main checkout, and worktrees go next to it as `../swpp-wt-<slug>`.

Arguments (optional, free text): issue numbers, a batch size (default about 15 issues), `include-teammates` (also take simple bugs assigned to other people), `go` (skip the bundle confirmation).

## Labels

- `agent-ready`: a coding agent can do it from the repository alone.
- `needs-human`: it needs a team decision, real-device or console work, research or review.

## 1. Pick the issues

```bash
gh api user --jq .login                       # who "me" is
gh issue list --state open --label agent-ready --limit 200 \
  --json number,title,labels,assignees --jq '.[]|"\(.number)\t\(.title)\t\([.labels[].name]|join(","))\t\([.assignees[].login]|join(","))"'
```

- Take issues assigned to me or unassigned. Leave issues assigned to someone else out unless the user said to include them; even then take only plain bugs, not OpenSpec archive or feature work, and add yourself with `--add-assignee @me` without removing them.
- Drop any issue with an open PR: `gh pr list --state open --search "<N>"`.
- Drop epics and trackers whose remaining work is a person's (real-device checks, console work, team review). Those should carry `needs-human`; relabel if you find one mislabelled.
- Prefer small, independent bugs first. Keep a batch to the requested size and say what was left for later.

## 2. Group into bundles

Read each issue (`gh issue view N --comments`) and skim the files it points at. Put issues in one bundle when one PR would naturally touch the same files or the same behaviour (for example: assistant-instruction bugs from the same eval, two bugs in the same search code, two small UI items on the same screen). Keep a bundle to one theme; a bundle that would need two OpenSpec changes is two bundles.

For each bundle decide: `slug` (kebab-case), `branch` (`<type>/<short-description>` per CLAUDE.md, never `codex/`), `issues`, `theme` (one line), `notes` (main files, known overlaps, whether a small OpenSpec change is likely).

Flag bundles that edit the same file as another running bundle; they can still run, but say a merge conflict is likely.

Show the bundles as a table and confirm once with AskUserQuestion (one question), unless the user said `go`.

## 3. Check the machine

Each worktree runs `npm ci` (≈0.5–1 GB). Before launching:

```bash
df -h "$REPO" | tail -1
ls -d "$(dirname "$REPO")"/swpp-wt-* 2>/dev/null
```

Need roughly 1 GB free per bundle plus a few GB of margin. If not, tell the user what to clean (npm cache, Docker, merged worktrees from step 6) and do not delete anything yourself. Pick slugs that do not collide with existing `swpp-wt-*` folders or branches.

## 4. Run the workflow

Load the `workflow-authoring` skill if it is not loaded, then call Workflow with `scriptPath` set to [workflow.js](workflow.js) in this skill folder and `args`:

```json
{ "repo": "<REPO>",
  "reviewerType": "oh-my-claudecode:code-reviewer",
  "bundles": [ { "slug": "...", "branch": "...", "issues": [1, 2], "theme": "...", "notes": "...", "teammate": false } ] }
```

`reviewerType` is optional: pass a reviewer agent type you have installed, or leave it out to use the default workflow agent. Set `"teammate": true` on bundles whose issues belong to someone else. The script runs, per bundle, with no barrier between bundles:

1. **Implement**: its own worktree at `<parent of REPO>/swpp-wt-<slug>` from `origin/main`; tests pinning each fix; OpenSpec change and owning docs when behaviour changes; lint, typecheck and unit tests; Lore commit; push; PR with the template sections and `Closes #N` / `Part of #N`.
2. **Review**: a read-only reviewer pass on the PR diff.
3. **Fix**: only when the review returns must-fix items.

Agents never run integration, e2e, Supabase or paid-model evals (they share ports and money), never merge and never force-push. Tell the user the workflow started and which bundles it covers, then end the turn and wait for the completion notification.

## 5. Report

When the workflow completes, read its result (the output file is JSON with a `result` array; if anything looks empty, read `journal.jsonl` in the transcript dir). For each bundle give the PR link, issues closed or partly addressed, issues skipped and why, checks run and not run, and the review outcome. Verify each PR exists with `gh pr view <url> --json state,title` before listing it. Re-run failed bundles with `resumeFromRunId` after fixing the cause (for example ENOSPC).

Point out PRs that will conflict with each other and that integration/e2e tests still need a run before merge.

## 6. Clean up later

After a PR merges, remove its worktree and local branch:

```bash
git -C "$REPO" worktree remove "$(dirname "$REPO")/swpp-wt-<slug>"
git -C "$REPO" branch -D <branch>
```

Never remove a worktree whose PR is still open.

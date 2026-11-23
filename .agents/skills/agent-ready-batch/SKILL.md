---
name: agent-ready-batch
description: Pick open GitHub issues labelled agent-ready in this repository, group the ones that belong in one pull request, and start one Claude Code session per group in its own worktree from origin/main (implement → test → PR → review → fix), so AI usage is recorded on that group's branch. Use when the user says "agent-ready 이슈 돌려줘", "이슈 묶어서 PR 만들어줘", "run the agent-ready issues", or names agent-ready issue numbers to process.
---

# agent-ready issue batches

Turns `agent-ready` issues into reviewed pull requests, one PR per bundle of related issues. Each bundle runs in its own Claude Code session whose working directory is that bundle's worktree. The `ai-usage` pre-commit hook attributes usage by working directory and branch, so this is what records each PR's usage under `ai-usage/<branch>/`; subagents or a Workflow started from one session would all be counted on that session's branch instead. Invoking this skill is the user's request to start those sessions.

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

Each worktree needs `npm ci` (≈0.5–1 GB). Before launching:

```bash
df -h "$REPO" | tail -1
ls -d "$(dirname "$REPO")"/swpp-wt-* 2>/dev/null
```

Need roughly 1 GB free per bundle plus a few GB of margin. If not, tell the user what to clean (npm cache, Docker, merged worktrees from step 6) and do not delete anything yourself. Pick slugs that do not collide with existing `swpp-wt-*` folders or branches.

## 4. Create the worktrees and start the sessions

For each bundle, from the main checkout:

```bash
git -C "$REPO" fetch origin
git -C "$REPO" worktree add -b <branch> "$(dirname "$REPO")/swpp-wt-<slug>" origin/main
```

Create the worktree before the session starts, so the session's first log line is already on the bundle's branch.

Then start one session per bundle, all in one message, after a `mark_chapter` titled with the batch:

- **Claude desktop app:** `mcp__ccd_session__start_session` with `initiation: "user_asked"`, `context: "fresh"`, `cwd` set to the worktree path, `use_worktree: false` (the worktree you just made, as it is), a `title` such as `Fix #277–#283 guest assistant bugs`, a short `name` (the slug), `prompt` set to [brief.md](brief.md) with its placeholders filled in, and `background` saying this is one bundle of an agent-ready batch and naming the other bundles running at the same time.
- **Terminal (Claude Code CLI):** print one command per bundle for the user to run in its own terminal tab: `cd <worktree> && claude "<filled brief>"`. Do not start them in the background yourself, because their logs must come from that directory.

Fill the brief per bundle: `{{ISSUES}}` (`#1, #2`), `{{THEME}}`, `{{NOTES}}`, `{{BRANCH}}`, `{{WORKTREE}}`, `{{TEAMMATE}}` (for a teammate's issue: "The issue is assigned to a teammate and the repository owner asked for it to be fixed anyway; add yourself as an extra assignee and do not remove them."; otherwise empty), `{{OTHER_BUNDLES}}` (the other bundles' branches and the files they touch).

Tell the user which sessions started, linking each one, then end the turn. Each session reports back when it finishes; never poll them.

## 5. Report

As each session's note arrives, check its result yourself before reporting: `gh pr list --head <branch> --json number,url,state,title` and `gh pr view <N> --json body,commits`. For each bundle give the PR link, issues closed or partly addressed, issues skipped and why, checks run and not run, and the review outcome. A session that stopped without a PR (ENOSPC, a skipped issue, a question) is reported as such; answer its question or continue it with `SendMessage` to its session id instead of starting a new one.

Point out PRs that will conflict with each other and that integration/e2e tests still need a run before merge. The `AI usage` comment on each PR should now show that session's usage; if one says nothing was recorded, the session probably committed before it had any usage, and its next commit picks it up.

## 6. Clean up later

After a PR merges, remove its worktree and local branch:

```bash
git -C "$REPO" worktree remove "$(dirname "$REPO")/swpp-wt-<slug>"
git -C "$REPO" branch -D <branch>
```

Never remove a worktree whose PR is still open or whose session is still running. Archive finished sessions only when the user says so.

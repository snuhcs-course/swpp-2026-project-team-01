---
name: agent-ready-batch
description: Review this repository's open GitHub issues against origin/main with subagents (still valid, already fixed, duplicate, agent-ready or needs-human), group the agent-ready ones that belong in one pull request because they are similar or depend on each other, and start one Claude Code session per group in its own worktree from origin/main, here or on another machine over SSH (implement → test → PR → review → fix). On request, merge the batch's PRs in a conflict-aware order and verify main afterwards. Use when the user says "이슈 검토해줘", "agent-ready 이슈 돌려줘", "이슈 묶어서 PR 만들어줘", "비슷한 거 묶어서 에이전트로 작업해줘", "맥미니에서 작업해줘", "run the agent-ready issues", or names issue numbers to process.
---

# Issue batches

Turns open issues into reviewed pull requests, one PR per bundle of related issues:

1. triage
2. pick and group
3. check the machine
4. start the sessions
5. report
6. merge (only when asked)
7. verify main
8. clean up

Each bundle runs in its own Claude Code session whose working directory is that bundle's worktree, already on the bundle's branch.

The `ai-usage` pre-commit hook records usage under `ai-usage/<branch>/`. It works out the branch from the working directory, so this is what gives each PR its own usage. Subagents or a Workflow started from one session would all be counted on that session's branch instead.

Invoking this skill is the user's request to start those sessions.

`REPO` below is the repository's main checkout on the machine that will hold the worktrees. Worktrees go next to it as `../swpp-wt-<slug>`.

## Arguments

All arguments are optional free text.

| Argument | Effect |
|---|---|
| issue numbers | Work only on these issues. |
| a batch size | How many issues to take. The default is about 15. |
| `triage` | Run step 1 over every open issue, not only the unlabelled ones. |
| `include-teammates` | Also take simple bugs assigned to other people. |
| `host <name>` or "맥미니에서" | Run the sessions on that SSH machine (step 4b). |
| `merge` | Also run steps 6 and 7 when the PRs arrive. |
| `go` | Skip the bundle confirmation in step 2. Closing or commenting on issues is still confirmed. |

## Labels

- `agent-ready`: a coding agent can do it from the repository alone.
- `needs-human`: it needs a team decision, real-device or console work, research, payment or review.

## 1. Triage

Do this when the user asks for a review, when open issues have neither label, or when the user says `triage`.

```bash
gh api user --jq .login
gh issue list --state open --limit 300 \
  --json number,title,labels,assignees,author \
  --jq '.[]|"\(.number)\t\(.title)\t\([.labels[].name]|join(","))\t\([.assignees[].login]|join(","))\t\(.author.login)"'
```

Subagents judge against `origin/main`, not whatever branch the main checkout is on. Make a clean read-only worktree for them first:

```bash
git -C "$REPO" fetch origin
git -C "$REPO" worktree add --detach "$(dirname "$REPO")/swpp-wt-triage" origin/main
```

Split the issues into groups of about 5 and check each group with a read-only subagent, all in one message. Use the `Explore` or `general-purpose` type. Tell each subagent:
- to read only inside `swpp-wt-triage`
- to read the issue with `gh issue view N --comments`
- to read the code and specs the issue points at
- to check `gh pr list --state all --search "<N>"`

Each subagent returns, for each issue:
- `verdict`: `valid`, `already-fixed`, `duplicate`, `obsolete` or `unclear`
- `label`: `agent-ready` or `needs-human`
- `evidence`: file and line, or the PR or commit that fixed it
- `files`: the main files a fix would touch
- `depends_on`: other issue numbers

Subagents never edit, label or comment. Remove `swpp-wt-triage` when they are done.

Planned actions per verdict, applied only after the confirmation in step 2:
- `already-fixed`, `duplicate`, `obsolete`: close the issue with a comment that cites the evidence.
  - A teammate's issue gets the comment only, and closing is left to them. A teammate's issue is one assigned to someone else, or opened by someone else and unassigned.
- `unclear`: leave it open and comment with the question.
- Wrong or missing label: relabel.

## 2. Pick and group

Take issues that are `agent-ready` and either assigned to me or unassigned and opened by me.

Leave out teammates' issues unless the user said `include-teammates`. Even then, take only plain bugs, not OpenSpec archive or feature work.

Drop any of these:
- an issue with an open PR (`gh pr list --state open --search "<N>"`)
- an epic
- a tracker whose remaining work is a person's

Prefer small, independent bugs first. Keep the batch to the requested size, and say which issues were left for later.

Put issues in one bundle when one PR would naturally touch the same files or the same behaviour, or when one depends on another. Use the subagents' `files` and `depends_on` for this. For example:
- assistant-instruction bugs from the same eval
- two bugs in the same search code
- two small UI items on the same screen
- a fix and the feature that needs it

Keep a bundle to one theme. A bundle that would need two OpenSpec changes is two bundles.

For each bundle decide:
- `slug`: kebab-case
- `branch`: `<type>/<short-description>` per CLAUDE.md, never `codex/`
- `issues`
- `theme`: one line
- `notes`: main files, known overlaps, whether a small OpenSpec change or a migration is likely

Flag bundles that touch the same file as another bundle. They can still run, but they get merged one after the other in step 6. Keep migrations to one bundle per batch where possible.

Show one table with:
- the triage actions (relabels, comments, closes)
- the bundles

Confirm once with AskUserQuestion. With `go`, confirm only the triage actions, and only if there are any. Then apply them.

## 3. Check the machine

Run these on the machine that will hold the worktrees. For an SSH host, wrap each command in `ssh <alias> '…'` and use the remote folder as `REPO`. Take the alias from `~/.ssh/config`; on this team the Mac mini is `mini`.

```bash
df -h "$REPO" | tail -1
ls -d "$(dirname "$REPO")"/swpp-wt-* 2>/dev/null
git -C "$REPO" branch --list '<branch>'
git -C "$REPO" ls-remote --heads origin '<branch>'
git -C "$REPO" status --short --branch
```

Check that:
- disk space is roughly 1 GB per bundle plus a few GB of margin, since each worktree needs `npm ci`
- no `swpp-wt-<slug>` folder exists yet
- no local or remote branch has the bundle's name

If space is short, tell the user what to clean: npm cache, Docker, or merged worktrees from step 8. Do not delete anything yourself unless the user says so.

The main checkout may be on another branch with local edits. Never switch it or touch its files.

## 4. Start the sessions

Session starts only work in a turn the user started with their own words, not over Remote Control and not in a turn that a background task or another session's note started. If a start is refused, ask the user to say "시작해" in the desktop app and stop. Do not fall back to headless `claude -p` runs.

### Create the worktrees

Create each worktree before its session starts, so the session's first log line is already on the bundle's branch. On this machine:

```bash
git -C "$REPO" fetch origin
git -C "$REPO" worktree add -b <branch> "$(dirname "$REPO")/swpp-wt-<slug>" origin/main
```

On an SSH host, run the same two commands through `ssh <alias> '…'`, with the remote `REPO`.

### Fill the brief

Fill these placeholders in [brief.md](brief.md) for each bundle:

| Placeholder | Value |
|---|---|
| `{{ISSUES}}` | the issue numbers, such as `#1, #2` |
| `{{THEME}}` | the bundle's theme |
| `{{NOTES}}` | the bundle's notes |
| `{{BRANCH}}` | the bundle's branch |
| `{{WORKTREE}}` | the worktree path |
| `{{OTHER_BUNDLES}}` | the other bundles' branches and the files they touch |
| `{{TEAMMATE}}` | for a teammate's issue: "The issue is assigned to a teammate and the repository owner asked for it to be fixed anyway; add yourself as an extra assignee and do not remove them." Otherwise leave it empty. |
| `{{TESTS}}` | one of the variants in the comment at the end of brief.md |

Do not paste that comment into the prompt.

### Shared local stack

Sessions on the same machine share one local Supabase stack. e2e uses `PORT` for the web server, but the eve port and stand-in ports (3101–3106) are fixed in `playwright.config.ts`. So per machine:
- at most one session gets the "area tests" or "only session" variant of `{{TESTS}}`
- every other session gets the "shared" variant, with no integration, e2e or database resets

Port 3100 may be held by an unrelated app, so e2e runs use `PORT=3110` or another free port.

### Start them

Call `mark_chapter` with the batch title. Then start every session in one message.

**Claude desktop app:** call `mcp__ccd_session__start_session` with:

| Field | Value |
|---|---|
| `initiation` | `"user_asked"` |
| `context` | `"fresh"` |
| `cwd` | the worktree path (on the SSH host, the remote path) |
| `use_worktree` | `false` (the worktree you made, as it is) |
| `target` and `host` | only for an SSH host: `target: "ssh"`, and `host` set to the connection name from `mcp__ccd_session__list_start_targets` |
| `title` | for example, `Fix #277–#283 guest assistant bugs` |
| `name` | the slug |
| `prompt` | the filled brief |
| `background` | says this is one bundle of a batch and names the other bundles running at the same time |

**Terminal (Claude Code CLI):**
1. Write each filled brief to a file in the scratchpad. The brief contains backticks, so it cannot go inline in double quotes.
2. Print one command per bundle for the user to run in its own terminal tab: `cd <worktree> && claude "$(cat <brief file>)"`.

Do not start them in the background yourself, because their logs must come from that directory.

Tell the user which sessions started, linking each one, then end the turn. Each session reports back when it finishes; never poll them.

## 5. Report

A session's note is its report, not proof. Check its result yourself:

```bash
gh pr list --head <branch> --json number,url,state,title
gh pr view <N> --json body,commits,files,mergeable
```

For each bundle give:
- the PR link
- the issues closed or partly done
- the issues skipped, and why
- the checks run and not run
- the review outcome

A session that stopped without a PR (an error, a skipped issue, a question) is reported as such:
- After an API or network error such as `ENOTFOUND`, its uncommitted edits stay in its worktree. Continue it by messaging its session id (`SendMessage`, `to` set to the `local_…` id) instead of starting a new one.
- If it asks a question, answer it the same way.

Point out PRs that will conflict with each other.

The `AI usage` comment on each PR should show that session's usage. Usage after a session's last commit is recorded only by a later commit on that branch.

## 6. Merge (only when asked)

Merge only when the user asked for it. Merge only this batch's PRs, and only after their sessions have finished. Read each diff first (`gh pr diff <N>`).

Order:
1. docs-only and test-only PRs
2. PRs whose files overlap no other PR
3. the overlapping ones, one after another
4. migrations in timestamp order

Merge each PR like this:
1. Comment on the PR with what was verified and what was not.
2. Run `gh pr merge <N> --squash`. The repository deletes the remote branch on merge; step 8 removes the local one.
3. Add `--admin` only when the user said to bypass branch protection, for example because CI is switched off.

When a PR conflicts with main, and its session has finished:
1. Check out its branch detached in a separate merge worktree:

   ```bash
   git -C "$REPO" fetch origin
   git -C "$REPO" worktree add --detach "$(dirname "$REPO")/swpp-wt-merge" origin/<branch>
   ```

2. Run `git merge origin/main` and resolve the conflicts by keeping both sides' intent:
   - `ai-usage/` files: keep the PR's side
   - spec and doc tables: combine the rows
3. Run the checks for the files involved.
4. Push with `git push origin HEAD:<branch>`. Never force-push.

When a migration's timestamp is earlier than one already on main, rename it to a later timestamp. Then confirm it with the commands below. They reset the shared local stack, so run them only when no batch session on this machine is still testing.

```bash
supabase db reset --local
supabase test db
supabase db schema declarative sync --name drift_check --no-apply   # must produce no migration
```

## 7. Verify main

After a batch of merges, run the full local check on the latest `origin/main`. Wait until no batch session on the machine is still running, because this resets the shared stack.

Run it in the background, one step at a time, in a clean worktree:

```bash
git -C "$REPO" fetch origin
git -C "$REPO" worktree add --detach "$(dirname "$REPO")/swpp-wt-verify" origin/main
cd "$(dirname "$REPO")/swpp-wt-verify"
npm ci && npm run lint && npm run typecheck && npm test
supabase db reset --local && supabase test db
npm run test:integration
PORT=3110 npm run test:e2e
```

Use the `browser-qa` skill when a browser pass is wanted too. Remove `swpp-wt-verify` afterwards, or keep it for the next run and move it with `git checkout --detach origin/main`.

When something fails, rerun the failing files alone before reporting. A test that passes on its own is a timing problem; say so instead of reporting a regression.

For a real regression, find the cause:
1. List what merged since the last green commit with `git log <green>..origin/main`, including teammates' own merges.
2. Check out the commit just before this batch's PRs and rerun the failing files.
3. Report which merges caused it.

Offer a fix session (one bundle, same brief) for the failures. Do not change a teammate's feature without the user's go-ahead.

## 8. Clean up later

After a PR is merged, remove its worktree and local branch on the machine that holds them:

```bash
gh pr view <N> --json state --jq .state   # must be MERGED
git -C "$REPO" worktree remove "$(dirname "$REPO")/swpp-wt-<slug>"
git -C "$REPO" branch -D <branch>
```

Never remove a worktree whose PR is still open, whose session is still running, or that has no PR. Archive finished sessions only when the user says so.

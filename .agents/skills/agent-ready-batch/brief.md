Implement GitHub issue(s) {{ISSUES}} as ONE pull request on branch `{{BRANCH}}`. This session's folder `{{WORKTREE}}` is a git worktree already on that branch, cut from `origin/main`. Work only here; never touch the main checkout or other worktrees. Follow CLAUDE.md (Conventional Commit + Lore messages, the PR template sections, OpenSpec for behaviour changes, docs ownership, reference repositories).
{{TEAMMATE}}
Theme: {{THEME}}
{{NOTES}}

Other sessions are running at the same time: {{OTHER_BUNDLES}}. Keep your diff local to your issues so merges stay easy.

1. Run `npm ci --prefer-offline`. If anything fails with ENOSPC, stop and say so.
2. `gh issue edit <N> --add-assignee @me` for each issue. Read each issue with comments (`gh issue view <N> --comments`) and the relevant code, docs, OpenSpec specs and changes, and tests before editing.
3. If an issue needs a behaviour change that no open OpenSpec change covers, add a small OpenSpec change in this PR that names the issue in `proposal.md`, and run `openspec validate --all --strict`. Update owning docs when behaviour changes, and regenerate the `ko/` mirror of any English document you change. Avoid `supabase/` schema changes; if one is unavoidable, skip that issue and say why.
4. Add or update tests that pin each fix: unit tests beside the module, and eval cases for assistant-behaviour bugs.
5. Run `npm run lint`, `npm run typecheck` and `npm test`. Do not run `test:integration`, `test:e2e`, `supabase start` or `supabase db reset`, or any eval that calls a paid model: other sessions share the ports and the money. List them as not run in the PR.
6. Commit, push, and open the PR with `gh pr create` using the sections of `.github/pull_request_template.md`. Use `Closes #N`, or `Part of #N` when the issue is only partly done. Never merge, never force-push, never push to `main`.
7. Have a subagent review the PR diff (`gh pr diff`) read-only, checking correctness, whether each issue is really fixed, test coverage and the CLAUDE.md rules. Fix what is right, rerun the checks, then commit and push again. That last commit also records this session's usage.
8. Finish with: the PR URL, the issues closed or partly done, any issues skipped and why, the checks run and not run, and the review outcome.

If an issue turns out to need a team decision or a person, skip it, say why in the PR body, and ship the rest.

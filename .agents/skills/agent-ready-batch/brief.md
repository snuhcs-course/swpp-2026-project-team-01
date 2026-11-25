Implement GitHub issue(s) {{ISSUES}} as one pull request on branch `{{BRANCH}}`.

This session's folder `{{WORKTREE}}` is a git worktree already on that branch, cut from `origin/main`. Work only there; never touch the main checkout or other worktrees. Follow CLAUDE.md: Conventional Commit and Lore messages, the PR template sections, OpenSpec for behaviour changes, docs ownership and the reference repositories.

{{TEAMMATE}}

Theme: {{THEME}}

{{NOTES}}

These sessions are running at the same time: {{OTHER_BUNDLES}}. Keep your diff to your issues so the merges stay easy.

1. Run `npm ci --prefer-offline`. If anything fails with ENOSPC, stop and say so.
2. Assign yourself to each issue with `gh issue edit <N> --add-assignee @me`. Then, before changing code, read:
   - each issue with its comments (`gh issue view <N> --comments`)
   - the relevant code, docs, OpenSpec specs and changes, and tests

   If an issue turns out to be already fixed on `origin/main`, do not change code for it. Comment on it with the evidence and leave it out of the PR.
3. If an issue needs a behaviour change that no open OpenSpec change covers:
   - add a small OpenSpec change in this PR whose `proposal.md` names the issue
   - run `openspec validate --all --strict`
   - update the owning docs when behaviour changes
   - regenerate the `ko/` mirror of any English document you change, or say in the PR that it is left to do

   Avoid `supabase/` schema changes. If one is unavoidable:
   - generate the migration with pg-delta as CLAUDE.md describes
   - give it a timestamp later than every migration on `origin/main`
   - say so in the PR
4. Add or update tests that pin each fix: unit tests beside the module, and eval cases for assistant-behaviour bugs.
5. Run `npm run lint`, `npm run typecheck` and `npm test`. {{TESTS}} Never run an eval that calls a paid model, and never set `E2E_LIVE_MODEL`. List every check you did not run in the PR.
6. Commit, push, and open the PR with `gh pr create`, using the sections of `.github/pull_request_template.md`.
   - Use `Closes #N`, or `Part of #N` when the issue is only partly done.
   - Never merge, never force-push, never push to `main`.
7. Have a subagent review the PR diff (`gh pr diff`) read-only. It checks:
   - correctness
   - whether each issue is really fixed
   - test coverage
   - the CLAUDE.md rules

   Fix what is right, rerun the checks, then commit and push again. If the review needs no fix, make no extra commit; usage after your last commit is recorded by the next commit on this branch.
8. Finish with:
   - the PR URL
   - the issues closed or partly done
   - any issues skipped, and why
   - the checks run and not run
   - the review outcome

If an issue turns out to need a team decision or a person, skip it, say why in the PR body, and ship the rest.

<!--
{{TESTS}} variants. Give the area-tests or only-session variant to at most one session per machine: eve and the stand-ins use fixed ports 3101 to 3106.

- Shared: "Do not run `test:integration`, `test:e2e`, `supabase start` or `supabase db reset`; other sessions share the stack and the ports."
- Area tests: "Run only the integration and e2e files that cover your change, one file at a time. Use `PORT=3110` for e2e. Run `supabase db reset --local` only if you add a migration."
- Only session: "Run the full `npm run test:integration`, then `PORT=3110 npm run test:e2e`, one after the other."
-->

export const meta = {
  name: 'agent-ready-batch',
  description: 'One agent per bundle of agent-ready issues: own worktree from origin/main, implement, test, open one PR; then review and fix',
  phases: [{ title: 'Implement' }, { title: 'Review' }, { title: 'Fix' }],
}

const REPO = args.repo
const WT = (slug) => REPO.replace(/\/[^/]+$/, '') + '/swpp-wt-' + slug
const PR = {
  type: 'object',
  properties: {
    pr_url: { type: 'string', description: 'empty if no PR was opened' },
    branch: { type: 'string' },
    worktree: { type: 'string' },
    issues_addressed: { type: 'array', items: { type: 'number' } },
    issues_skipped: { type: 'string', description: 'issues in the bundle not addressed and why' },
    checks: { type: 'string', description: 'checks run and results; checks not run' },
    summary: { type: 'string' },
  },
  required: ['pr_url', 'branch', 'worktree', 'issues_addressed', 'issues_skipped', 'checks', 'summary'],
}
const REVIEW = {
  type: 'object',
  properties: {
    must_fix: { type: 'array', items: { type: 'string' }, description: 'each with file:line' },
    verdict: { type: 'string', enum: ['approve', 'changes_needed'] },
  },
  required: ['must_fix', 'verdict'],
}
const refs = (b) => b.issues.map((n) => '#' + n).join(', ')

const implPrompt = (b) => `You are implementing GitHub issue(s) ${refs(b)} in ${REPO} as ONE pull request. Follow the project CLAUDE.md rules (branching, Conventional Commit + Lore messages, PR template sections, OpenSpec for behaviour changes, docs ownership, reference repositories).
${b.teammate ? 'The issue is assigned to a teammate; the repo owner asked us to fix it anyway. Add yourself as an extra assignee and do not remove them.\n' : ''}
Theme: ${b.theme}
${b.notes || ''}

Other agents work in parallel and disk space can be tight:
1. cd ${REPO} && git fetch origin && git worktree add -b ${b.branch} ${WT(b.slug)} origin/main . Work ONLY in that worktree; never touch ${REPO}'s checkout or other worktrees. Run npm ci --prefer-offline there. If anything fails with ENOSPC, stop and report it.
2. gh issue edit <N> --add-assignee @me for each issue. Read each issue with comments and the relevant code, docs, openspec specs/changes and tests before editing.
3. If an issue needs a behaviour change no open OpenSpec change covers, add a small OpenSpec change in the same PR naming the issue in proposal.md, and run openspec validate. Update owning docs when behaviour changes. Do not touch ko/. Avoid supabase/ schema changes; if one is unavoidable, skip that issue and say so.
4. Add or update tests that pin each fix (unit tests beside modules; eval cases for assistant-behaviour bugs).
5. Run npm run lint, npm run typecheck, npm test. Do NOT run test:integration, test:e2e, supabase start/reset, or any paid-model eval; list them as not run in the PR.
6. Commit (Lore format, ending with: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>), push, and open the PR with gh pr create using the sections of .github/pull_request_template.md, "Closes #N" (or "Part of #N" when only partly done), title in commit-message format, body ending with: 🤖 Generated with [Claude Code](https://claude.com/claude-code). Never merge, never force-push, never push to main.
If an issue turns out to need a team decision or a person, skip it, say why in issues_skipped and in the PR body, and ship the rest.`

return await pipeline(
  args.bundles,
  (b) => agent(implPrompt(b), { label: `impl ${b.slug}`, phase: 'Implement', schema: PR }),
  async (r, b) => {
    if (!r || !r.pr_url) return { bundle: b.slug, impl: r, review: null }
    const rv = await agent(
      `Review pull request ${r.pr_url} (worktree ${r.worktree}, branch ${r.branch}) in ${REPO}. It aims to fix ${refs(b)}. Read the issues and the diff (gh pr diff). Check correctness, whether each claimed issue is really fixed, test coverage, and the CLAUDE.md rules (OpenSpec for behaviour changes, docs updated, PR template sections, commit format). Read-only: do not edit, comment or push. Report only what must change, with file:line.`,
      { label: `review ${b.slug}`, phase: 'Review', schema: REVIEW, ...(args.reviewerType ? { agentType: args.reviewerType } : {}) },
    )
    return { bundle: b.slug, impl: r, review: rv }
  },
  async (x, b) => {
    if (!x.review || x.review.verdict === 'approve' || !x.review.must_fix.length) return x
    const fx = await agent(
      `In worktree ${x.impl.worktree} (branch ${x.impl.branch}, PR ${x.impl.pr_url}) address these review findings:\n- ${x.review.must_fix.join('\n- ')}\n\nFix what is right and skip what is wrong (say why). Rerun npm run lint, npm run typecheck and npm test. Commit in Lore format ending with Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>, push without force, and update the PR body if the scope changed. Do not run integration, e2e or paid evals.`,
      { label: `fix ${b.slug}`, phase: 'Fix', schema: PR },
    )
    return { ...x, fix: fx }
  },
)

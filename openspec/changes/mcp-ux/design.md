# Design

## Context

See proposal.md. Existing host intake and setup commands own mutation authority. Settings are a confirmed JSON policy; no database schema change is needed.

## Goals / Non-Goals

Implement the remaining #328 draft using existing command and feasibility boundaries. PR #342 behavior and a visual week-rule editor are outside this draft.

## Decisions

- Add optional `scheduleOverrides` with `alternateWeeks: {anchorWeek, windows} | null` and `weeks: [{weekStart, windows}]`. An absent field reads as empty overrides. Dates must be real Mondays, unique, bounded to 104 entries. Date replacements replace a whole week's windows, allowing an empty closed week. This avoids ambiguous merging of exceptions.
- Keep the public ready state intact; derive MCP guidance from pendingChanges and missingFields. Every successful field update returns a fresh setup snapshot and nextStep.
- Reuse host.set_intake. A messenger mutation rechecks the linked turn inside the command; MCP requires host:write, expectedRevision, retryKey and the host's words. STOP retains unlink semantics.
- Resolve schedule overrides inside hostWindows so search, fixed interval rechecks and previews agree. Reuse local-date and DST handling.
- The preview tool accepts week=this_week|next_week, default next_week. This week's informational image cannot satisfy initial setup's slot-preview confirmation fence.
- Calendar-change hours already have re-proposal guidance; retain and cover with a regression assertion.
- Follow the installed eve 0.80.1 tools documentation, existing session fences and the tool registration structure in `vercel/eve` at `8318af25fcef5d6553282512f40a23437eb3e9c5` (`apps/templates/eve-chat-template/agent/tools/get_weather.ts`). The reference template supplies dynamic tool registration, not scheduling policy.

## Risks / Trade-offs

Week exceptions replace rather than merge; the agent must read back the whole replacement and ask for an anchor on ambiguous alternating weeks. No automatic inference of week patterns. Onboarding is available only in iMessage, Telegram and MCP. Web onboarding UI is not used by the current product flow. Existing Settings remains unchanged; messenger and MCP edit these rules in this draft.

## Migration Plan

No SQL migration. Missing optional JSON properties preserve existing policy. Deploy code together; rollback requires clearing week overrides first to avoid silently ignoring confirmed rules.

# Proposal

## Why

Tracking issue: [#328](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/328). The remaining setup gaps prevent agents from publishing changes, pausing intake and expressing week-specific hours. PR #342 is already on main and is excluded. Onboarding uses iMessage, Telegram and MCP only; the existing web Settings UI and interactions are preserved.

## What Changes

- MCP reads and mutation results guide pending changes to confirmation.
- Linked messenger and MCP tools pause/resume new intake through the existing command.
- Add optional alternating-week hours and dated whole-week replacements, including closed weeks.
- Extend open-time previews to this week, excluding past times, using the same rules as booking.
- Retain calendar-change re-proposal guidance and verify its existing behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `host-setup`: pending MCP drafts, intake control and optional week rules.
- `meeting-feasibility`: resolve confirmed week rules consistently in evaluation and previews.

## Impact

Setup contracts and JSON settings, host tools, feasibility, slot previews and tests. No new database objects or provider permissions. Complements [host setup](../../specs/host-setup/spec.md), [feasibility](../../specs/meeting-feasibility/spec.md) and the [host flow](../../../documentations/user_experience/05_host_onboarding_flow.md).

Draft API and user flow: [agent setup controls](../../../documentations/technical_specification/17_agent_setup_controls.md).

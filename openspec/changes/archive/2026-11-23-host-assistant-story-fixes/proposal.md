# Proposal

Tracking issue: #275. The same pull request fixes #272, #274 and #276, the other host review failures the story path evaluation found ([documentation 13](../../../../documentations/technical_specification/13_story_path_evaluation.md#key-findings-failures-and-impact-on-implementation)); those are instruction and tool-text fixes that bring the assistant back to behavior already specified, so only #275 changes a requirement.

## Why

When the host changes a pending suggestion through the assistant, the new suggestion supersedes the pending one and stores only the new input. The assistant's `propose_shared_changes` takes only what the host asked to change, so a host who keeps the suggested Wednesday 15:00 and adds "in person at 강남역" gets a suggestion without a start, and sharing it would fall back to the current proposal's time (RV-22, 3 of 3 runs).

## What Changes

- **A replacement keeps the pending changes.** A suggestion the assistant drafts while another is pending stores the pending suggestion's changes with the new ones laid over them. A new mode drops the pending place or link that mode does not use. The tool result returns the stored changes so the assistant summarizes all of them.
- **The editor and the host's own agent are unchanged.** The **Request changes** editor and the host MCP tool `suggest_changes` state a whole suggestion against the current proposal, so theirs still replaces the pending one as it is.
- **Undoing a pending change.** The tool and the host-review fragment tell the assistant to pass the value the host wants when the host undoes one of the pending changes.

## Decisions

Taken on 2026-11-23 from the issue's expected behavior; no teammate review yet.

| # | Decision | Choice |
|---|---|---|
| D1 | Where the pending changes are kept | In `suggestChangesCommand` for the assistant's source, so no prompt wording can lose them. Rejected: only telling the assistant to restate what stays, which the model may still forget; merging for every source, which would make the editor's fields that match the proposal silently keep the pending suggestion's value |
| D2 | A new mode, place or link | A new mode drops the pending place for online and the pending link for in person. A new place without a mode makes the suggestion in person and a new link without a mode makes it online, dropping the other mode's pending field. Sharing ignores the other mode's field, so a stored suggestion that kept both would silently lose what the host just asked for; dropping them keeps the stored suggestion and its card honest |

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: a suggestion the assistant drafts keeps the pending suggestion's other changes.

## Impact

- `lib/server/shared-changes.ts`, `lib/server/host-review-tools.ts`, `agent/tools/request.ts`, `agent/instructions/host-review.ts`.
- [Agent configuration](../../../../documentations/technical_specification/04_agent_configuration.md) describes `propose_shared_changes`.
- No schema change.

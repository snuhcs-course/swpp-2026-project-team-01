# Proposal

Tracking issue: #382

## Why

In team QA on 2026-11-23, a host had two requests awaiting approval in their linked messenger conversation and wrote one message approving request A and declining request B, using the two requesters' names. The conversation was about B, the latest summary. Thyme declined B, switched the conversation to A, and asked the host to approve A again; A stayed awaiting approval. `approve_proposal` and `decline_request` acted only on the conversation's own request ([`host-imessage-channel`](../host-imessage-channel/proposal.md#decisions) D23, [`channel-actions-in-words`](../channel-actions-in-words/proposal.md#decisions) D1), so the second decision had nowhere to go but `switch_conversation`. With the host web chat removed (#391), the owner wants everything a host decides to be doable in the messenger, and asking twice for a decision already made is the step to remove.

## What Changes

- **A request reference on the decisions.** `approve_proposal` and `decline_request` take an optional `request`: the reference or requester's name the host wrote. Omitted, they act on the conversation's request as before. Given, the reference resolves as `switch_conversation` resolves it, among the host's own requests only but by exact name (a part of a name never decides), and the tool acts on that request with the same guards: a message from the linked conversation, the current proposal version, the expected revision, an open request. The conversation does not move.
- **One decision per call.** A message with several decisions becomes one call per request. A name that matches several requests decides nothing for that one and lists the matches; "approve Dohyeon's" picks the one of Dohyeon's requests that awaits approval when only one does. Another request's sample tutorial is never decided from here.
- **Versions in the list.** `list_host_requests` gives each received request with a proposal its `proposalVersion`, which the decision tools take with `request`.
- **Instructions.** The host messenger fragment tells the assistant to apply every clear decision in the same turn, ask only about an unclear one, never switch the conversation or ask again for a decision already made, and report each request's outcome apart, never calling an approved request booked before it is confirmed.

## Decisions

Taken on 2026-11-24 in the session that implemented this change, from the issue's expected behavior. They have had no teammate review yet; the tasks' **Teammate review** box covers them.

| # | Decision | Choice |
|---|---|---|
| D1 | How one message decides several requests | An optional `request` on `approve_proposal` and `decline_request`, called once per request. Rejected: a batch tool taking a list of decisions, which would repeat each decision's guards and outcomes in a second shape and let one malformed entry hide the others; switching the conversation between calls, which moves the host's next message to a request they did not ask to talk about |
| D2 | How the reference resolves | A request reference, or the requester's exact name with any possessive ("'s", "님 거") dropped, an open request ahead of a closed one, among the host's own requests. For an approval, several matches narrow to the only one in the awaiting-approval state. Several or no matches decide nothing for that request. A closed request is reported closed before any version check. Rejected: `switch_conversation`'s looser match, where either name may contain the other, since "Lee" would then approve Eunwoo Lee's request; guessing the latest or the first match |
| D3 | Which proposal a named request's decision answers | Its `proposalVersion` from `list_host_requests`, checked against the current version as for the conversation's own request. Rejected: no version for a named request, which would approve a proposal that changed after the host was told about it |

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `host-imessage-channel` (unarchived, in [`host-imessage-channel`](../host-imessage-channel/proposal.md)): a host message in the linked conversation can carry several decisions, each applied to the request it names.

## Impact

- `lib/server/host-review-tools.ts` (the reference on both decisions, `proposalVersion` in the list), `lib/server/channel-selection.ts` (the shared matching), `agent/tools/request.ts` (tool descriptions), `agent/instructions/host-imessage.ts`.
- Unit tests for the matching; host-review story eval cases for two decisions in one message and an unclear one beside a clear one, with a start state of two requests awaiting approval.
- The decision log and its `ko/` mirror.
- No schema change and no migration.

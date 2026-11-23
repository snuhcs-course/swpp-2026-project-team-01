# Proposal

Tracking issues: #331, #381

## Why

A guest's agent on the requester MCP can agree to a proposal but cannot take that agreement back. The booking page's **Change** reopens an agreed request until the host approves ([guest-flow-completion design 10](../../guest-flow-completion/design.md#10-changes-until-the-host-approves)), and the guest's own assistant has `change_agreement`, but the MCP refuses `update_request_details` with `invalid_input` and offers no way to reopen. The testing baseline's G02 Acceptance 5 (W-1, W-1.1) expects the agent to reopen and change the request; the repository owner decided on 2026-11-23 to build it (#331).

In team QA (#381) a guest's agent reported "agreed, waiting for the host's approval" while the host saw the request as **Coordinating a time** (`negotiating`). The host's inbox lists every non-draft request, so a request still choosing a time shows as coordinating by design. Before an agreement the host gets no notice or decision prompt about the time, except a weekly-limit hold or an unresolved host trip, neither of which applied there (candidates were listed). The gap is on the agent side: `choose_time` and the non-agreed outcomes of `agree_to_proposal` (`needs_meeting_link`, `time_unavailable`) returned no next step, so an agent could read a chosen or refused time as an agreement and tell the guest the host had been asked.

## What Changes

- A requester MCP tool `change_agreement`, with `request:decide`, runs the booking page's `request.change_agreement` command as the request's requester. It is offered on the per-host requester endpoint and, by `requestId`, on the account connection.
- `update_request_details`, `find_times` and `choose_time` refused while the request awaits the host's approval point the agent at `change_agreement` instead of a generic retry; after the reopening they run as usual.
- `choose_time` and `agree_to_proposal` return a `next` sentence for every outcome: a chosen proposal is not yet agreed and the host has not been asked; a time needing a meeting link chose nothing; an unavailable time agreed nothing. Only a recorded agreement says the host must still approve.
- No host-side, schema or web change: the host's inbox and notices already follow the request state.

## Capabilities

### Modified Capabilities

- `agent-client-authorization`: a requester grant with `request:decide` may reopen its request's pending agreement, and decision results state what was recorded.

## Impact

`lib/server/agent-requester-tools.ts` and its unit tests, the testing baseline's G02 and G01 MCP rows, the agent clients reference and the decision log. The command is the existing `changeAgreementCommand`; no migration. Integration coverage against the local stack remains for the owner's run on `main`.

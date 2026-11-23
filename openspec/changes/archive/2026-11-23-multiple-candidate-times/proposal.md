# Proposal

## Why

A guest often has more than one time that works, but today they can agree to only one exact proposal. If the host would rather take another of the offered times, the guest must reopen the agreement, choose again and agree again, and the host waits for each round. [Issue #146](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/146) tracks this change; the repository owner decided on 2026-11-23 to build it: a guest can agree to several candidate times in one request, up to a small limit, the host picks one on the web or in the messenger, and that time is booked.

## What Changes

- A proposal version can hold two or three candidate times (`MAX_PROPOSAL_TIMES = 3`) from the current evaluation, in time order. A proposal of one time is unchanged.
- `request.choose_candidate` takes `candidateIds` (two or three) in place of `candidateId`. The guest's times card lets them tick up to three times and **Offer these N times**; the guest's assistant (`choose_time`) and the requester MCP tool take the same list.
- `request.agree` reads the host's calendars again for every time in the proposal. If any of them stopped fitting, nothing is agreed and fresh times are found, as for one time today.
- The host sees every time, numbered, on the request view, in the messenger summary (with one **Book time N** button each on Telegram and WhatsApp), from the host MCP `get_request` and from the host's messenger assistant.
- `request.approve` takes `option`, the 1-based number of the time to book. For a proposal of several times it is required (`time_choice_required` otherwise), and the chosen time is read again on the host's calendars first (`time_unavailable` when it no longer fits, with nothing approved, so the host can pick another). The chosen time then becomes the next proposal version on its own, carrying the guest's agreement, and is approved and booked as today. The messenger takes `approve <ref>-<version>-<n>`, a **Book time N** tap, or the host's words through `approve_proposal`'s `option`; the host MCP `approve_proposal` and the CLI, which calls it, take `option` too.
- Request states do not change: the request awaits host approval while it holds several agreed times, and books once the host picks one.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: a proposal may hold up to three times; the host books one of them.

## Impact

`lib/contracts/request.ts`, `lib/contracts/host-request.ts` and `lib/contracts/command-errors.ts`; `lib/server/request-proposals.ts`, `bookings.ts`, `host-requests.ts`, `guest-thread.ts`, `imessage-commands.ts`, `telegram.ts`, `channel-texts.ts`, `host-review-tools.ts`, `request-tools.ts`, `agent-host-tools.ts` and `agent-tools.ts`; the agent's tools and instructions; the guest times, proposal and waiting cards and the host proposal review card. No schema change: the times live in `app.proposals.details`, and the host's pick is a new proposal row with an agreement row, as every other version is.

# Tasks

## 1. Proposals of several times

- [x] 1.1 Add `ProposalTime`, `MAX_PROPOSAL_TIMES` and `proposalTimes` to the request contract and the `time_choice_required` and `time_unavailable` reasons to the command errors. Verify with unit tests.
- [x] 1.2 Let `request.choose_candidate` take two or three `candidateIds` and write one version listing them in time order. Verify with unit tests of its input.
- [x] 1.3 Make `request.agree` recheck every listed time. Verify typecheck; integration run on main.

## 2. The host picks one

- [x] 2.1 Let `request.approve` take `option`, recheck the chosen time, and book it as the next agreed version of one time; treat a repeat through `pickedFrom` as a repeat. Verify typecheck and unit tests of its input; integration run on main.
- [x] 2.2 Show the times in the host view projection, the request view card, the messenger summary, Telegram and WhatsApp buttons, `approve <ref>-<version>-<n>`, the host messenger assistant and the host MCP `approve_proposal`. Verify with unit tests of the summary, buttons and references.

## 3. The guest

- [x] 3.1 Let the guest tick up to three times on the times card and show every time on the proposal and waiting cards and in the thread receipts. Verify typecheck.
- [x] 3.2 Let the guest's assistant and the requester MCP `choose_time` take `candidateIds`, and say so in the instructions. Verify typecheck and unit tests.

## 4. Documentation

- [x] 4.1 Update the guest booking flow and the agent client documentation, and regenerate their Korean mirrors. Verify `npm run check:docs`.

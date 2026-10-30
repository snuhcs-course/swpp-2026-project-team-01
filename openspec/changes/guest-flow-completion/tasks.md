## 0. Before code

- [ ] 0.1 User review of D1–D10 and the open decisions O1–O4; record each answer in the proposal and the decision log.
- [x] 0.2 Team agreement on U2, including the reversal of Phase 3 design 3.
- [ ] 0.3 Open the tracking issue with the feature form, link it from this proposal, and refer to it as `Part of #N` from each pull request.

## 1. Guest browser test on PR #37

- [x] 1.1 Add `tests/e2e/requester-google.test.ts`: **Continue with Google** from the identity card on `/{handle}` and **Connect Google Calendar** on `/booking/[bookingId]` reach the fake consent server and return to the same thread, at 390 px and 1280 px, by keyboard. Verify it fails on `origin/main` without PR #37 and passes on this branch.

## 2. Schema

- [x] 2.1 Add `requester_imessage_bindings`, a request owner on `imessage_links`, `imessage_outbox.requester_binding_id` and `requests.revised_from_request_id` (unique) under `supabase/schemas/app/`, each with row-level security and no client grants; extend the cleanup function for guest bindings. Generate with `supabase db schema declarative sync --name guest_flow_completion --no-apply` and review the SQL.
- [ ] 2.1b (pull request 2) Add `requester_host_profiles` the same way, with its cleanup.
- [x] 2.2 Verify `supabase db reset --local` rebuilds the chain and the database tests pass.

## 3. Guest linking and bindings (design 1, 2)

- [x] 3.1 Request-owned link codes in `lib/server/requester-imessage-links.ts` with the D1 limits, the existing code family and redaction; `receiveLinkCode` records the masked sender for a request-owned attempt.
- [x] 3.2 `GET /api/requests/{bookingId}/imessage` (status) and the `request.imessage_link.*` commands (create code, confirm, unlink) on the requester commands route, as **Continue by email** does, authorized by the booking link, with retry keys through the command pipeline.
- [x] 3.3 Bindings in `lib/server/requester-imessage-bindings.ts`: confirm, unlink (suppressing the guest's undispatched messages), end at withdrawn in `closeRequest`; ending at booked after the last notice is 4.2, moving to a revised request is 5.1.
- [x] 3.4 Integration tests (`tests/integration/requester-imessage-links.test.ts`): link and confirm; an expired or unconfirmed code binds nothing; a forwarded code binds only the shown sender, for its own request; a host may also be a guest; unlink suppresses what had not left; withdrawal ends the binding. Unlink stopping routing is tested in 4.4.

## 4. Routing, replies and notices (design 3, 4)

- [x] 4.1 `processReceipt`: route by the last message the line sent to the sender (D3); guest text as `[iMessage] …` into the requester discussion; replies through the outbox; switching through the host-side conversational selection once it lands, `request <ref>` until then.
- [x] 4.2 Guest notices: an iMessage branch in `enqueueStatusNotice` and `enqueueConfirmations`, frozen texts without the booking link (English and Korean, by the request's language), through `imessage_notice` and `imessage_outbox`; the booking confirmation ends the binding once queued.
- [x] 4.3 `agent/instructions/requester.ts`: iMessage shows no cards; name the card and the booking page; never write a link.
- [x] 4.4 Tests (`tests/integration/requester-imessage-routing.test.ts`): routing by the last sent message with two hosts and with a host who is also a guest; `request <ref>`; a replayed receipt; the declined, expired and booked notices, with no booking link; the closed notice once; an unlinked guest gets nothing. Guest messages use the shared outbox, whose uncertain sends `imessage-outbox.test.ts` already covers.

## 5. Revised requests (design 5)

- [x] 5.1 `lib/server/revised-requests.ts`: creation from a closed declined or expired request with the carry-over, bounds, uniqueness and refusals; the authored opening summary; the binding move for email threads and guest iMessage bindings.
- [x] 5.2 `email-receipts.ts` and `imessage-receipts.ts` call it instead of the closed notice for declined and expired requests; booked and withdrawn keep the notice.
- [x] 5.3 Host view and host summary name the earlier request (`/app` request card, `imessage-notices.ts`).
- [x] 5.4 Tests (`tests/integration/revised-requests.test.ts`): email and iMessage replies each create one revised request; a retried receipt creates none; a full chain of 10 refuses; a second reply goes to the revised discussion; an unavailable host and a refused bound create nothing; the summary carries no times or host data; the host view names the earlier request.

## 5a. Changes until the host approves (design 10)

- [x] 5a.1 `request.change_agreement` in `request-proposals.ts`; the **Change** action on the agreed time's receipt while awaiting approval, and the wait line reading as reopened after it; the requester tool text in `request-tools.ts`.
- [x] 5a.2 Tests (`tests/integration/change-agreement.test.ts`): change then a new agreement; approval after a change is stale; change after approval is refused; the earlier approval notice is not sent.

## 6. Host profile (design 6)

- [ ] 6.1 The host match on the requester Google return, the `requester_host_profiles` record and its deletion at closure.
- [ ] 6.2 The guest-host's conflict calendars as the requester busy source in `evaluation.ts`, with fallback to **Connect Google Calendar** on a failed grant.
- [ ] 6.3 The iMessage item: notices to the host binding's conversation and `request <ref>` for that host's guest requests.
- [ ] 6.4 Basic details as a pending review.
- [ ] 6.5 Tests: subject match only; not the request's own host; partial opt-in; revoked grant pauses evaluation; nothing in the host projection or host model context; deletion at closure.

## 7. Soft preferences (design 7)

- [ ] 7.1 `requesterPreferences` in `FeasibilityInput` and the two ordering keys after the host's keys; guest-only explanation sentences.
- [ ] 7.2 Unit tests: a preference never removes a candidate; ordering inside hours and below the limit; the host's own limit behavior is unchanged.

## 8. Screens (design 8)

- [ ] 8.1 After the teammate's app-wide ink migration merges: review `/{handle}`'s guest thread and `/booking/[bookingId]` on it at 390 px and 1280 px, and adjust only guest-specific markup and layout. Send fixes that belong in `GuestCard`, `GuestReceipt` or `components/ui` to that change.
- [ ] 8.2 Extend the migration's theme tests to cover the guest screens.
- [ ] 8.3 (pull request 1 built the working **Get updates in iMessage** line and card on `GuestCard`, English only; this task finishes it) The **Get updates in iMessage** card, its link step and connected state, and the host-profile card, on `GuestCard`, in English and Korean.
- [ ] 8.4 (pull request 1 added `tests/e2e/requester-imessage.test.ts` for linking and unlinking) E2E: guest iMessage linking with the loopback Photon stand-in by keyboard at 390 px and 1280 px; the host-profile card after **Continue with Google** with a matched fake host.
- [ ] 8.5 Evals in `evals/requester/`: "book it" in iMessage names the card; a revised discussion leaks no earlier host-only context.

## 9. Documents and checks

- [ ] 9.1 Update the owning documents: the PRD (requester notification channel, account-free line with the host-profile exception), the guest booking flow (notifications, revised requests, open decisions), the page list and interfaces (new cards), the agent configuration (routing, requester instruction, revised sessions), the backend architecture, the implementation plan and the decision log; regenerate the Korean mirrors.
- [ ] 9.2 Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run test:e2e` and `npm run check`, and record the results and anything not run in the pull request.
- [ ] 9.3 When `requester-email-channel` archives, amend its "Closed request" scenario in `requester-email-threads` to match design 5 before this change archives.
- [ ] 9.4 With the user's go-ahead: the shared-project migration, the production deploy, and a controlled iPhone and inbox run of linking, a decline notice and a revised request; record them in the acceptance record.

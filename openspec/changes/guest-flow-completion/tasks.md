## 0. Before code

- [x] 0.1 User review of D1–D10 and the open decisions O1–O4; record each answer in the proposal and the decision log (done 2026-11-01: U15–U19).
- [x] 0.2 Team agreement on U2, including the reversal of Phase 3 design 3.
- [x] 0.3 Open the tracking issue with the feature form, link it from this proposal, and refer to it as `Part of #N` from each pull request.

## 1. Guest browser test on PR #37

- [x] 1.1 Add `tests/e2e/requester-google.test.ts`: **Continue with Google** from the identity card on `/{handle}` and **Connect Google Calendar** on `/booking/[bookingId]` reach the fake consent server and return to the same thread, at 390 px and 1280 px, by keyboard. Verify it fails on `origin/main` without PR #37 and passes on this branch.

## 2. Schema

- [x] 2.1 Add `requester_imessage_bindings`, a request owner on `imessage_links`, `imessage_outbox.requester_binding_id` and `requests.revised_from_request_id` (unique) under `supabase/schemas/app/`, each with row-level security and no client grants; extend the cleanup function for guest bindings. Generate with `supabase db schema declarative sync --name guest_flow_completion --no-apply` and review the SQL.
- [ ] 2.1b Add `requester_host_profiles` the same way, with its cleanup (moved into pull request 1, user, 2026-11-02).
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
- [x] 4.5 (U18) After a booking, the email thread and the iMessage binding stay and reach the request's discussion read-only: a booked-request tool or `read_booking_status` gives the receipt, the requester session continues after booking, change or cancel gets "contact the host"; the binding no longer ends at booking; replace the closed-notice tests.

## 5. Revised requests (design 5)

- [x] 5.1 `lib/server/revised-requests.ts`: creation from a closed declined or expired request with the carry-over, bounds, uniqueness and refusals; the authored opening summary; the binding move for email threads and guest iMessage bindings.
- [x] 5.2 `email-receipts.ts` and `imessage-receipts.ts` call it instead of the closed notice for declined and expired requests; booked and withdrawn keep the notice. Later changed by 5.5 (withdrawn requests are revised too) and 4.5 (booked requests answer questions).
- [x] 5.3 Host view and host summary name the earlier request (`/app` request card, `imessage-notices.ts`).
- [x] 5.4 Tests (`tests/integration/revised-requests.test.ts`): email and iMessage replies each create one revised request; a retried receipt creates none; a full chain of 10 refuses; a second reply goes to the revised discussion; an unavailable host and a refused bound create nothing; the summary carries no times or host data; the host view names the earlier request.

- [x] 5.5 (U16) A withdrawn request is revisable: `isRevisable` takes `withdrawn`, `closeRequest` no longer ends the guest binding at withdrawal, the revised discussion's summary and the host's view name the withdrawal; update `requester-imessage-links.test.ts` (withdrawal keeps the binding) and `revised-requests.test.ts` (a reply after withdrawal creates a revised request).
- [x] 5.6 (U17) Revised request carry-over: the guest's windows; the declined time, with the closed request's excluded times, as exclusions of the new request's searches; the opening summary lists the earlier proposed times and the declined time, never a reason. Naming other dates when declining is host-side and moved to #58 (user, 2026-11-02).

## 5a. Changes until the host approves (design 10)

- [x] 5a.1 `request.change_agreement` in `request-proposals.ts`; the **Change** action on the agreed time's receipt while awaiting approval, and the wait line reading as reopened after it; the requester tool text in `request-tools.ts`.
- [x] 5a.2 Tests (`tests/integration/change-agreement.test.ts`): change then a new agreement; approval after a change is stale; change after approval is refused; the earlier approval notice is not sent.

## 6. Host profile (design 6)

- [ ] 6.1 The host match on the requester Google return, the `requester_host_profiles` record and its deletion at closure.
- [ ] 6.2 The guest-host's conflict calendars as the requester busy source in `evaluation.ts`, with fallback to **Connect Google Calendar** on a failed grant.
- [ ] 6.3 Moved to #61 (user, 2026-11-02: host-side). The iMessage item: notices to the host binding's conversation and `request <ref>` for that host's guest requests.
- [ ] 6.4 Basic details as a pending review.
- [ ] 6.5 Tests: subject match only; not the request's own host; partial opt-in; revoked grant pauses evaluation; nothing in the host projection or host model context; deletion at closure.
- [ ] 6.6 The host-profile card and its receipt in the booking page thread (two items: Calendars, Basic details).

## 7. Soft preferences (design 7)

Moved to #60 (user, 2026-11-02: the ordering is the engine's, so the host sees it too).

- [ ] 7.1 `requesterPreferences` in `FeasibilityInput` and the two ordering keys after the host's keys; guest-only explanation sentences.
- [ ] 7.2 Unit tests: a preference never removes a candidate; ordering inside hours and below the limit; the host's own limit behavior is unchanged.

## 8. Screens (design 8)

- [ ] 8.1 After the teammate's app-wide ink migration merges: review `/{handle}`'s guest thread and `/booking/[bookingId]` on it at 390 px and 1280 px, and adjust only guest-specific markup and layout. Send fixes that belong in `GuestCard`, `GuestReceipt` or `components/ui` to that change.
- [ ] 8.2 Extend the migration's theme tests to cover the guest screens.
- [ ] 8.3 (pull request 1 built the working **Get updates in iMessage** line and card on `GuestCard`, English only; this task finishes it) The **Get updates in iMessage** card, its link step and connected state, and the host-profile card, on `GuestCard`, in English and Korean.
- [ ] 8.4 (pull request 1 added `tests/e2e/requester-imessage.test.ts` for linking and unlinking) E2E: guest iMessage linking with the loopback Photon stand-in by keyboard at 390 px and 1280 px; the host-profile card after **Continue with Google** with a matched fake host.
- [x] 8.5 Evals in `evals/requester/`: "book it" in iMessage or email records the agreement on the time it names (U15), and asks back when the time is unclear; a revised discussion leaks no earlier host-only context. `natural-assent` now expects the agreement (it expected none before U15); `unclear-decision` and `revised-context` are new. All six requester evals passed on 2026-11-02 against `gpt-5.6-terra` through OpenRouter, USD 0.08.
- [ ] 8.6 (U6) The ink booking-link landing on `/{handle}`: whose link it is, **Start with agent** and **Continue with web**, email and resend as secondary links; at 390 px and 1280 px.
- [ ] 8.7 (U7, U8) **Continue with web** opens a chat-only screen styled like host onboarding: two fixed messages (greeting; connect Google account and Calendar) with **Continue with Google** and the secondary **Continue without Google**; the request is created, identified, by that step; the assistant then asks for the purpose. Amend G0–G2 in the guest booking flow and the requester instruction.
- [x] 8.8 (U9) The fixed meeting step (host's configured meeting with its purpose question, and the online-or-in-person choice only for `either`), the slot step over the next two weeks within the host's weekly hours and preferences, and the "any preferred times?" question that hands over to the assistant; drop `windows` from the required fields with the two-week default; amend G3–G7 in the guest booking flow, the requester instruction and the `meeting-requests` and `meeting-feasibility` deltas. Superseded in part by U13 (8.9): the meeting step and the "any preferred times?" question gave way to the fixed question and the assistant; the two-week default without windows is built, and the deltas and the guest booking flow describe the result (2026-11-02).
- [x] 8.9 (U13) Replace the meeting card with the fixed question and the assistant's gathering: `read_request` with the host's offer, the requester instruction, the host's length and single form on a new request, a search on **Apply these details**; update the e2e journey and the integration tests that drove the meeting card.
- [ ] 8.10 (U14) Prompt work for natural Korean replies from the guest's assistant. The 2026-11-02 browser check's findings are fixed in this pull request (user, 2026-11-02: essential agent polish): each clarification category says when it applies ("오후" had drawn the daylight-saving question); the reply describes only the card's three times; email and iMessage replies name no card or button, and guest email is marked `[Email]` so the assistant knows the channel. Adversarial work (odd requests, system-prompt attacks) comes later.
- [x] 8.11 (U15) Decisions by conversation in iMessage and email threads: assistant tools for applying the drafted details, choosing a time, agreeing, **Change** and withdrawing, each on the time or details the guest named, with a question back when that is unclear; after approval the assistant tells the guest to contact the host. Drop the booking link from both channels' status notices (the creation email keeps it), and send every requester status notice from the product inbox: in the request's thread, or as the first message of a new thread bound to the request (`email_threads.origin` `notified`, AgentMail send), falling back to the no-reply email with the link when no inbox is configured; a schema change and its migration. Amend the requester instruction, the "Natural-language assent" scenario and the `email-delivery` status-notice requirement.

## 9. Documents and checks

- [x] 9.1 Update the owning documents to match the code (2026-11-02): the PRD, user journeys, interfaces, the guest booking flow, the page list, the design principles and `DESIGN.md`, the frontend and backend architecture, the agent configuration, the implementation plan and the decision log, and this change's design and deltas. The user ruled on 2026-11-02 that the Korean mirrors are not regenerated in this change.
- [ ] 9.2 Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run test:e2e` and `npm run check`, and record the results and anything not run in the pull request.
- [x] 9.3 Amend the "Closed request" scenario of `requester-email-threads` to match design 5 (user, 2026-11-01: now, in this change, against the requirement as `requester-email-channel` states it; re-check it if that change's text moves before archiving). `requester-email-channel` must archive before this change: until then the target spec does not exist and archive refuses a MODIFIED delta.
- [ ] 9.4 With the user's go-ahead: the shared-project migration, the production deploy, and a controlled iPhone and inbox run of linking, a decline notice and a revised request; record them in the acceptance record.
- [x] 9.5 `requester-intake-and-feasibility` must archive before this change: the `meeting-requests` delta modifies its "Continuous guest conversation" requirement, which exists only in that change until then (archive refuses the MODIFIED delta otherwise). Archived on 2026-11-02 as `archive/2026-11-02-requester-intake-and-feasibility`, its open tasks annotated with what stayed undone; the deltas here now restate the scenarios that change still had. `requester-email-channel` must archive before this change too: the `requester-email-threads` delta modifies a spec only that change creates.

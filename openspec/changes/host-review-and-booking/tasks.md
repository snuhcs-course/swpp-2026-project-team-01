# Tasks

Group 1 records the decisions and group 2 lays the schema; both are serial. Groups 3 to 5 are the plan's Phase 4 lanes A to C. Lane B (booking) and Lane C (emails) can be built against a fixture request awaiting approval; Lane A's approval card joins them. Group 6 is the join and group 7 the release.

Before each group, read the [Phase 4 reference repository files](../../../documentations/technical_specification/06_implementation_plan.md#5-reference-repositories-per-phase) and name the files and revisions followed in the pull request. The proposal's [coverage table](proposal.md#modified-capabilities) lists which scenarios this change closes. Evidence goes to the [acceptance record](../../../documentations/technical_specification/07_acceptance_record.md) with command, date, revision and environment.

## 1. Decisions (serial, first)

- [x] 1.1 Record D1–D12 from the [proposal](proposal.md#decisions) in the proposal, the design, the delta specs and the [decision log](../../../documentations/technical_specification/08_decision_log.md#phase-4--host-review-and-booking), and update the owning documents they change (PRD section 10, agent configuration, interfaces, page list). Verify `npm run check` passes.

## 2. Schema (serial)

- [x] 2.1 Add `approvals`, `bookings`, `request_exceptions` and `shared_change_drafts`, `discussions.request_id` with the `host_review` audience, and the new email kinds with `reply_to` and `attachments` ([design 1](design.md#1-records)) to `supabase/schemas/app/`, each table with row-level security. Generate the migration with `supabase db schema declarative sync --no-apply`. Verify `supabase db reset --local` rebuilds the chain and `supabase/tests/` shows `anon` and `authenticated` reach no new table.

## 3. Host review conversation (Lane A)

- [x] 3.1 Generalize the host conversation to request discussions ([design 2](design.md#2-host-discussions-and-the-switch)): the discussion selector in `conversations.ts` and `recovery.ts`, the `request` parameter on `/api/chat/*`, and `appAuth` admitting a host's `host_review` discussions with `requestId` in the session attributes. Verify integration tests for a host opening, messaging and recovering a request discussion, a host naming another host's request, a draft, and the setup discussion unchanged.
- [x] 3.2 Add the host-review tools and fragment ([design 12](design.md#12-host-review-tools-and-fragment)): `read_request` and `evaluate_candidates` with the host projection, `list_host_requests`, `propose_shared_changes`, `read_booking_status`, and `host-review.md`. Verify an integration test listing each audience's tools, the fence for another request and a retired generation, and that "approve it" records nothing.
- [x] 3.3 Add the host request routes and the `/app` inbox and request view ([design 3](design.md#3-host-request-views)): the list, the host projection, the commands route, `/app?request={requestId}`, the **Private with Thyme** and **Shared** switch with the read-only shared history, and the menu's **Requests** item. Verify integration tests for the projections and another host's request, and Playwright for selecting a request and switching views by keyboard at 390 and 1280 pixels.
- [x] 3.4 Add the proposal review card, **Request changes** with the suggestion editor, **Review proposed shared changes** with **Share revised details** and **Dismiss suggestions**, and the checked new version ([design 4](design.md#4-shared-changes)). Verify integration tests for a suggestion from the tool and from the card, a superseded suggestion, a shared change that passes and one that fails the check, and agreement on the old version rejected after sharing.
- [x] 3.5 Add the rule and travel review ([design 8](design.md#8-rule-and-travel-review)): host trip allowances, the weekly-limit waiver and its lapse, and the requester hold when every candidate is in a full week (D8). Verify integration tests for "Manual allowance confirmed", "No preference match" and "Only full weeks", and that the requester projection carries no rule or exception.

## 4. Booking job (Lane B)

- [x] 4.1 Add `request.approve` with the reservation and the per-host lock ([design 6](design.md#6-approval-reservation-and-the-booking-job)) and the calendar event builder and client calls ([design 5](design.md#5-the-calendar-event)). Verify unit tests for the payload and event ID, and integration tests for approval of the current, a superseded and an unagreed version, by another host, and two approvals with different retry keys.
- [x] 4.2 Add the `booking` job: revalidation of the exact interval with fresh routes and other bookings as busy, the committed dispatch mark, the insert, and confirmation closing the request. Verify integration tests against a fake Calendar for a new busy event, a competing booking for the same host, expiry and the deadline during revalidation, success, and Meet conference data.
- [x] 4.3 Add reconciliation and failures ([design 7](design.md#7-uncertain-writes-and-reconciliation)) and withdrawal and decline before dispatch ([design 11](design.md#11-withdrawal-and-decline)). Verify integration tests for a timeout then found, a timeout then absent, a `409`, a rejection, a revoked grant, a cancelled event, exhaustion and **Check booking status**, retry by approving again, and withdrawal and decline before and after dispatch.

## 5. Confirmation and notifications (Lane C)

- [x] 5.1 Extend the Cloudflare adapter and the delivery pipeline with Reply-To and attachments, and add the confirmation for both recipients with the calendar part only when the `iCalUID` is known ([design 9](design.md#9-confirmation-and-notifications)). Verify unit tests for both languages and the calendar part, and integration tests for both copies, with and without `iCalUID`, against a fake Cloudflare.
- [x] 5.2 Add the status notifications: new version, decline, expiry and the 15-minute pending notice, each suppressed when no longer current. Verify integration tests for each and for a rejected delivery leaving the request unchanged.
- [x] 5.3 Add the receipt and **Check booking status** on the booking page and in `/app` ([design 10](design.md#10-receipt-and-check-booking-status)). Verify integration tests for the receipt after closure, booking in progress without a join action, and the host projection.

## 6. Join

- [x] 6.1 Run the approval from Lane A through Lane B's job to Lane C's emails and receipt. Run the Phase 4 evidence list and record each item: AC-01 in full, AC-03, AC-04, AC-06 web-only, AC-07, AC-08, AC-09, AC-10 web-only and AC-13, with fixtures and the local stack. Verify a Playwright journey from a request awaiting approval to the receipt on both sides against fake Google, fake Cloudflare and the OpenAI stand-in.

## 7. Release

- [ ] 7.1 Show the shared project's dry run and push the migration through the deploy workflow or, with the user's explicit approval, `supabase db push --linked`, then deploy to production.
- [ ] 7.2 With the user's go-ahead, run the controlled checks on `https://findmeatime.com`: a confirmed event in a team-controlled Google Calendar and the confirmation, with its calendar part, in a team-controlled inbox, with consistent details. Record them in the acceptance record.
- [ ] 7.3 Teammate review of D1–D12, then `openspec archive` after verification.

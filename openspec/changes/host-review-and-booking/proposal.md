# Proposal

## Why

Phase 3 leaves a request waiting for the host: the requester has agreed to one exact proposal version and nothing more can happen. The [implementation plan](../../../documentations/technical_specification/06_implementation_plan.md#phase-4--host-review-and-booking) makes Phase 4 the first end-to-end booking: the host reviews the request privately in `/app`, approves the current proposal, the service creates the event in the host's Google Calendar, and both parties receive a confirmation and see a receipt. It is the first demonstrable product.

The main specifications already state most of the behavior: immutable proposals and closure guards in [meeting requests](../../specs/meeting-requests/spec.md), revalidation and exceptions in [meeting feasibility](../../specs/meeting-feasibility/spec.md), status notifications and the confirmation message in [email delivery](../../specs/email-delivery/spec.md), and [durable jobs](../../specs/durable-jobs/spec.md) and [application commands](../../specs/application-commands/spec.md) for the booking job. The foundation change deferred host request browsing to this phase in [chat workspaces](../../specs/chat-workspaces/spec.md), and separate host discussion audiences in [conversation access](../../specs/conversation-access/spec.md). What blocks implementation is the three decisions the plan assigns to this phase, a few gaps no owning document fills (who owns the event, what the host's shared view is, how a host's changes become a proposal), and wording that predates Phase 3's optional contact confirmation.

## What Changes

- **Host review conversation.** `/app` gains a request inbox and, per request, a host-private discussion with the assistant (audience `host_review`, one per host and request) beside a read-only view of the shared requester conversation, with a labeled switch between them. The host-review tools are `read_request` (host projection), `list_host_requests`, `evaluate_candidates` (host projection), `propose_shared_changes` and `read_booking_status`, with the `host-review.md` fragment.
- **Host decisions as cards.** The proposal review card offers **Approve this proposal**, **Request changes** and **Decline**. **Review proposed shared changes** compares current and suggested values and offers **Share revised details** and **Dismiss suggestions**; sharing checks the suggested time and creates the next proposal version for the requester's agreement. The rule and travel review card shows private constraints and offers a manual allowance for an unresolved host trip and a waiver of the weekly limit, never a bypass of a hard constraint.
- **Booking job.** Approval records an attributable decision on the current version and reserves a booking. A durable job revalidates agreement, approval and feasibility immediately before dispatch under a per-host lock, freezes the event payload, creates the event in the host's booking destination with the requester as attendee, and reconciles uncertain writes by the event's own identity before any second create. Withdrawal and decline stay available until dispatch may have begun.
- **Confirmation and notifications.** A confirmation email per recipient in their language and timezone, with the host's display name on the product sender, Reply-To the other party, the what/when/who/where blocks, **View booking**, **Join meeting**, and a calendar part only when its `UID` equals the created event's `iCalUID`. Requester status emails for a new proposal version, decline, expiry and a booking still pending after the reconciliation window.
- **Receipt.** The confirmed booking's receipt at the booking link (also after closure, while the link is valid) and in `/app`, with **Check booking status**.

## Decisions

The plan assigns D1–D3 to Phase 4; designing them raised D4–D12. They were taken by the implementing session on 2026-10-22 under the user's instruction to log every decision and keep it changeable, and are listed in the [decision log](../../../documentations/technical_specification/08_decision_log.md#phase-4--host-review-and-booking). None was reviewed by a teammate yet; the plan's **Teammate review** box covers them. The [design](design.md) records the reasoning and the rejected options.

| # | Decision | Choice |
|---|---|---|
| D1 | Google Calendar event ownership and organizer identity ([design 5](design.md#5-the-calendar-event)) | The service creates the event with the host's own Google grant in the host's confirmed **booking destination** calendar, so the organizer is that calendar's owner as Google reports it, never the product. The requester is the only attendee, by their contact address. The receipt and emails show the organizer from Google's response. Rejected: a service-owned calendar that invites both parties, which makes the product the organizer and needs a service Google account |
| D2 | Reconciliation window before a pending-status email ([design 7](design.md#7-uncertain-writes-and-reconciliation)) | 15 minutes after the first dispatch: a booking that is still not confirmed then sends the requester one "booking still in progress" email. Rejected: 5 minutes (normal retries still running); 1 hour (the requester waits blind too long) |
| D3 | Reminder policy ([design 9](design.md#9-confirmation-and-notifications)) | Deferred. The service sends no reminder or follow-up email in the first release; the event uses the destination calendar's default reminders. Rejected for now: a service reminder email 24 hours before, which needs a scheduler, its own opt-out and wording |
| D4 | Event identity and idempotent creation ([design 5](design.md#5-the-calendar-event)) | The event ID is derived from the booking ID (its 32 hexadecimal digits, valid base32hex) and stored before dispatch. Google rejects a second insert with the same ID, so a repeated or late create cannot make a second event, and reconciliation reads the event by that ID. Rejected: letting Google assign the ID, which leaves a lost response unreconcilable except by searching |
| D5 | Calendar-native invitation ([design 5](design.md#5-the-calendar-event)) | Insert with `sendUpdates=all`, so Google sends its own invitation from the organizer and the event appears in the requester's calendar; our confirmation email follows it. Rejected: `sendUpdates=none` with only our calendar part, which leaves requesters whose client ignores attachments with no calendar entry |
| D6 | The host's shared view ([design 2](design.md#2-host-discussions-and-the-switch)) | **Shared** shows the requester conversation read-only, with the current proposal and status. The host acts on the shared side only through cards (share revised details, approve, decline); no host-typed text reaches the requester's assistant. Rejected for now: relaying host messages into the requester thread, which needs its own authorship and injection design |
| D7 | How a host's changes become a proposal ([design 4](design.md#4-shared-changes)) | **Request changes** and `propose_shared_changes` both create one pending suggestion (time, duration, mode, place or link). **Share revised details** applies the detail changes (a new request revision, which voids the old agreement and approval), checks the suggested time with the feasibility engine, and on success writes the next proposal version and emails the requester. A time that fails the check is reported to the host privately and no version is created |
| D8 | Weekly limit when every candidate falls in a full week ([design 8](design.md#8-rule-and-travel-review)) | Follow the main spec ("Only full weeks"): no candidate is offered to the requester until the host waives the limit for this request or the requester widens the window. This replaces Phase 3's interim ordering-only behavior. Rejected: keeping ordering only, which offers times the host asked not to fill |
| D9 | Uncertain writes ([design 7](design.md#7-uncertain-writes-and-reconciliation)) | After dispatch may have begun, the job only reconciles: it reads the event by its ID and, if Google has none, inserts the same frozen payload under the same ID; it never revalidates feasibility again, because the event may already be the busy time it would find. The booking keeps its reservation until the outcome is known. After 8 attempts it stays visibly **Booking in progress**, and **Check booking status** starts another reconciliation |
| D10 | Confirmation recipients and Reply-To ([design 9](design.md#9-confirmation-and-notifications)) | Both parties receive their own copy. The requester's Reply-To is the host's Google-verified email; the host's Reply-To is the requester's contact address, confirmed or not, in line with Phase 3's D3 (nothing waits on confirmation). Rejected: withholding Reply-To until the requester confirms their address |
| D11 | Status notification recipient ([design 9](design.md#9-confirmation-and-notifications)) | The requester's current contact address, confirmed or not (Phase 3 D3). The `email-delivery` wording "verified contact" is corrected accordingly |
| D12 | The host's link to a request ([design 3](design.md#3-host-request-views)) | `/app?request={requestId}` from the host's confirmation email and in the workspace. The booking UUID is the requester's only credential and never reaches the host. Corrects the [interfaces](../../../documentations/user_experience/03_interfaces.md#booking-confirmation-email-and-calendar-invitation) row that said `bookingId` |

## Conflicts resolved here

| Conflict | Resolution |
|---|---|
| **Verified contact.** [`email-delivery`](../../specs/email-delivery/spec.md#requirement-requester-status-notifications) sends status notifications to the "verified contact" and the confirmation's Reply-To to the "verified email"; Phase 3's D3 made confirmation optional and lets every message go ahead with an unconfirmed address | MODIFIED both requirements per D10 and D11 |
| **Host link in the confirmation.** The [interfaces](../../../documentations/user_experience/03_interfaces.md#booking-confirmation-email-and-calendar-invitation) table opens `/app?request=[bookingId]` for the host | D12: the request ID; the document is corrected |
| **Weekly limit.** Phase 3 offered every candidate even when all fell in full weeks, logged as to be resolved against the main spec | D8: the main spec stands; Phase 3's design note is superseded by this change |
| **Booking state while a write is in flight.** [`meeting-requests`](../../specs/meeting-requests/spec.md#requirement-persisted-lifecycle-and-closure-guards) lists `booking` but no transition out of it on a conflict or a rejected write | ADDED "Booking attempt outcomes": a conflict returns to negotiating, a rejected write to awaiting approval with the approval spent, and the expiry sweep never closes a booking in flight |

## Capabilities

### New Capabilities

- `calendar-booking`: the booking record and its job: attributable approval, reservation and per-host coordination, revalidation before dispatch, the frozen payload, event ownership and identity, uncertain-write reconciliation, definitive failure and retry, withdrawal and decline before dispatch evidence, and the receipt. Today the behavior is spread across PRD FR-17 to FR-23 and the backend architecture's approval section, with no capability spec holding the contract.

### Modified Capabilities

- `email-delivery`: status notifications and the confirmation go to the contact address, confirmed or not (D10, D11); the pending window (D2) and the calendar part as an attachment are stated; reminders are explicitly deferred (D3).
- `meeting-requests`: booking attempt outcomes and the host's shared-changes path (D7); the host link (D12).
- `meeting-feasibility`: host travel allowances and the weekly-limit waiver as the private exception controls (D8); revalidation at booking with fresh route estimates.
- `chat-workspaces`: the request inbox and the shared-versus-private switch (D6).
- `conversation-access`: the host-review audience and its tool set.

This change also closes scenarios that the main specs already state, without changing their text:

| Specification | Closed in this change | Deferred, and where |
|---|---|---|
| [`meeting-requests`](../../specs/meeting-requests/spec.md) | "Final receipt after asynchronous booking"; "Host changes agreed details"; "Requester withdraws before booking"; "Withdrawal during pending write"; "Keyboard host review"; "Guest inspects request" for host exception reasoning | None |
| [`meeting-feasibility`](../../specs/meeting-feasibility/spec.md) | "Manual allowance confirmed"; "No preference match"; "Only full weeks"; "Expiry during booking revalidation"; "Command started before expiry" | None |
| [`email-delivery`](../../specs/email-delivery/spec.md) | "Host requests changes"; "Notification delivery fails"; the three confirmation scenarios | Conversational delivery in Phase 7; live inbox evidence (blocked, below) |
| [`chat-workspaces`](../../specs/chat-workspaces/spec.md) | "Browse host requests"; "Switch host discussion visibility"; host approval in "Confirm a proposal"; "Calendar description carries no booking link"; "Use compact navigation" with the inbox item | iMessage backpressure in Phase 6 |
| [`conversation-access`](../../specs/conversation-access/spec.md) | "Host switches to shared discussion" | None |
| [`durable-jobs`](../../specs/durable-jobs/spec.md), [`application-commands`](../../specs/application-commands/spec.md) | The booking job and the host commands under the existing requirements | None |

## Archive order

Phase 3's change `requester-intake-and-feasibility` is not archived yet. This change's deltas touch requirements Phase 3 does not modify, so the two can archive in either order; archiving Phase 3 first keeps the main specs' history in delivery order.

## Impact

- **New code:** `lib/server/{host-requests,host-review-tools,approvals,bookings,booking-job,calendar-events,shared-changes,request-exceptions,status-notifications,booking-receipts}.ts`, `lib/contracts/{host-request,booking}.ts`, the host-review half of `agent/tools/request.ts`, `agent/instructions/host-review.ts`, `/api/host/requests/*`, the inbox and request views in `/app`, and the receipt on the booking page.
- **Changed code:** the conversation and recovery modules and `appAuth` accept a host's request discussions as well as its setup discussion; the evaluation job can check one fixed interval and reads host exceptions; the email pipeline gains Reply-To, an attachment and the new kinds.
- **Schema:** `discussions.request_id` and the `host_review` audience; `approvals`, `bookings`, `request_exceptions` and `shared_change_drafts`; new email kinds and `email_deliveries.reply_to`, generated through pg-delta.
- **Systems:** none new. Booking uses the host grant's existing `calendar.events` scope; email uses the existing Cloudflare token. A migration on the shared project `anelszynxtvxoxqvzgqt` and a production deploy are left to the user (decision log, "Blocked on the user").
- **Documents:** the plan's Phase 4 boxes, PRD section 10 (reminders, organizer), [agent configuration](../../../documentations/technical_specification/04_agent_configuration.md), the [interfaces](../../../documentations/user_experience/03_interfaces.md) host link, the [page list](../../../documentations/user_experience/04_page_list.md), the decision log and the acceptance record, with their Korean mirrors.

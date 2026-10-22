# Design

## Context

See [proposal.md](proposal.md). Phases 1 to 3 left these pieces to build on:

- a request that reaches `awaiting_host_approval` with an `agreements` row on one immutable proposal version, its evaluation, and the requester discussion with its eve session;
- the evaluation job with the shared 18-second deadline, the host evaluation view (`readHostEvaluation`) that keeps every candidate's basis and legs, travel allowances per candidate leg, and route estimates cached for 24 hours;
- the host Google Calendar client built from the stored grant, whose consent already includes `calendar.events`;
- the command pipeline, durable jobs with fencing, the `email_delivery` job with frozen dispatch identity, and the request lifecycle with closure and expiry;
- the host conversation plumbing (`conversations.ts`, `recovery.ts`, `appAuth`), written for the single host setup discussion.

Before designing each module, read the reference files the [plan names for Phase 4](../../../documentations/technical_specification/06_implementation_plan.md#5-reference-repositories-per-phase): OpenInstinct's Calendar client and its scheduled-run report lifecycle and reply targets, the personal-agent template's request flows, iteration 1's F10 preview-then-confirm receipts and F11 conflict badges, and cal.diy's success card and scheduled-email templates for design only. The pull request names the revisions.

## Goals / Non-Goals

**Goals:** a host opens a request from the `/app` inbox, discusses it privately with the assistant, reads the shared conversation, reviews the exact proposal, resolves private rule and travel questions, approves, requests changes or declines; approval books the event in Google Calendar exactly once, even across retries, competing requests and lost responses; both parties receive a confirmation and see the receipt; the requester hears about new versions, decline, expiry and a booking that stays pending.

**Non-goals:** post-booking rescheduling and cancellation (outside the first release); host decisions over iMessage (Phase 6), MCP or the CLI (Phase 5); requester email threads (Phase 7); reminder emails (D3).

## Decisions

### 1. Records

| Table | Holds | Authoritative for |
|---|---|---|
| `discussions` (changed) | Gains `request_id`, set only for the new audience `host_review`; uniqueness becomes (principal, audience, request) with nulls not distinct | One host-private discussion per host and request |
| `approvals` | Request, proposal, host account, the request revision at approval, retry key, `approved_at`, `spent_at` (a definitive failure or a conflict spends it), `invalidated_at` | Attributable host approval of one exact version |
| `bookings` | ID (the booking identity), request, proposal, approval, host account, destination calendar ID, the provider event ID derived from the booking ID, the frozen event payload, `start_at`, `end_at`, the reserved interval with buffers, state (`reserved`, `dispatching`, `confirmed`, `failed`, `cancelled`), attempts, failure category, provider evidence (`ical_uid`, `html_link`, `join_url`, organizer email and name, event status), `dispatched_at`, `confirmed_at`, `pending_notice_at` | The booking and its reservation; at most one live booking per request |
| `request_exceptions` | Request, kind (`weekly_limit`), host account, settings revision, `created_at`, `invalidated_at` | Host-private preference exceptions bound to the request's details and the host's rules |
| `shared_change_drafts` | Request, source (`assistant`, `host`), base proposal version, base revision, the suggested changes (start, duration, mode, place or link plan), state (`pending`, `checking`, `shared`, `dismissed`, `superseded`, `rejected`), the checking evaluation, the host-private rejection reason, `created_at`, `resolved_at` | What the host may share as the next proposal |
| `email_deliveries` (changed) | Kinds `booking_confirmation`, `status_new_version`, `status_declined`, `status_expired`, `status_pending`; `reply_to`; `attachments` (non-secret, such as the calendar part) | Every transactional email |

Every table has row-level security and no client grants, like the rest of `app`. A request's host-only rows are deleted with it.

### 2. Host discussions and the switch

A host selecting a request opens, on first use, a discussion `(host_account, hostId, host_review, requestId)` and its eve session, indexed exactly like the setup discussion: the session principal is the host account, the attributes add `audience: host_review` and `requestId`. `conversations.ts` and `recovery.ts` take a discussion selector (setup, or a request ID) instead of assuming setup; every route under `/api/chat/*` accepts an optional `request` parameter that names the request, and the server resolves it to the host's own discussion after checking that the request belongs to the host and is not a draft. A request ID the host does not own answers like an unknown one.

`appAuth` admits a host principal for its setup discussion or for a `host_review` discussion whose request belongs to it, both for internal bearers and for the browser's cookie stream, and puts `requestId` in the session attributes. Admission counts host-review messages against the same host windows as setup.

The request view in `/app` has a labeled two-option switch, **Private with Thyme** and **Shared with {requester}**. Private is the host-review conversation and its cards. **Shared** (D6) is the requester discussion's history, read through the application with an internal read bearer for that discussion, shown read-only, plus the current proposal and status; it has no composer. The switch never merges histories, and nothing from the private discussion is readable by the requester: the requester routes only ever resolve the requester discussion.

Rejected: a shared host composer that relays host text into the requester's assistant session (D6), which needs authorship labels in the requester's model context and its own injection review.

### 3. Host request views

`GET /api/host/requests` lists the host's requests except drafts, newest first, with requester name, purpose, status, the proposal time and a `needsDecision` flag (awaiting approval, an exception or allowance to decide, a pending suggestion, or a failed booking). `GET /api/host/requests/{requestId}` returns the host projection: details, requester name and contact email with its confirmation status, the current proposal and agreement, the approval and booking, the pending suggestion with current and suggested values, the latest host evaluation (candidates with their code-computed basis, exclusions, unresolved legs and the weekly-limit hold), live exceptions and allowances, and the receipt. `POST /api/host/requests/{requestId}/commands` runs the host commands through `runCommand` with the host actor, the expected revision and the card's retry key.

The model's host projection (`read_request` in a host-review session) carries the same facts with contact fields as presence indicators and the requester's free text marked as quoted data.

The host reaches a request at `/app?request={requestId}` (D12): the inbox selects it, and the host confirmation email links there. The booking UUID never appears in any host view.

| Card | Actions | Command |
|---|---|---|
| Proposal review | **Approve this proposal**, **Request changes**, **Decline** | `request.approve` (version), opens the suggestion editor, `request.decline` |
| Review proposed shared changes | **Share revised details**, **Dismiss suggestions**, and the suggestion editor's **Save suggestion** | `request.share_changes`, `request.dismiss_changes`, `request.suggest_changes` |
| Rule and travel review | **Allow N minutes for this trip** per unresolved host leg; **Allow this request beyond my weekly limit**; **Find times** | `request.allow_host_trip`, `request.waive_weekly_limit`, `request.host_evaluate` |
| Booking status and receipt | **Check booking status**; **Approve this proposal** again after a rejected write (labeled **Retry booking**) | `booking.check`, `request.approve` |

At most one card is actionable at once ([design principle 4](../../../documentations/03_design_principles.md#4-one-thing-to-think-about-at-once)): a pending suggestion first, then the rule and travel review while it has something to decide, then the proposal review, then the booking status.

### 4. Shared changes

D7. A suggestion comes from the host's editor (`request.suggest_changes`, **Request changes**) or from the assistant (`propose_shared_changes`, retry key `tool:{callId}`). It names any of: a new start, a duration, a mode, an in-person place, an online link plan. A new suggestion supersedes the pending one. It is stored against the current proposal version and request revision.

**Share revised details** (`request.share_changes`, expected revision) runs under the request lock on a request in `negotiating` or `awaiting_host_approval`:

1. Applies the detail changes to `requests.details` and advances the revision, which leaves the old proposal stale for agreement and voids any approval (it names the old revision); a request awaiting approval returns to `negotiating`; live exceptions are invalidated.
2. Marks the suggestion `checking` and publishes an evaluation at the new revision with the host audience and a **fixed interval**: the suggested start (or the current proposal's) and the new duration, with the request windows replaced by exactly that interval.
3. The evaluation job, on publication, sees the fixed interval: if its one candidate is `offered`, it writes the next proposal version from that candidate and evaluation, marks the suggestion `shared`, and enqueues the requester's `status_new_version` email; otherwise it marks the suggestion `rejected` with the host-private reason (busy, travel, outside hours, unresolved trip) and creates no version. Either way the request stays `negotiating` with the new details, so the requester can also find other times.

**Dismiss suggestions** marks it `dismissed`. The proposal's participants and the requester's details stay as they are; a suggestion cannot change the requester's identity.

### 5. The calendar event

D1, D4, D5. The event is created with `events.insert` on the host's confirmed booking destination (`settings.bookingCalendar.id`) with the host's own grant, `conferenceDataVersion=1` and `sendUpdates=all`. The payload, frozen in `bookings.payload` before dispatch:

| Field | Value |
|---|---|
| `id` | The booking ID's 32 hexadecimal digits, valid base32hex |
| `summary` | The purpose, or "Meeting with {requester}" |
| `start`, `end` | The proposal's instants as `dateTime` with the host's `timeZone` |
| `attendees` | The requester's contact address and name only |
| `location` | The in-person place, or the requester's link for `requester_link` |
| `conferenceData` | For `google_meet`: a `createRequest` with `requestId` the booking ID and `hangoutsMeet` |
| `description` | The purpose, the meeting details and the join line; never the booking link, notes, rules or reasons |
| `guestsCanModify`, `guestsCanInviteOthers` | `false` |
| `reminders` | `{ useDefault: true }` (D3) |
| `extendedProperties.private` | `fmatBookingId` |

The organizer is whoever Google says owns the destination calendar; the receipt and the emails show `organizer.email` and `organizer.displayName` from the response. The response's `iCalUID`, `htmlLink`, `hangoutLink` (or the video entry point) and `status` are the provider evidence.

### 6. Approval, reservation and the booking job

`request.approve` (version, expected revision) under the request lock then the per-host advisory lock `app.booking_host:{hostId}`:

- rejects unless the actor is the request's host, the host is active, the request is `awaiting_host_approval`, the version is the latest, has an agreement and was made at the revision before agreement, and its start is in the future;
- an approval already recorded for the version returns the live booking instead of a second one, so a mobile approval and a repeated agent approval see one result (AC-06);
- inserts the `approvals` row, the `bookings` row in `reserved` (the reserved interval is the proposal plus the host's buffers), moves the request to `booking` with the next revision, and publishes the `booking` job keyed by the booking ID.

The `booking` job, with its own connection for the phases that must commit before a network call (as `email_delivery` does):

1. **Revalidate**, under the request lock and the host lock, for a `reserved` booking: the request is still `booking` and unexpired, the approval is live and names the current version, the agreement exists, the host is active; then run the feasibility engine on exactly the proposal interval under a fresh 18-second deadline, with route estimates older than one hour fetched again and the host's other `dispatching` or `confirmed` bookings added as busy time. A failed check settles the booking (section 7 lists the outcomes) and publishes nothing further.
2. **Dispatch**: freeze the payload, set `dispatching` and `dispatched_at`, publish the delayed `booking_pending_notice` job for D2's window, and commit, still under both locks so a second booking for the same host waits and then sees this one as busy.
3. **Create**: `events.insert` with the frozen payload.
4. **Settle**: `200` confirms; `409` (the ID exists) reads the event and confirms it; a `400`, `403` or `404` from Calendar, or a revoked grant, is a definitive rejection; a timeout, a `5xx` or a lost response leaves the booking `dispatching` and fails the attempt so the job is retried as a reconciliation.

**Confirm**, in one transaction: the booking becomes `confirmed` with the evidence, the request `booked` and closed with the next revision (closure deletes requester grant tokens and supersedes reviews and confirmation links as for any closure), and both confirmation emails are enqueued (section 9).

Rejected: running the provider call inside the job's transaction with the dispatch mark, which would roll the mark back on a crash and lose the fact that a write may have happened.

### 7. Uncertain writes and reconciliation

D9. A job attempt that finds its booking `dispatching` reads `events.get` by the event ID:

| Read | Outcome |
|---|---|
| Found, not cancelled | Confirm with that evidence |
| `404` or `410` | Insert the same frozen payload under the same ID; a `409` from that insert means the first one landed, so read and confirm |
| Found but cancelled | `failed` with `event_removed`: the host deleted it; nothing is recreated |
| Timeout, `5xx` | Fail the attempt again and keep the reservation |

The job has 8 attempts with the queue's doubling backoff (about 40 minutes in all). Exhaustion leaves the booking `dispatching`, the request `booking`, and both parties see **Booking in progress**; `booking.check` (**Check booking status**) publishes a new reconciliation job for a `dispatching` booking and returns the current state for any other. Feasibility is never rechecked after dispatch, because the event it would find busy may be this booking's own.

Outcomes before dispatch, each under the request lock and with the next revision:

| Outcome | Booking | Request | Approval |
|---|---|---|---|
| Calendar conflict, travel no longer fits, outside the host's hours | `failed` (`conflict`) | `negotiating`; the old proposal is stale, so the requester finds or is offered another time | spent |
| Request withdrawn, declined or expired meanwhile | `cancelled` | unchanged (already closed) | spent |
| Evaluation deadline passed (`deadline`), Calendar unreadable | `failed` (`revalidation_unavailable`) | `awaiting_host_approval` | spent; the host approves again to retry |
| Definitive rejection or revoked grant, during dispatch | `failed` (`calendar_rejected`, `calendar_access_revoked`) | `awaiting_host_approval` | spent; **Retry booking** is a new approval, revalidated from the start |

The expiry sweep never closes a request in `booking`; a `reserved` booking whose request expired is cancelled by its own revalidation, which rejects an expired request.

### 8. Rule and travel review

The host evaluation view carries, per candidate, its legs and basis and, per evaluation, the exclusions and whether every offered candidate falls in a week at or above the weekly limit. The card shows the private constraints (hours, buffers, travel estimates, unresolved trips) in code-computed sentences.

- **Allow N minutes for this trip** (`request.allow_host_trip`, 5 to 240 minutes in 5-minute steps) records a host allowance for one unresolved host leg of one candidate of the latest host evaluation, confirmed by the host, and evaluates again with the host audience. The engine already applies confirmed allowances plus buffers.
- **Allow this request beyond my weekly limit** (`request.waive_weekly_limit`) records a `weekly_limit` exception at the current settings revision and evaluates again. Any change of details or a new settings revision voids it.
- D8: when the weekly limit is set, at least one candidate is offered, every offered candidate is in a week at or above the limit and no live waiver exists, the requester projection offers no candidate and shows the authored no-match message; the host's list marks the request as needing a decision.

A hard constraint (busy time, hours, a trip that does not fit) has no control here.

### 9. Confirmation and notifications

D10, D11, D3. `booking_confirmation` is enqueued twice in the confirming transaction, deduplicated per booking and recipient:

| | Requester's copy | Host's copy |
|---|---|---|
| To | The contact address | The host's Google email |
| From | `{host display name} <no-reply@findmeatime.com>` | the same |
| Reply-To | The host's Google email | The requester's contact address |
| Language, timezone | The request's language and the requester's timezone | English and the host's timezone |
| Subject | `{title} between {host} and {guest}`; Korean `{host} 와 {guest} 사이의 {title}` | the same in English |
| **View booking** | The booking link (a sealed secret parameter) | `/app?request={requestId}` |

The body is HTML with a plain-text alternative: the **Confirmed** badge, What (title), When (weekday, date, start–end, duration, the zone named), Who (organizer and guest with their emails), Where (place or join link), **Join meeting** for online meetings and a support line. A `text/calendar; method=REQUEST` attachment `invite.ics` (`UID`, `SUMMARY`, UTC `DTSTART`/`DTEND`, `LOCATION`, `STATUS:CONFIRMED`, `ORGANIZER`, `ATTENDEE;PARTSTAT=ACCEPTED`) is included only when the event's `iCalUID` is known, and its `UID` is that value. A confirmation is never suppressed by a later state change: it is current for as long as the booking is confirmed.

The Cloudflare adapter gains `reply_to` and `attachments` (base64 content, filename, type, disposition), which the REST API accepts. The frozen row keeps them, so a dispatch sends exactly what was recorded.

Status notifications to the requester's contact address carry the status, the booking link and what to do:

| Kind | When | Deduplicated by |
|---|---|---|
| `status_new_version` | A shared suggestion writes a new proposal version | request and version |
| `status_declined` | `request.decline` | request |
| `status_expired` | The expiry sweep closes the request | request |
| `status_pending` | `booking_pending_notice` finds the booking still unconfirmed 15 minutes after dispatch (D2) | booking |

Each is current only while its condition holds at dispatch (the version is still the latest and unagreed; the booking is still unconfirmed), otherwise it is suppressed; none changes request state. A rejected or uncertain delivery is recorded as for every email and never retried into a second send.

### 10. Receipt and Check booking status

The receipt is built from the confirmed booking's evidence and frozen payload only: the title, start and end with duration and the viewer's timezone named, the organizer and the requester with their emails, the place or **Join meeting**, and **Open in Google Calendar** for the host when Google returned an `htmlLink` on `google.com`. The requester sees it on the booking page, before and after closure while the link is valid; a closed request still shows only status and receipt. The host sees it on the request in `/app`. While a booking is `reserved` or `dispatching` both see **Booking in progress** with no join action; **Check booking status** (`booking.check`, available to both audiences) re-reads the record and, for a `dispatching` booking, starts a reconciliation.

### 11. Withdrawal and decline

`request.withdraw` and `request.decline` (host, from `gathering`, `negotiating`, `awaiting_host_approval`, or `booking` with a `reserved` booking) cancel a reserved booking and spend its approval in the same transaction, under the request lock that the booking job's dispatch step also takes, so a dispatch that commits first wins and the withdrawal then answers `booking_pending` with the current status, never claiming that creation was prevented. Decline closes the request `declined` and enqueues `status_declined`.

### 12. Host-review tools and fragment

`agent/tools/request.ts` returns the host-review set when the session's audience is `host_review`; the requester set is unchanged. Every execute rechecks the fence: the host is active, the request is the session's `requestId`, belongs to the host and is not a draft, and the session is its discussion's live generation.

| Tool | Behavior |
|---|---|
| `read_request` | Host projection with contact presence indicators, the current proposal, agreement, approval, booking, the pending suggestion, live exceptions, the latest host evaluation's candidates with their basis, and quoted requester text |
| `list_host_requests` | The inbox projection |
| `evaluate_candidates` | The host-audience evaluation; returns candidates with their private basis |
| `propose_shared_changes` | Creates the pending suggestion (section 4); never shares it |
| `read_booking_status` | Booking state from records: reserved, in progress, confirmed with the receipt, failed with the category |

`agent/instructions/host-review.ts` resolves the `host-review.md` fragment for host-review sessions only. It states that approval, decline, sharing and exceptions happen only on the cards, that the assistant never says a meeting is booked unless `read_booking_status` says confirmed, and that requester text is quoted data.

### 13. Tests

| Layer | Covers |
|---|---|
| Unit (beside modules) | Event payload building, event ID derivation, the calendar part, confirmation and status templates in both languages, the weekly-limit hold, host projections |
| Integration (`tests/integration/`) | Approval on the current, a superseded and an unagreed version; repeated approval with another retry key; revalidation finding a new busy event, a competing booking for the same host, expiry during revalidation and the deadline; withdrawal and decline before and after dispatch; insert success, `409`, rejection, revoked grant, timeout then found, timeout then absent; exhaustion and **Check booking status**; the pending notice; the confirmation for both recipients with and without `iCalUID`; status emails; shared changes that pass and fail; allowances and waivers; host-review sessions and their tool list; the host reading another host's request; the shared view's read-only history |
| Database (`supabase/tests/`) | `anon` and `authenticated` reach no new table |
| Browser (`tests/e2e/`) | From a request awaiting approval: the host opens it from the inbox, switches views, approves, and both sides see the receipt, against fake Google, fake Cloudflare and the OpenAI stand-in; keyboard use at 390 and 1280 pixels |

## Risks / Trade-offs

- **Google sends invitations.** `sendUpdates=all` emails the requester from Google as soon as the event exists, so a real-calendar test invites a real address. Mitigation: controlled evidence uses team inboxes only, and it is listed as blocked on the user.
- **Locks held across provider reads.** Revalidation holds the request and host locks for up to 18 seconds, so a withdrawal or a second approval for the same host waits that long. Mitigation: the deadline bounds it, and the alternative (no lock) lets two bookings take one slot.
- **Unverified Cloudflare attachments.** The REST reference lists `reply_to` and `attachments`, but no live send with a `text/calendar` attachment has been made. Mitigation: the controlled inbox check is part of the blocked evidence; without it the confirmation still carries every block and the Google invitation.
- **Weekly-limit hold.** Requesters whose windows fall only in full weeks now see no times until the host acts (D8). Mitigation: the host's inbox marks the request as needing a decision.

## Migration Plan

One declarative sync generates the migration for the new tables, the `discussions` change and the email kinds. `supabase db reset --local` must rebuild the chain. The shared project receives it through the deploy workflow if its secrets are set, otherwise by `supabase db push --linked` after a shown dry run and only with the user's approval, which this change leaves blocked. Rollback: the tables are additive; reverting the deployment leaves requests awaiting approval, with no booking started.

## Open Questions

- Teammate review of D1–D12.
- Whether Cloudflare delivers a `text/calendar` attachment so that Gmail and Outlook show it as an invitation; the controlled inbox check answers it.
- Whether to add reminders after launch (D3).

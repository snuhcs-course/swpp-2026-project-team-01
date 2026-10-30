# Proposal

Tracking issue: not opened yet (the tracking issue rule arrives with PR #20; the issue is opened before this change's pull request).

## Why

Phases 3, 4 and 7 give the guest (requester) a complete web and email journey: one thread from the host's link, Google identity and Calendar availability, candidate times matched against the host's private rules, agreement, the host's decision and a confirmed event ([guest booking flow](../../../documentations/user_experience/06_guest_booking_flow.md)). Three things the user asked for on 2026-10-29 are still missing, and each one contradicts a recorded decision, so this change proposes them explicitly instead of extending the earlier changes:

1. **Guest notices in iMessage.** A guest who links iMessage receives the host's decisions there and keeps talking to the assistant in that conversation. Today email is "the requester's notification channel in the first release" ([PRD §5 step 5](../../../documentations/02_product_requirements.md#5-main-user-journey), [Host interaction through iMessage](../../../documentations/02_product_requirements.md#host-interaction-through-imessage)), iMessage is a host channel only, and guest iMessage is listed as an open decision in the guest booking flow.
2. **A "revised request" after a decline.** When the host declines (or the request expires), the guest replies in the channel that carried the notice and the conversation continues as a new request to the same host that carries over what was already agreed. Today a closed request's email thread answers once with a fixed closed notice and nothing else ([`requester-email-channel` D11](../requester-email-channel/proposal.md#decisions); `lib/server/email-receipts.ts`), and the requester session ends when its request closes ([agent configuration](../../../documentations/technical_specification/04_agent_configuration.md#durability-and-recovery)).
3. **A guest who is already a host.** When the Google account a guest signs in with already belongs to a Find Me a Time host, the guest can use that host's settings for this request: the calendars, the linked iMessage, the meeting preferences (as soft preferences only) and the basic details. Today the requester's Google consent "never creates a Supabase user, a host account or a product session" and stays apart from the same person's host grant ([Phase 3 design 3](../requester-intake-and-feasibility/design.md#3-requester-google-consent); `lib/server/requester-google.ts`), and the PRD says "requesters remain account-free and do not need a host OAuth grant" ([§5, copy-and-paste entry](../../../documentations/02_product_requirements.md#copy-and-paste-entry-experience)).

This change also adds a browser test that presses the guest's **Continue with Google** and **Connect Google Calendar**. No test presses them today, which is how both buttons stopped working on `main` unnoticed (PR #37, on which this branch is stacked).

## What Changes

- **Guest iMessage linking (inbound first).** The booking page offers **Get updates in iMessage**. It opens Messages with a one-time link code already written to the service's line, the way the host's **Connect iMessage** does ([`host-imessage-channel` D4, D5](../host-imessage-channel/proposal.md#decisions)). When the guest's message arrives, the booking page shows the masked sender and **Confirm and link**. Nothing is bound before that click, made by the holder of the booking link. The service never texts a guest first: Photon's shared lines refuse a first outbound message to a number (host-imessage-channel D16).
- **Guest notices and conversation in iMessage.** A linked guest receives the existing requester status notices (new version, decline, expiry, booking still pending) and the booking confirmation in the linked conversation, in addition to email. Their plain-text messages become inputs of the request's requester discussion, as email messages do, and the assistant's final text goes back as a reply. Email remains the channel that carries the booking link.
- **Revised request ("수정된 요청").** After a decline or an expiry, the guest's next message in the bound email thread or iMessage conversation creates a revised request: a new request to the same host, linked to the closed one, with the closed request's purpose, duration, mode, place or link plan, travel mode, timezone, language, name and contact carried over and no times. The channel binding moves to the revised request, the creation email sends its booking link, and the message becomes the first input of its discussion. The closed request stays closed.
- **Host profile for a guest who is a host.** On the Google return, when the guest's Google account belongs to an active host with confirmed settings (other than this request's host), the thread shows one card: **Use your host settings for this request**, with four items the guest can uncheck. Nothing is used before **Use these settings**:
  - **Calendars**: their host calendars and Calendar grant supply the guest's busy time, without a separate requester Calendar consent.
  - **iMessage**: their linked host conversation receives this request's guest notices, without a new code.
  - **Preferences**: their weekly hours and weekly meeting limit order the candidates (inside the hours first, weeks below the limit first) and never remove a candidate.
  - **Basic details**: timezone, language and travel mode are filled in.
- **Ink for every guest screen.** A teammate is moving the whole app to ink (`globals.css` and its theme tests), which PR #42 left to a later change ([DESIGN.md known gaps](../../../DESIGN.md#known-gaps)). This change builds on that result: it adjusts only the guest screens (`/{handle}` and `/booking/[bookingId]`) and their new cards, and does not set tokens or edit the shared parts (`GuestCard`, `GuestReceipt`, `components/ui`) itself.
- **Guest Google journey in the browser.** An end-to-end test runs **Continue with Google** and **Connect Google Calendar** against the fake consent server, including the host-profile card.

## Decisions

The user decided U1–U5 on 2026-10-29. This session proposed D1–D9 on 2026-10-29 for the user's review. None has had teammate review; the [design](design.md) records the reasoning and the rejected options.

| # | Decision | Choice |
|---|---|---|
| U1 | Guest iMessage (user) | In scope: a guest can link iMessage, receive notices there and continue the conversation there. Replaces "email is the requester's notification channel in the first release" |
| U2 | Guest who is a host (user; team agreed, recorded 2026-10-30) | Reuse calendars, linked iMessage, preferences and basic details. Preferences (weekly hours, weekly limit) are relaxed or optional, never strict |
| U3 | After a decline (user) | Continue in the channel that carried the notice, as a revised request ("수정된 요청"); a new request record is acceptable |
| U4 | Theme (user, 2026-10-30) | Every guest screen in ink, on top of a teammate's app-wide ink migration. This change only adjusts guest screens within that result. Rejected: a guest-only token scope (a second home for the same tokens once the app-wide migration lands); separate ink cards (would drift from the shared `GuestCard`) |
| U5 | Base (user) | Stacked on PR #37; add the browser test that presses the guest's Google buttons |
| D1 | Guest linking ([design 1](design.md#1-guest-linking)) | Inbound first, as for hosts: a request-owned link code (`FMAT-` family, 15 minutes, hashed and sealed, at most 5 per request per hour) in a prefilled `sms:` deep link, then **Confirm and link** on the masked sender on the booking page. Rejected: the service texting the guest's number (refused by Photon's shared lines, junk banner, daily new-conversation allowance); binding on arrival without a browser confirmation |
| D2 | Guest binding ([design 2](design.md#2-guest-bindings)) | A separate `requester_imessage_bindings` table: one active binding per request; a sender may hold bindings on several requests (several hosts). Host bindings and their invariants (one sender, one host; host-private suppression) are untouched. Rejected: a nullable `host_account_id` in `imessage_bindings`, which breaks both unique indexes and the host-private suppression rule |
| D3 | Inbound routing ([design 3](design.md#3-inbound-routing)) | A link code links. Otherwise a message goes to the conversation of the last message the line sent to that sender: after a guest notice (confirmation, approval, decline) to that guest request; after a host notice to the host path. A sender with no earlier message from the line goes to their host binding, else their only or most recently notified guest binding. Switching uses the host iMessage channel's conversational selection (owned by the host-side iMessage work, not yet written; until it lands, `request <ref>`). A sender with no binding gets the existing unlinked reply. Forwarded guest text is stored as `[iMessage] …`, as for hosts |
| D4 | Guest notices ([design 4](design.md#4-guest-notices)) | The four status notices and the confirmation go through the existing `imessage_outbox`, frozen from the same domain records as the email, with no booking link and no host-private data; email still carries the link. A send that began and lost its answer is never repeated (host-imessage-channel D9) |
| D5 | Revised request ([design 5](design.md#5-revised-requests)) | Created by the bound guest's next message after a decline or an expiry, at most one direct successor per closed request (so a retried receipt or a second channel creates nothing more), a chain of at most 10 requests from the first, under the existing creation bounds counted per keyed contact hash, only while the host is active and ready. Carries details and contact, never times or proposals; the guest's confirmed contact stays confirmed when the address is the same. The host sees that it follows their earlier decline. A booked or withdrawn request keeps the closed notice |
| D6 | Revised request context ([design 5](design.md#5-revised-requests)) | The revised discussion starts with an authored summary of the closed request (purpose, details, "the host declined" or "the request expired"), never the host's notes, rules or reasons, then the guest's message |
| D7 | Host-profile match ([design 6](design.md#6-host-profile-for-a-guest-who-is-a-host)) | The raw Google subject from the verified ID token on the requester callback is compared with `google_identities`; the match needs an active host account with confirmed settings that is not this request's host. The card is shown once; its choices are stored per request in `requester_host_profiles` and deleted when the request closes. Rejected: matching by email address (an address is not an identity); applying the settings without the card |
| D8 | Host calendars for the guest ([design 6](design.md#6-host-profile-for-a-guest-who-is-a-host)) | The evaluation reads busy time from the guest-host's conflict calendars with that host's own Calendar grant, inside the evaluation only; nothing is stored, revoked or shown. If that grant fails, the request falls back to **Connect Google Calendar** and dependent evaluation pauses, as today |
| D9 | Soft guest preferences ([design 7](design.md#7-soft-guest-preferences)) | Order only: candidates inside the guest-host's weekly hours first, then weeks below their weekly limit, counted as the host count is; buffers are not applied. The host's own hard rules and the guest's stated windows are unchanged. **Change** on the card's receipt turns preferences off for this request |
| D10 | Changes until the host approves ([design 10](design.md#10-changes-until-the-host-approves)), agreed with the team on 2026-10-29 | While the request awaits the host's approval, **Change** on the agreed time's receipt returns it to negotiating, so details and times can change in place. A host's approval that lands first wins; after approval nothing changes in place. Rejected: changes only by withdrawing and starting again (today's behavior) |

## Open decisions

These stay open; the change does not assume an answer:

| # | Question | Default until decided |
|---|---|---|
| O1 | After a booking, should the channel answer read-only questions such as "when is it?" from the receipt ("일정 확인" in the user's goal), or keep the closed notice? | The closed notice, with the booking page as the place to read the receipt |
| O2 | May a guest choose a time or agree in iMessage with exact commands (as hosts approve with `approve <ref>`), or only on the booking page as for email? | Booking page only; the assistant names the card |
| O3 | Can a host refuse revised requests after a decline? | No host control; the chain stops at 10 requests |
| O4 | Is a withdrawn request eligible for a revised request? | No |

## Conflicts resolved here

| Conflict | Resolution |
|---|---|
| **Requester notification channel.** The [PRD](../../../documentations/02_product_requirements.md) (§5 step 5 and *Host interaction through iMessage*) makes email the requester's only notification channel and iMessage a host channel; the [guest booking flow](../../../documentations/user_experience/06_guest_booking_flow.md#requester-notifications) defers guest iMessage | U1, D1–D4. The PRD, the guest booking flow and the [interfaces](../../../documentations/user_experience/03_interfaces.md) are updated |
| **Closed email thread.** [`requester-email-channel`](../requester-email-channel/proposal.md#decisions) D11 and its "Closed request" scenario give a closed request's thread one closed notice | U3, D5: a declined or expired request's thread creates a revised request; a booked or withdrawn request keeps the closed notice. That change is not archived; its scenario is amended when it archives (task 9.3) |
| **Terminal requests never reopen.** [Meeting requests](../../specs/meeting-requests/spec.md#requirement-persisted-lifecycle-and-closure-guards) | Kept: a revised request is a new request with its own booking link, revision history and expiry; the closed one is never reopened |
| **Requester sessions end at closure.** [Agent configuration](../../../documentations/technical_specification/04_agent_configuration.md#durability-and-recovery) | Kept: the revised request has its own session, started with the D6 summary |
| **Account-free requesters and separate grants.** PRD §5 *Copy-and-paste entry experience*; [Phase 3 design 3](../requester-intake-and-feasibility/design.md#3-requester-google-consent) (Dohyeon Park, 2026-10-22); `requester-google.ts` | U2, D7, D8: the guest still gets no account, session or sign-in; a host who is a guest may opt in, per request, to read their own host data. No grant is created, shared, revoked or deleted. Agreed by the team, including the reversal of Phase 3 design 3 |
| **Requester Calendar access is request-bound.** [`requester-calendar-access`](../requester-intake-and-feasibility/specs/requester-calendar-access/spec.md) | D8 adds a second availability source for a matched host only; the request-bound requester grant stays the default |
| **Ink scope.** [`host-imessage-channel` D18](../host-imessage-channel/proposal.md#decisions) keeps the rest of the app on Thyme; [DESIGN.md](../../../DESIGN.md) makes ink the direction for every screen | U4: the app-wide migration is a teammate's work; this change adjusts guest screens on top of it |

## Capabilities

### New Capabilities

- `requester-imessage-channel`: guest linking by an inbound code with browser confirmation, guest bindings, inbound routing for guests and for guests who are hosts, guest notices and replies in the linked conversation, unlinking and retention.
- `requester-host-profiles`: matching a guest's Google account to a host account, the opt-in card, which host data a request may use (calendars, iMessage, preferences, basic details), and its deletion at closure.

### Modified Capabilities

- `meeting-requests`: revised requests after a decline or an expiry (added requirement); the booking page's iMessage controls (added requirement).
- `meeting-feasibility`: soft guest preferences from a host profile (added requirement).
- `email-delivery`: requester status notifications also go to a linked iMessage conversation (modified requirement).

## Archive order

This change builds on `requester-intake-and-feasibility`, `host-review-and-booking`, `host-imessage-channel` and `requester-email-channel`, none of which is archived. It archives after them, so that the closed-thread amendment (task 9.3) applies to an archived `requester-email-threads` spec.

## Impact

- **New code:** `lib/server/{requester-imessage-links,requester-imessage-bindings,revised-requests,requester-host-profiles}.ts`; `lib/contracts/requester-imessage.ts`; `GET`/`POST /api/requests/{bookingId}/imessage` routes; the **Get updates in iMessage** card and its link screen, and the host-profile card, built on `GuestCard`.
- **Pull requests:** three, each a whole feature: (1) guest channel and request changes, groups 1–5a; (2) host profile and soft preferences, groups 6–7 with the `requester_host_profiles` part of group 2; (3) guest screen redesign, group 8. Each carries its own part of group 9.
- **Depends on:** the teammate's app-wide ink migration, for pull request 3 only.
- **Changed code:** `lib/server/imessage-receipts.ts` (routing, D3); `lib/server/imessage-commands.ts` (`request <ref>` for guest requests); `lib/server/booking-notices.ts` and `imessage-notice-job.ts` (guest notices); `lib/server/email-receipts.ts` (revised request instead of the closed notice); `lib/server/requester-google.ts` (host match); `lib/server/evaluation.ts` and `feasibility.ts` (host-calendar busy source, soft ordering); `agent/instructions/requester.ts` (iMessage shows no cards; revised requests).
- **Schema:** `requester_imessage_bindings`, `requester_host_profiles`, `requests.revised_from_request_id`, and a request owner on `imessage_links`, each with row-level security and no client grants, through pg-delta.
- **Systems:** Photon (the same line; inbound-first, so no new-conversation allowance is spent on guests), AgentMail, Google. Real iMessage and email to people outside the team, the shared-project migration and the production deploy stay with the user.
- **Documents:** the [PRD](../../../documentations/02_product_requirements.md), [guest booking flow](../../../documentations/user_experience/06_guest_booking_flow.md), [page list](../../../documentations/user_experience/04_page_list.md), [interfaces](../../../documentations/user_experience/03_interfaces.md), [agent configuration](../../../documentations/technical_specification/04_agent_configuration.md), [backend architecture](../../../documentations/technical_specification/01_backend_architecture.md), the [implementation plan](../../../documentations/technical_specification/06_implementation_plan.md), the decision log and the acceptance record, with their Korean mirrors.

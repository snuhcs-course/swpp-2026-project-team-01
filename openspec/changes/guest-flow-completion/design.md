# Design

## Context

What exists (verified on 2026-10-29 against `origin/main` 7868a7aa plus PR #37):

- **Requester web and email.** One requester discussion per request (`request:{requestId}`), a draft until identified, the booking link as the credential, request-bound Google grants (`requester_grants`, delete-only), deterministic feasibility (`lib/server/feasibility.ts`), status notices frozen from domain records (`lib/server/booking-notices.ts`: `status_new_version`, `status_declined`, `status_expired`, `status_pending`), and AgentMail threads bound to one request (`email_threads`). A bound thread of a closed request gets one closed notice (`lib/server/email-receipts.ts`, `FIXED_REPLIES.closed`).
- **Host iMessage.** One Photon line; a signed receiver that stores a receipt and job before `200` (`agent/channels/photon.ts`, `lib/server/photon-receiver.ts`); host-sent link codes confirmed in the browser (`imessage_links`, `imessage_bindings`, `lib/server/imessage-links.ts`); routing by the sender's active host binding (`processReceipt` in `lib/server/imessage-receipts.ts`); exact commands (`lib/server/imessage-commands.ts`); a sealed, frozen outbox that never repeats an uncertain send (`imessage_outbox`, `lib/server/imessage-outbox.ts`).
- **Host identity.** `google_identities` holds the raw Google subject of every host account; host settings are `host_settings.settings` (weekly windows, buffers, weekly limit, mode, travel mode).

Constraints that shape every decision below: Photon's shared lines refuse a first outbound message to a number (host-imessage-channel D16, spike of 2026-10-20); messaging is denied outside production ([messaging environments](../../specs/messaging-environments/spec.md)); terminal requests never reopen ([meeting requests](../../specs/meeting-requests/spec.md#requirement-persisted-lifecycle-and-closure-guards)); requester output never contains host-private data ([agent configuration](../../../documentations/technical_specification/04_agent_configuration.md#permission-layers)).

## Goals / Non-Goals

Goals: a guest can receive decisions in iMessage and keep talking there; after a decline or an expiry the same channel continues as a revised request; a guest who is a host can opt in to use their host settings for one request; the guest's Google buttons are covered by a browser test.

Non-goals: guest agreement or candidate choice by text command (O2); answering questions about a booked meeting in the channel (O1); host control over revised requests (O3); SMS for guests; a guest account or sign-in; the app-wide ink migration itself (a teammate's change).

## Decisions

### 1. Guest linking

The booking page shows **Get updates in iMessage** below contact confirmation, beside **Continue by email**. Pressing it asks the server for a link code owned by the request (a third owner kind on `imessage_links`, beside the host account and the iMessage-start browser) and at once opens Messages with `Get Find Me a Time updates: FMAT-…` addressed to the line, using the host's deep-link forms (`deepLinkFor`, `messagesPlatform` in `lib/contracts/imessage.ts`) and the QR code fallback on desktops. The code family, lifetime and limits follow host-imessage-channel D5 (`FMAT-` plus ten Crockford characters, 15 minutes, hashed and sealed, at most 5 per request per hour), so the existing redaction already removes it everywhere.

When the message arrives, `receiveLinkCode` records the masked sender on the attempt; the booking page polls the attempt and shows the masked sender with **Confirm and link**. Only that click, by the holder of the booking link, binds. Then the line sends a fixed welcome as a reply in that conversation.

A code from a sender who already has an active host binding still links. The guest binding is separate (section 2), so a host can receive their guest notices in the same conversation.

Rejected: texting the guest first (refused by the line; junk banner; daily new-conversation allowance). Binding on arrival without the browser step (anyone holding a forwarded code could bind). A six-digit fallback (D16 removed it for hosts for the same reason).

### 2. Guest bindings

`requester_imessage_bindings`: `request_id`, `sender_hash` (keyed hash), `sender_ciphertext` and `space_ciphertext` sealed with the context `requester_imessage_binding:{id}`, `state` (`active`, `unlinked`, `ended`, `moved`), `moved_to_request_id`, `last_notified_at`, `last_inbound_at`, `ended_at`. Unique: one active binding per request. A sender may hold active bindings on several requests (one guest, several hosts).

The binding ends when the guest presses **Unlink iMessage** on the booking page (`unlinked`), or when the request is booked or withdrawn or 30 days after creation with the booking link's receipt window (`ended`). A guest's outbound message names its binding (`imessage_outbox.requester_binding_id`) and is suppressed once that binding is no longer active, as a host's is. When a revised request is created it moves (section 5), so the conversation follows the guest.

Rejected: a nullable `host_account_id` in `imessage_bindings`. That table's unique indexes make a sender belong to one host and a host have one binding, and its outbox suppresses host-private rows after unlinking. A guest row there would either break those indexes or inherit rules written for hosts.

### 3. Inbound routing

`processReceipt` keeps its first step: a link code goes to linking. After that, a message follows **the last message the line sent to that sender**:

1. **After a guest notice** (the request confirmation, an approval, a decline, an expiry) it goes to that request's requester discussion.
2. **After a host notice or reply** it keeps today's host path.
3. **With no earlier message from the line**, it goes to the host binding if there is one, else to the only or most recently created guest binding.
4. **With no binding**, the existing unlinked reply (host-imessage-channel D10).

The "last message" is read from the outbox rows sent to the sender's hash, guest and host alike. Switching to another conversation uses the host iMessage channel's conversational selection (owned by the host-side iMessage work, not yet written; until it lands, `request <ref>`). A host's own guest requests are reachable from the host conversation only with a linked host profile with the iMessage item (section 6).

A misroute stays inside one person's conversations, and approvals and declines need an explicit decision (`imessage-commands.ts`), so free text sent to the wrong side decides nothing.

Forwarded guest text is stored as `[iMessage] …` in the requester discussion (as host-imessage-channel D11), under the same redaction, admission and model limits as web and email input. The reply is the turn's final assistant text, sent through the outbox. The requester instructions say that iMessage shows no cards, so the assistant names the card and says it is on the booking page.

A closed request's binding goes to section 5 (revised request) or answers with the fixed closed notice, at most once per binding.

### 4. Guest notices

`enqueueStatusNotice` and `enqueueConfirmations` gain an iMessage branch. When the request has an active guest binding, or a host profile with the iMessage item, one `imessage_notice` job is recorded per event in the same transaction. The job freezes the text from the event's records into `imessage_outbox`.

The text is short: what happened, the time with its named timezone, and what to do next. It never carries the booking link, any host note, any rule or any reason; it says the link is in their email. Delivery failure and uncertainty follow host-imessage-channel D9 and never change request state. Email stays the authoritative notice and still carries the link ([email delivery](../../specs/email-delivery/spec.md#requirement-requester-status-notifications)).

### 5. Revised requests

**Trigger.** The bound guest's next message in the email thread or iMessage conversation of a request that closed as **declined** or **expired**. Booked and withdrawn requests keep the closed notice (O1, O4).

**Creation.** In one transaction with the receipt's job:

- The host must still be active and ready, the closed request must have no revised request yet (`requests.revised_from_request_id` is unique, so a retried receipt or a reply in a second channel creates nothing more), the chain from the first request must hold fewer than 10 requests, and the creation bounds (Phase 3 D7) must admit it, counted per keyed hash of the contact address. No per-minute limit is added: a revised request needs its predecessor declined or expired, so each one costs the host a decision or a lapse.
- The new request is identified at once. It carries over purpose, duration, mode, place or link plan, travel mode, timezone, language, requester name and contact email, plus the contact's confirmed state when the address is the same. It carries no windows, evaluations, proposals, agreements or approvals.
- A new `bookingId` is created, and the creation email sends its booking link to the contact.
- The channel binding moves: the email thread is re-bound to the new request, or the guest binding is marked `moved` and a new active binding is created on it.

**Refusal.** When the host is unavailable, the chain is full, or the bounds refuse, the channel gets one fixed text, and nothing is created.

**Context (D6).** The revised discussion starts with an authored application message, shown as a quiet note like the pre-D13 intake summary. It gives the earlier request's purpose and details and says whether "the host declined" or "the request expired". It never includes the host's notes, rules, exception reasons or private discussion. The guest's message follows as the first input, so the assistant asks for new times.

**Host view.** `/app` and the host's iMessage summary for the new request say that it follows their earlier decline or the earlier request's expiry, with the earlier request's reference.

Rejected: reopening the closed request (breaks the closure guard and replay safety). Copying the earlier times (they failed or lapsed). One revised request per first request (a guest could not try again after a second decline). A per-minute limit (the predecessor's closure already paces creation).

### 6. Host profile for a guest who is a host

**Match (D7).** `createGoogleCallbackHandler` in `requester-google.ts` already verifies the ID token. With the raw `sub`, it looks up `google_identities`. The match counts only when the account is `active`, has confirmed `host_settings`, and is not the request's host. Only the host account's ID is kept for the next step; the subject itself is not stored with the request.

**Card.** On a match the thread's next open card is **Use your host settings for this request**. It lists four checked items with one line each, followed by **Use these settings** and **Not now**:

- Calendars: "Check your busy time on the calendars you use as a host."
- iMessage: "Send this request's updates to your linked iMessage." Shown only with an active host binding.
- Preferences: "Prefer your weekly hours and weekly limit. They never remove a time."
- Basic details: "Fill in your time zone, language and travel mode."

It is one card, consistent with "one thing at a time". **Not now** records the choice so the card does not return; **Change** on its receipt reopens it.

**Record.** `requester_host_profiles`: `request_id` (primary key), `host_account_id`, `items text[]`, `decided_at`. It is deleted when the request closes or is deleted, in the same transaction that deletes requester grants. Nothing about the guest-host reaches the request's host, their projection or their model context; the requester projection says only which items are in use.

**Calendars (D8).** `evaluation.ts` reads busy intervals for the requester side from the guest-host's calendars with the conflict role (`calendar_roles`), using the guest-host's provider grant, inside the evaluation. Events are never stored or shown, as for requester calendars today. A failed or revoked grant clears the item, shows **Connect Google Calendar** and pauses dependent evaluation. A request-bound requester grant, when present, wins.

**iMessage.** With the item, guest notices go to the host binding's conversation (section 4), and the routing in section 3 step 1 applies.

**Basic details.** They are applied through the existing review path, as a pending review the guest applies, so nothing changes without the guest's action. The Google-verified address is already handled by Phase 3.

Rejected: matching by email address (not an identity); applying without the card; creating a session or signing the guest in as the host; copying the host's refresh token into `requester_grants` (duplicates a credential and breaks delete-only bookkeeping).

### 7. Soft guest preferences

`FeasibilityInput` gains `requesterPreferences: { weeklyWindows, timezone, weeklyLimit, weekCounts } | null`. Step 4 of the engine (ordering) gains two keys after the host's weekly-limit key: inside the guest's weekly windows first, then weeks below the guest's weekly limit first. Week counts come from the same counting the host's limit uses, applied to the guest-host's account.

Neither key removes a candidate, gates evaluation, or shows a private exception control, unlike the host's limit when every week is full ([weekly meeting load preference](../../specs/meeting-feasibility/spec.md#requirement-weekly-meeting-load-preference)). Buffers are not applied. The explanation sentences are visible only to the guest: "Inside your usual hours", "In a week below your limit".

### 8. Screens

Every guest screen moves to ink (U4): the host page's guest thread (`/{handle}`) and the booking page (`/booking/[bookingId]`), with their cards, receipts, buttons and inputs.

**On top of the app-wide migration.** A teammate is moving the whole app to ink: `globals.css`'s role tokens and the theme tests, the work PR #42 left for later. The guest cards (`GuestCard`, `GuestReceipt` in `_components/guest/guest-card.tsx`) and `components/ui` take their colors from those role tokens (`bg-card`, `border-border`, `text-muted-foreground`), so they turn ink with that change. `GuestCard` is also used by host screens (`_components/host/host-requests.tsx`, `host-request-cards.tsx`).

**This change's part.** It does not set tokens or restyle the shared parts. It reviews the guest screens on the migrated base and adjusts only guest-specific markup and layout where they still look Thyme or break. A fix that belongs in a shared part goes to the teammate's change, so the shared cards keep one look. Group 8 starts after that migration is merged.

**New cards.** **Get updates in iMessage**, its link step and connected state, and the host-profile card are built on `GuestCard` like every other guest card, in English and Korean with the existing `lang` cookie.

### 9. Tests

- **Unit:** routing order (section 3); code ownership; the revised-request carry-over and refusals; the profile match; soft ordering never removing a candidate.
- **Integration:**
  - linking and confirming;
  - notices to a guest binding and to a host binding with the item;
  - a declined request's email reply and iMessage reply each creating one revised request, with a retried receipt creating none;
  - the bounds and an unavailable host refusing;
  - a host profile's calendars feeding evaluation with no stored event;
  - deletion at closure.
- **E2E:**
  - **Continue with Google** and **Connect Google Calendar** against the fake consent server (PR #37's fix);
  - the host-profile card;
  - **Get updates in iMessage** with the loopback Photon stand-in.
- **Evals:** a guest in iMessage asking to "just book it" gets the card's name; a revised discussion leaks nothing from the earlier host-only context.

### 10. Changes until the host approves

Today agreement locks the request: in `awaiting_host_approval` a details review is refused (`request-reviews.ts`), so is re-evaluation (`request-proposals.ts`), and only withdrawal remains. D10 keeps the request changeable until the host approves.

**Command.** `request.change_agreement` (requester, expected revision) runs under the request lock on a request in `awaiting_host_approval` with no live booking. It moves the request to `negotiating` and advances the revision. The agreement row stays as history. From there the existing review, evaluation, candidate and agreement commands apply unchanged. A new agreement needs a new proposal version, because `request.agree` refuses an already agreed version.

**Race with approval.** Both commands take the request lock. If the host's approval commits first, the request is `booking` and the change is refused with the current status. If the change commits first, approval fails as stale: it checks the expected revision, `awaiting_host_approval` and an agreed latest version (`bookings.ts`, `approveCommand`). The host's pending iMessage approval notice is dropped by the notice job, which needs the same state and version (`imessage-notice-job.ts`).

**Screens and channels.** While awaiting approval, the times receipt (`Times · Chose …`) offers **Change**, which runs the command and reopens the candidate times. In email and iMessage, the assistant can take the guest there by naming the card. The requester tool text that says details cannot change while awaiting approval (`request-tools.ts`) now names **Change**. The host's `/app` card leaves the approval list. No separate host notice is sent for the change; the next agreement sends the usual approval notice for the new version.

## Risks / Trade-offs

- **Shared line volume.** Guests are inbound-first, so they spend no new-conversation allowance, but replies and notices add outbound volume on one line. Photon publishes no rate, so watch it in the outbox counts.
- **A host's conversation now carries guest notices.** Section 3's separate heading and references keep host-private and guest views apart. A misrouted message is the main risk, covered by the routing tests.
- **Reading the host grant for guest busy time** widens what that grant is used for. Mitigation: opt-in per request, the conflict role only, nothing stored, and deletion at closure. The team agreed to this use.
- **Revised requests could pressure a host who declined.** Mitigation: each needs a closed predecessor, the chain stops at 10, plus the creation bounds. O3 is open.
- **Change and agree again repeatedly** sends the host one approval notice per agreement. No limit is set now; watch the counts and add one if needed.
- **Routing depends on the host-side conversational selection**, which is not written yet. Until it lands, `request <ref>` is the switch.

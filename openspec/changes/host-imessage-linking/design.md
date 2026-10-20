# Design

## Context

See the [proposal](proposal.md) for scope and the [delta](specs/host-imessage-linking/spec.md) for behavior. The agreed screens live on `feat/web-onboarding-redesign` in the iteration-1 layout (`apps/web/src/components/thyme/{phone-step,verify-step,imessage-start,host-onboarding,phone-link}.ts(x)`, `apps/web/src/contracts/phone-link.ts`). They run against an in-browser demo linker; no server implements their contract yet. The iteration-1 Photon backend (#15) was merged into `dev`, not `main`, and returns neither `code` nor `wrongReplies`.

The retired `host-imessage-assistant` design (`git show e3c01d2:openspec/changes/host-imessage-assistant/design.md`) is design input: a database outbox with a separate sender, a signed webhook persisted before acknowledgment, and an `uncertain` outcome for a send that timed out after it began.

## Goals / Non-Goals

**Goals:** a server that implements the screens' contract unchanged; a binding that only the person holding the phone and the browser can create; durable handling of texts and replies across restarts; the spike evidence the transport choice needs.

**Non-Goals:** iMessage commands, proposal review, setup over iMessage and the contact card (later Phase 6 change); SMS or RCS transport; the `/home` content.

## Decisions

### 1. Keep the screens' contract

`lib/contracts/phone-link.ts` carries `phoneLinkSchema` as written: `status` (`pending`, `sent`, `uncertain`, `connected`, `failed`, `expired`), masked `phone`, 2-digit `code` or null, `expiresAt`, `retryEligibleAt` (null once no more texts are allowed), `failure` and `wrongReplies`. The routes are `POST`/`GET /api/host/imessage/connection`, `POST /api/host/imessage/connection/retry` and `POST /api/host/imessage/notify { channel }`. Error codes map as the screens expect: `invalid_input` → invalid number, `revision_conflict` → number taken. The screens poll `GET` every 2 seconds while waiting.

### 2. Server rules, from the screens and the demo linker

| Rule | Value |
|---|---|
| Number lifetime | 5 minutes from the text going out |
| Text spacing | No sooner than 1 minute after the previous text; an earlier request is accepted and held (`pending`) |
| Texts per window | 5 within 5 minutes; after that `retryEligibleAt` is null and the phone is put off |
| Earlier numbers | Stay valid until they expire or a wrong reply arrives |
| Wrong reply | Any reply in the conversation that matches no valid number: all numbers stop working, a new one is issued, `expiresAt` is unchanged, `wrongReplies` increases |
| Lockout | The third wrong reply fails the check with `too_many_wrong_replies` and sets `retryEligibleAt` 5 minutes ahead; a retry after it sends a new text and resets the count |
| Failure reasons | `non_imessage_recipient`, `provider_authentication`, `provider_rejected`, `too_many_wrong_replies`; other values show a generic message |

The 2-digit number is generated server-side, never equal to the number it replaces, and never placed in the outbound text.

### 3. What binds a number

A reply links the number only when all of these hold: the webhook signature verifies; the sender identifier equals the number the text went to, compared on the provider's sender field and never parsed from text; the conversation is the direct conversation the server opened and stored before sending; the reply body, trimmed, is exactly a currently valid number; the check has not expired or failed. A number already linked to another host is refused at `POST` (`revision_conflict`). Group conversations never bind.

The text proves the phone; the number shown only in the browser proves that the person at the phone is the person at the browser. That is why no **Confirm and link** step follows (D4).

### 4. Durable send and receipt

Following the retired design: `POST` and `retry` write the connection and an outbound job in one transaction and return without waiting for Photon. The sender stores the conversation and line identity before sending, so a fast reply can match even when the send result is lost. A send that times out after it began is `uncertain`: the screen treats it like `sent` (the number shows), and a matching reply connects it. The webhook verifies and persists the raw event before acknowledging, deduplicates on the provider message ID, and a separate processor applies it. The inbound reply is consumed before any model turn and its text is not stored in the transcript ([chat-workspaces](../../specs/chat-workspaces/spec.md) proof redaction).

### 5. Two starts and phone accounts

Google start: the number step is a state of `/app` after sign-in; the binding is to the signed-in host. iMessage start: the check runs before any account exists. A matching reply for a number no host holds creates an active host account whose sign-in identity is that number, and signs the browser in; for a number a host already holds, the same check signs that host in. The host links Google later for Calendar access. How the reply-verified number becomes a Supabase Auth session is open decision 2 and spike step 6; until it is settled, the server implements the signed-in path first and the iMessage start stays in demo mode.

### 6. Notifying when texting is back

`POST /api/host/imessage/notify` records the request. `sms` sends an iMessage to the number once a send to the line succeeds again; `email` writes to the signed-in host's Google address. The iMessage start offers only `sms`, since there is no email address before Google is linked.

## Trade-offs

- **Outbound-first deliverability (D1, D8).** Photon's [deliverability guidance](https://photon.codes/docs/best-practices/imessage-deliverability) states that a line opens at most 50 new conversations per day, that the first message a line sends to a new recipient counts as one, and that outbound-first conversations show Apple's "Report Junk" banner while inbound-first ones do not. Each new host costs one of the 50 and sees the banner on Thyme's first text. Resends to the same number stay in the same conversation and do not count again. Mitigations: the host has just asked for the text on screen; the host's reply starts the exchange Photon recommends; the later contact card removes the banner once saved. Record how many new conversations the line opens per day and put the phone off when the allowance is spent.
- **2-digit numbers.** A stranger who enters someone else's number makes Thyme text that person, who would need to reply with the exact number shown only on the stranger's screen. A random 2-digit reply matches about 1 time in 90, and three wrong replies lock the check. The worst case links the stranger's account to the other person's phone, which sends the stranger's summaries to that person and gives them no access to the stranger's host data without the web session. Unlinking and the spacing and window limits bound the harm.
- **Anonymous starts (D7, D10).** The iMessage start lets a visitor without an account make Thyme text any number and create an account. Per-source and per-number limits are needed before it leaves demo mode (open decision 1).

## Spike

Run on a controlled iPhone against a Photon project in production mode, and record the device, iOS and macOS versions and the Photon SDK version:

1. Open a direct conversation to a number that has never messaged the line and send a text. Record whether the first text shows the "Report Junk" banner and whether it counted toward the daily allowance.
2. Send to a number without iMessage. Record whether Photon reports it before or after sending, and with what error, so `non_imessage_recipient` can be set, or whether it falls back to SMS or RCS.
3. Reply from the iPhone. Record the exact sender identifier format, the conversation identifier, and whether they stay stable across a second text.
4. Interrupt a send (network cut, process kill) and record what the provider reports, to define `uncertain`.
5. Compare the native eve Photon channel with an application-owned webhook receiver on durable receipt, acknowledgment timing, exact sender identity and replay after restart, as the plan's Lane A requires.
6. On a personal Supabase project: whether a number verified by reply can become a Supabase phone user with a browser session (for example through the Send SMS hook holding the OTP and the server completing `verifyOtp` once the reply matches), and whether `linkIdentity()` with manual linking adds a Google identity to that user. Record what works; this decides open decision 2.

## Risks

- **Phase 2 ordering.** The shared project holds two migrations that are only on #22. Generate this change's migrations only on top of `main` after #22 merges.
- **Documents drift.** #22 edits seven of the documents this change edits; update them after #22 merges, or rebase this branch onto it.
- **iMessage reach.** Hosts without iMessage cannot link; web setup remains their path, as the screens already offer.

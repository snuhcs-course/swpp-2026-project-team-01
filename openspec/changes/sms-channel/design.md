# Design

## Context

See [proposal.md](proposal.md) for why. Three host channels and three guest channels already share one set of records (`imessage_receipts`, `imessage_links`, `imessage_bindings`, `requester_imessage_bindings`, `imessage_outbox`), one receipt-before-acknowledgment rule and one outbox with four send outcomes (`lib/server/photon.ts:14-26`). iMessage and WhatsApp arrive on `/photon/webhook`, signed by Spectrum, and are routed by platform (`lib/server/photon-receiver.ts:301`). Telegram arrives on its own route with its own secret (`lib/server/telegram-receiver.ts:90-120`) and calls the same `storeReceipt`. SMS follows the Telegram shape: its own route, its own verification and the shared store.

What Photon documents for SMS, read on 2026-11-26 from its Beta (2.0) docs, is thin:
- Sends go through `photon.projects.sendMessage` (TypeScript SDK) or the matching REST call. The call takes a project API key and an `Idempotency-Key`. A send is "accepted for asynchronous dispatch"; no delivery receipt is documented.
- Beta webhooks are Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`, `whsec_…`), registered per destination with `enabledEvents`. The SMS event type, platform value and sender format are not documented.
- Numbers are bought with `POST /v1/projects/{id}/platforms/sms/numbers`, `countryCode: "US"` only. A number costs $2 a month and becomes active about 15 minutes after purchase.
- Photon answers HELP, START and STOP (the 10DLC campaign form says so). What it does next is not documented: whether it blocks later sends or forwards the keyword.
- Nothing is said about recipients outside the US, segment size or SMS rate limits.

The spike of 2026-11-26 ([provider setup, Photon SMS](../../../documentations/technical_specification/03_provider_setup.md#photon-sms)) settled part of this:
- A send takes three calls: create or get the SMS users (our line is an `agent` user, the person a `human` user with a carrier lookup), create or get the `direct` space, then send.
- Delivery outcomes arrive as `message.delivered` and `message.failed` webhook events.
- `message.received` has an SMS variant with the same fields as the other platforms.
- Until a 10DLC campaign is assigned, the line is `blocked` (`SMS_CAMPAIGN_NOT_ASSIGNED`): a send to `+82` got `409 SMS_CAMPAIGN_NOT_ELIGIBLE`, and texts from a Korean and a US phone never reached the project.

Inbound shape on a live line, STOP forwarding and `+82` delivery after approval are still open. Task group 1 therefore keeps a spike against a real number. It fixes these unknowns before any other code; the specs do not depend on the unknown field names.

## Goals / Non-Goals

**Goals:**
- One more channel value through the existing records, receipts and outbox, with no new tables.
- Explicit, recorded SMS consent before any code that could start an SMS conversation.
- Cost bounded per recipient.

**Non-Goals:**
- Outbound-first messages, reminders sent without a prior inbound text, or marketing.
- MMS media: inbound media is ignored and only the text used; no pictures are sent (schedule images are answered in words).
- Short codes, toll-free numbers, more than one SMS number, or numbers outside Photon.
- Carrier delivery receipts.

## Decisions

### 1. Transport

A thin `fetch` client in `lib/server/photon-sms.ts`, not the Beta TypeScript SDK. The client only needs one send call and the error shape (RFC 9457 problems with `code`, `status`, `remediation`). The repository already wraps every provider behind `photonTransport` and the stand-in (`photon.ts:156-198`, `579-585`), so a client that posts to `{PHOTON_API_URL}/sms/messages` in tests and to the Beta endpoint in production fits that seam. The idempotency key is the outbox row ID, so a retried dispatch of the same row cannot double-send.
- Rejected: the Beta SDK as a dependency. It is pre-release, and it would be a second Photon client beside Spectrum 12.14.0.
- Rejected: eve's channel adapters, for the reasons of iMessage D1.

### 2. Webhook

`POST /photon/sms/webhook` in `agent/channels/photon-sms.ts`, verified with the `standardwebhooks` package over the raw body. The receipt's message ID is `sms:<webhook-id>`, and its webhook ID is `"photon-sms"`.
- Rejected: one route for both Photon schemes. Spectrum's `X-Spectrum-Signature` and Standard Webhooks sign different strings with different secrets, and Photon's docs warn against mixing them. Two routes keep each check simple and leave `/photon/webhook` untouched.
- If the spike shows Photon delivers SMS through the Stable Spectrum webhook instead, the parser moves behind `/photon/webhook`'s platform routing and the new route is dropped. That needs a spec revision before implementation: "SMS webhook" changes, and `host-imessage-channel` "No session for unlinked or group senders" (which drops every non-iMessage platform there) needs a MODIFIED delta.

### 3. Sender identity

The E.164 number from the event, hashed as `sms:<E.164>` like `whatsapp:<digits>` and `telegram:<id>` (`photon-receiver.ts:82-93`). Separate namespaces mean an iMessage binding and an SMS binding for the same phone are different senders. This is deliberate: proving one channel says nothing about the other. Group MMS (more than one other participant) is acknowledged and dropped, as group iMessage is.

### 4. Records

`sms` joins the `channel` checks in `imessage_receipts`, `imessage_links`, `imessage_bindings`, `requester_imessage_bindings`, `imessage_outbox` and `channel_usage_days`, and the array in `channel_usage`. `imessage_links` gains `sms_consent_version text` and `sms_consent_at timestamptz`, with a check that both are set when `channel = 'sms'`. Because link attempts are deleted 30 days after they end (`cleanup_imessage_records.sql:54-56`), proof of opt-in lives in a new `sms_consents` table: sender hash, `role` (host or guest), binding ID, consent version and time, `ended_at` and `ended_reason` (`unlinked`, `opted_out`, `replaced`, `blocked`). A row is written in the binding's transaction and closed when the binding ends. The cleanup job deletes it four years after `ended_at`, the usual retention for TCPA consent records. It holds no number, only the hash, so it cannot be used to message anyone. The Telegram-only outbox checks (buttons, `edit_markup`) already exclude other channels and need no change. All of this goes through pg-delta in one migration.

### 5. Linking and consent

The SMS card reuses the consent checkbox and text of #488 (`copy.ts` `smsConsent` on PR #492, kept word for word with the campaign), but not `NumberForm`: SMS needs no number, because the sender's number arrives with the code. The sequence everywhere is **Connect SMS** (or **Get updates by text**) → the checkbox → **Get my code** → the code with **Open Messages**, or on a computer the number, code, **Copy** and QR code. The server refuses an SMS attempt without the consent version, so a crafted request cannot skip the box. The version is a short hash of the consent text, so changing the wording changes what is recorded. The deep link reuses `deepLinkFor` (`lib/contracts/imessage.ts:142-147`) with `PHOTON_SMS_NUMBER`.

The landing's `/?flow=sms` follows the iMessage start before sign-in (`fmat_imessage_start` cookie, binding at sign-in per `link-on-code` D5), with the same consent gate. The consent travels from the attempt to the binding and its `sms_consents` row.

The requester agent's `start_updates_link` cannot point at an attempt for SMS, because no attempt may exist before consent. Today `/connect/link/<token>` seals an existing `linkId` (`lib/server/connect-link-routes.ts:23`). For SMS the token instead seals `{ requestId, channel: "sms" }`. The page shows the checkbox, and **Get my code** creates the guest attempt under the request's usual limits. The token expires as link tokens do, and a token for a closed request shows nothing.
- Rejected: asking for the number first, as iMessage shared lines need. Photon SMS numbers have no shared-user list, and an extra field would make 10DLC read the number as required next to the box (rejection 803).
- Rejected: implied consent by texting the code alone (keyword opt-in). The campaign describes a web-form opt-in, and carriers check that the description matches.

### 6. Channel offered by device

Android without WhatsApp moves from Telegram to SMS, because SMS needs no app or account. Every device lists SMS among its switches. The table in `messaging-channel.ts:100-104` gains `sms`, ordered after WhatsApp on Android and last elsewhere. `ConfiguredChannels` gains `sms: PHOTON_SMS_NUMBER` when the API key and webhook secret are also set.

### 7. Keywords and opt-out

Opt-out keywords are checked on the receipt before any command or model turn, in the same place guest STOP is detected today (`imessage-receipts.ts:544`). That check runs only when the sender is not a host (`:544-558`). For SMS it runs for every sender and ends host and guest bindings together, because Photon blocks the whole number. On SMS, `stop`, `unlink` and `help` from `imessage-commands.ts` run their effects but suppress their replies, so recipients never get two answers. Because Photon may or may not forward STOP to the webhook (the spike checks), the outbox also ends the binding on a send refused as opted out. Either path alone is enough. Re-linking after STOP needs a new code: Photon's START reply re-subscribes the number on Photon's side, but the service does not rebind silently.

### 8. Delivery outcomes

The mapping in the proposal (D10) goes in `photon-sms.ts` beside `whatsAppSendFailure` (`whatsapp.ts:202`). The spike records the real problem `code` values for opted-out, invalid and unsupported-country recipients, and the mapping uses those codes, not message text. `blocked` already ends bindings in the outbox (`imessage-outbox.ts:645-653`).

### 9. SMS limits

The daily cap is counted from `imessage_outbox` rows on `channel = 'sms'` for the recipient hash over the last 24 hours, so no new table is needed. At the cap, the row about to dispatch is rewritten to the fixed limit notice, and later rows that day are `suppressed`. The 480-character guidance lives in the SMS section of the host and requester instructions. Replies are not truncated in code, because cutting a proposal mid-sentence would be worse than a long text. The cap counts every outbound SMS row to the recipient hash that reached `accepted` or `uncertain` in the last 24 hours, the limit notice included. The row that would bring the count to the cap becomes the notice, unless a notice went out in the last 24 hours, in which case it is `suppressed`.

### 10. Decisions by SMS

On iMessage, WhatsApp and Telegram the sender ID comes from an authenticated account, so approval in the host's own words is safe. SMS caller ID can be forged, especially from abroad, and a forged "yes, book it" would create a real calendar event for the host and the guest. On SMS, `approve_proposal` and `decline_request` therefore require the current reference in the inbound text: the exact command, or the host's words containing the reference. The reference is sent only to the bound number, so a forger would also need to read the host's texts. The check sits in the tool layer, keyed on the turn's channel, so the model cannot bypass it.
- Rejected: a one-time PIN per decision. It adds a step to every approval, and the reference already works as one.
- Rejected: approval in words as on other channels. It is the cheapest attack on the product's core action.

## Risks / Trade-offs

- [The SMS event shape, opt-out behavior and country support are undocumented] → Task group 1 is a spike on a real number, and its findings go in provider setup before implementation starts. If Photon cannot send to `+82`, D7 still holds: the outcome is reported, and the decision log records it for the team.
- [10DLC approval may take weeks or be rejected] → The channel ships disabled until `PHOTON_SMS_NUMBER` is set. Nothing else depends on it.
- [Cost: every Thyme reply is billed per segment] → The per-recipient daily cap, the short-reply instruction and production-only messaging bound it.
- [Caller ID spoofing] → Decisions need the reference (section 10). A forged non-decision text can still reach Thyme and get a reply sent to the real host, which costs one SMS and reveals nothing the host doesn't already have.
- [SMS is readable by carriers] → The user chose full content (D11). The card says so before the code, and the privacy notice names Photon as the SMS carrier (#492).
- [Two Photon signing schemes in one service] → Separate routes and secrets; tests cover a Spectrum-signed request to the SMS route and the reverse, and both are refused.

## Migration Plan

1. Merge with `PHOTON_SMS_*` unset: SMS is not offered anywhere, and the migration only widens checks.
2. The user buys the number, creates the project API key and the Beta webhook destination, and sets the three variables on Production once 10DLC is approved.
3. Run the real-device checks (task group 7).
4. Rollback: unset `PHOTON_SMS_NUMBER`. Existing SMS bindings stop receiving messages, because the outbox refuses an unconfigured channel as `unavailable`. The widened checks can stay.

## Open Questions

- Whether Photon forwards STOP/HELP/START to the webhook. Section 7 works either way, and the spike records which.
- Photon's per-message SMS price. The plans page was not read. This may change the default daily cap, but not the design.

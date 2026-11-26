# Design

## Context

See [proposal.md](proposal.md) for why. Three host channels and three guest channels already share one set of records (`imessage_receipts`, `imessage_links`, `imessage_bindings`, `requester_imessage_bindings`, `imessage_outbox`), one receipt-before-acknowledgment rule and one outbox with four send outcomes (`lib/server/photon.ts:14-26`). iMessage and WhatsApp arrive on `/photon/webhook`, signed by Spectrum, and are routed by platform (`lib/server/photon-receiver.ts:119-123`). Telegram arrives on its own route with its own secret (`lib/server/telegram-receiver.ts:90-120`) and calls the same `storeReceipt`. SMS follows the Telegram shape: its own route, its own verification and the shared store.

[SMS Gate](https://docs.sms-gate.app/) (capcom6/android-sms-gateway, Apache-2.0) turns an Android phone into an SMS gateway. In cloud mode:
- **Sends.** The service posts to `https://api.sms-gate.app/3rdparty/v1/message` with Basic or JWT credentials. The cloud pushes the message to the phone, which sends it from its own SIM. Long texts are split into parts automatically.
- **Events.** The phone posts events to our webhook: `sms:received`, `sms:sent`, `sms:delivered` (once per part), `sms:failed`, `system:ping`, `app:started`, and others.
- **Signing.** Each event carries `X-Signature` (hex HMAC-SHA256 of the raw body followed by `X-Timestamp`), under a key set in the app.
- **Retries.** A failed delivery is retried with backoff from 10 seconds, 14 times by default (about two days). Our route must answer `2xx` within 30 seconds.
- **The `sms:received` payload.** `{ event, id, webhookId, deviceId, payload: { messageId, message, sender, recipient, simNumber, receivedAt } }`. `sender` is not guaranteed to be E.164, and `receivedAt` carries the phone's local offset.
- **Encryption.** An optional end-to-end mode encrypts text and numbers before they reach the cloud.

Read on 2026-11-26 from SMS Gate's README, API and webhook docs. The docs say nothing about Korean carriers, so task group 1 tests a real Korean SIM before any other code.

## Goals / Non-Goals

**Goals:**
- One more channel value through the existing records, receipts and outbox, with no new message tables.
- Explicit, recorded SMS consent before any code that could start an SMS conversation.
- Cost and carrier throttling bounded per recipient and per phone.
- Truthful behavior when the phone is off: nothing offered and nothing lost.

**Non-Goals:**
- Outbound-first messages, reminders sent without a prior inbound text, or marketing.
- MMS media: inbound media is ignored and only the text used, and no pictures are sent.
- More than one phone or SIM. SMS Gate supports several, so this can come later without a spec change to the behavior.
- Self-hosting SMS Gate's server (the private-server mode). The cloud relay sees only ciphertext with end-to-end encryption on.

## Decisions

### 1. Transport

A thin `fetch` client in `lib/server/sms-gate.ts`, behind the same transport seam as `photonTransport` (`photon.ts:156-198`, `579-585`). It posts `{ id: <outbox row id>, textMessage: { text }, phoneNumbers: [<E.164>], withDeliveryReport: true }`, encrypted in end-to-end mode. Whether a repeated ID is rejected or deduplicated is not documented. The spike checks it. Until then the outbox's existing rule carries idempotency: a send whose answer was lost is uncertain and never resent.

In cloud mode webhooks are registered through the API (`POST /3rdparty/v1/webhooks`, one event per registration), not in the app. `npm run sms:webhooks` registers `sms:received`, `sms:sent`, `sms:delivered`, `sms:failed`, `system:ping` and `app:started` against `/sms/webhook` and lists the result. End-to-end encryption needs the device ID and its public key, so `SMSGATE_DEVICE_ID` is set and the key fetched for it is pinned at setup. Tests point `SMSGATE_API_URL` at a loopback stand-in.
- **Rejected: Photon SMS.** It is US-only, blocked until a 10DLC campaign is approved, and refused `+82` in the spike.
- **Rejected: Korean SMS APIs (Solapi, NHN Cloud).** Sending works after sender-number registration, but none offers inbound texts by webhook, and the channel is conversational.
- **Rejected: TextBee.** Its webhook security is the cleanest (timestamped signature, idempotency key), but it is AGPL and has no end-to-end encryption, so its relay would read every message.
- **Rejected: httpSMS.** It has AES-256 end-to-end encryption, but its webhook signing and limits could not be confirmed.
- **Rejected: SMS Gate's local mode.** It needs the service to reach the phone, which sits behind mobile NAT.

### 2. Webhook

`POST /sms/webhook` in `agent/channels/sms.ts`. It verifies `X-Signature` over the raw body and `X-Timestamp` in constant time, rejecting timestamps more than 300 seconds old, then dispatches by `event`:
- **`sms:received`:** store a receipt (message ID `sms:<id>`, webhook ID `"sms-gate"`) through `storeReceipt`, then answer `200`.
- **`sms:sent`, `sms:delivered`, `sms:failed`:** update the outbox row named by `payload.messageId` (our row ID) and answer `200`. These events never resend anything.
- **`system:ping`, `app:started`:** update gateway health (section 11).
- **Anything else:** `200`, ignored.

A webhook ID or signing key that is not configured gives `404`, as on `/photon/webhook`. Because SMS Gate retries for about two days, the route stores first and processes in the receipt job, keeping well inside the 30-second answer limit.

### 3. Sender identity

`sender` is normalized with the same parser as the number forms. A leading `+` is kept. A national number starting with `0` is read as Korean, because the SIM is Korean. Anything unparsable is dropped, and the event is acknowledged. The result is hashed as `sms:<E.164>`, like `whatsapp:<digits>` and `telegram:<id>` (`photon-receiver.ts:82-93`), so an iMessage binding and an SMS binding for the same phone are different senders. SMS Gate may send `recipient` as null. A null recipient counts as the configured SIM. A set one is normalized and compared, and an event for another SIM in the phone is acknowledged and dropped.

### 4. Records

- **Channel checks.** `sms` joins the `channel` checks in `imessage_receipts`, `imessage_links`, `imessage_bindings`, `requester_imessage_bindings`, `imessage_outbox` and `channel_usage_days`, and the array in `channel_usage`.
- **Consent on attempts.** `imessage_links` gains `sms_consent_version text` and `sms_consent_at timestamptz`, with a check that both are set when `channel = 'sms'`.
- **`sms_consents`.** Link attempts are deleted 30 days after they end (`cleanup_imessage_records.sql:54-56`), so proof of opt-in lives in this new table:
  - columns: sender hash, `role` (host or guest), binding ID, consent version and time, `ended_at`, and `ended_reason` (`unlinked`, `opted_out`, `replaced`, `failed`);
  - a row is written in the binding's transaction and closed when the binding ends;
  - the cleanup job deletes it four years after `ended_at`;
  - it holds no number, only the hash.
- **Delivery events.** If the existing outbox columns cannot hold them, `imessage_outbox` gains `delivered_at` and `delivery_failure`.
- **Gateway health.** A one-row `sms_gateway_health` table holds `last_seen_at` and `device_id`.

All of this goes through pg-delta in one migration.

### 5. Linking and consent

The SMS card reuses the consent checkbox and text of #488 (`copy.ts` `smsConsent`), but not `NumberForm`: SMS needs no number, because the sender's number arrives with the code. The sequence everywhere is **Connect SMS** (or **Get updates by text**), then the checkbox, then **Get my code**, then the code with **Open Messages**. On a computer the last step shows the number, code, **Copy** and a QR code instead.

The server refuses an SMS attempt without the consent version. The version is a short hash of the consent text. The deep link reuses `deepLinkFor` (`lib/contracts/imessage.ts:142-147`) with `SMS_NUMBER`.

The landing's `/?flow=sms` follows the iMessage start before sign-in (the `fmat_imessage_start` cookie, binding at sign-in per `link-on-code` D5), with the same consent gate.

The requester agent's `start_updates_link` cannot point at an attempt, because none may exist before consent. Today `/connect/link/<token>` seals an existing `linkId` (`lib/server/connect-link-routes.ts:23`). For SMS the token seals `{ requestId, channel: "sms" }` instead, and **Get my code** creates the guest attempt.

### 6. Channel offered by device

The user's rule: Apple devices get iMessage, and every other device gets SMS. In `messaging-channel.ts:100-104` the `OFFERED` table becomes:
- **apple:** iMessage, then the others;
- **android and other:** SMS first when it is configured, then the earlier order (WhatsApp, Telegram).

"Other computers ask which app" now applies only when SMS is not configured. `ConfiguredChannels` gains `sms: SMS_NUMBER` when the credentials and signing key are also set and the gateway is healthy (section 11).

### 7. Keywords and opt-out

No provider handles keywords, so the service does. Keywords are checked on the receipt before any command or model turn, where guest STOP is detected today (`imessage-receipts.ts:544`). That check runs only for non-hosts (`:544-558`). For SMS it runs for every sender and ends host and guest bindings together, because the person texting stop means the number.

The replies are fixed texts that name the brand:
- **Opt-out:** confirmation of the unlink, and how to link again.
- **HELP:** the support address and how to stop.
- **START:** how to link again from findmeatime.com. The service does not rebind silently.

Each reply is sent at most once a day per sender, also to senders with no binding. Keyword replies bypass the per-recipient cap, so a capped person can still stop, and count toward the per-phone cap. The command words `stop`, `unlink` and `help` in `imessage-commands.ts` route to the same handlers on SMS.

### 8. Delivery outcomes

The mapping in D10 goes in `sms-gate.ts` beside `whatsAppSendFailure` (`whatsapp.ts:202`). The send call decides the outcome. Later events only annotate an accepted row:
- **`sms:delivered`:** sets `delivered_at` (once per part; the first one wins).
- **`sms:failed`:** sets `delivery_failure` with the reason.

A failure reported by event never resends, because the text may have partly gone out. A failure that says the number cannot receive SMS ends the binding with reason `failed`. The spike records which reasons those are.

### 9. SMS limits

**Per recipient.** The cap counts outbound SMS rows to the recipient hash that reached `accepted` or `uncertain` in the last 24 hours, the limit notice included. The row that would reach the cap becomes the notice, unless a notice went out in the last 24 hours; then it is `suppressed`.

**Per phone.** The phone-wide hourly cap protects the SIM from carrier throttling or suspension. It is set from the plan's real limit found in task 1.2.

**Waiting without failing.** Today an `unavailable` send spends one of `SEND_ATTEMPTS = 5` (`imessage-outbox.ts:86`, `675-682`), and `onExhausted` (`690-697`) fails the row. An hour-long outage would therefore lose messages. SMS rows that are unavailable because of the phone cap or a stale gateway are parked instead: they get a `not_before` time and keep their attempt count, so they wait as long as needed and are released by the next heartbeat or the next free slot. The app's own send-rate limit is a second guard set on the phone.

**Length.** Korean text uses UCS-2, so a segment is 70 characters. The 480-character guidance therefore means about seven segments for Korean. The spike checks how the carrier joins them. Replies are not truncated in code.

### 10. Decisions by SMS

On iMessage, WhatsApp and Telegram the sender ID comes from an authenticated account, so approval in the host's own words is safe. SMS caller ID can be forged, especially from abroad. A forged "yes, book it" would create a real calendar event for the host and the guest.

On SMS, `approve_proposal` and `decline_request` therefore require the current reference in the inbound text: the exact command, or the host's words containing it. The reference is sent only to the bound number. The same rule covers every state-changing action that `channel-actions-in-words` moves into words: `decline_request`, `share_changes`, `dismiss_changes` and `confirm_settings`, plus settings changed in words. The check sits in the tool layer, keyed on the turn's channel, so the model cannot bypass it.

Two risks are accepted. First, a forged text can still reach Thyme. Plain words the host's conversation forwards into a guest's shared discussion are not gated, so a forger could post as the host there. Second, a forged `STOP` unlinks the host, who links again in a minute. Gating plain conversation would make the channel unusable, and both risks need someone who already knows the host's number.
- Rejected: a one-time PIN per decision. The reference already works as one.
- Rejected: approval in words, as on the other channels. It is the cheapest attack on the product's core action.

### 11. Gateway health

The phone sends `system:ping` periodically (the interval is set in the app), and `app:started` on launch. Each one updates `sms_gateway_health.last_seen_at`.

While `last_seen_at` is older than `SMS_GATEWAY_STALE_MINUTES`:
- `configuredChannels` reports SMS as unavailable, so no new SMS link is offered (existing bindings stay);
- the outbox treats SMS sends as unavailable and requeues them;
- operational diagnostics report the gateway as stale.

When pings resume, the queue drains under the caps. Messages the cloud already accepted while the phone was off are the cloud's to deliver. The spike checks how long it keeps them (`ttl`).

## Risks / Trade-offs

- **[One phone is a single point of failure]** → Health gating keeps the product honest: SMS is not offered and nothing is lost while the phone is off. The phone stays on a charger with Wi-Fi and mobile data. A second phone is a later step that SMS Gate supports.
- **[The carrier may throttle or suspend a SIM that sends automated texts]** → Per-phone and in-app rate limits, no outbound-first or marketing texts, and every text answers someone who opted in. Use a plan that allows unlimited texting, and watch `sms:failed` reasons.
- **[The phone number is a person's SIM]** → Use a dedicated SIM for the service, never a team member's personal number.
- **[Caller ID spoofing]** → Decisions need the reference (section 10). A forged non-decision text can still reach Thyme and get a reply sent to the real host. That costs one SMS and reveals nothing the host doesn't already have.
- **[SMS is readable by carriers and the relay is trusted]** → The user chose full content (D11). The card says so before the code. SMS Gate's end-to-end mode protects sends in normal operation, but its key distribution trusts the server. Inbound texts never pass through the relay. The privacy notice names SMS Gate and the carrier.
- **[The phone keeps its own copies]** → Android's message app and SMS Gate's local log keep texts beyond the 30-day rule. Task 1.2 turns off or limits SMS Gate's local history and sets the message app to delete old threads, and the privacy notice names the device.
- **[Korean regulation and carrier terms]** → These are transactional texts in reply to people who opted in, so advertising rules should not apply, and sender pre-registration targets internet sending services. Personal plans often cap daily sends even when texting is "unlimited", and exclude international SMS, which limits D7; task 1.2 checks the plan. Relaying a service's messages over a subscriber line may also conflict with the carrier's terms or the Telecommunications Business Act's rule against letting others use a line. The user accepted that risk on 2026-11-26 for this course project, whose few test users opt in themselves; a public launch would move to a business line or an SMS API provider.
- **[Webhook from a phone on mobile data]** → SMS Gate retries for two days, and receipts are idempotent by event ID.

## Migration Plan

1. Merge with `SMS_NUMBER` unset. SMS is not offered anywhere, and the migration only widens checks and adds tables.
2. The user sets up the phone: SMS Gate in cloud mode, end-to-end encryption, the webhook URL and signing key, the ping interval and the send-rate limit. Then they set the Production variables.
3. Run the real-device checks (task group 7).
4. To roll back, unset `SMS_NUMBER`. Existing SMS bindings stop receiving messages, because the outbox treats an unconfigured channel as unavailable. The widened checks and new tables can stay.

## Open Questions

- SMS Gate's handling of a repeated message `id`, and its cloud `ttl` while the phone is off. The spike records both, and neither changes the design.
- The exact `sms:failed` reasons Korean carriers produce. The spike records them for the D10 mapping.

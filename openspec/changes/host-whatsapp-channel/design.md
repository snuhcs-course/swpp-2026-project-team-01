# Design

## Context

See [proposal.md](proposal.md). This change adds a second host messaging channel to the one Phase 6 built. The pieces it reuses are those of [`host-imessage-channel`](../host-imessage-channel/design.md):

- the signed receiver at `POST /photon/webhook` (`lib/server/photon-receiver.ts`), its durable receipt and `imessage_receipt` job;
- link attempts and bindings (`lib/server/imessage-links.ts`), the receipt processor with ordering, admission deferral and the binding lock (`lib/server/imessage-receipts.ts`), exact commands (`lib/server/imessage-commands.ts`), summaries (`lib/server/imessage-notices.ts`) and the outbox with its `imessage_send` job (`lib/server/imessage-outbox.ts`);
- the transport module `lib/server/photon.ts`, which alone talks to Photon, with the loopback stand-in at `PHOTON_API_URL` behind the messaging gate;
- the linking card and the link step in `/app`, and the landing's start before sign-in.

Photon delivers every platform enabled on the project to the one registered webhook. On 2026-11-02 WhatsApp Business was enabled on the production project next to iMessage. PR #63 (issue #62) made `inboundMessage` return `null` unless every platform field names iMessage, so today WhatsApp events are acknowledged and dropped.

Sources read for this design on 2026-11-02: `@spectrum-ts/whatsapp-business` 12.14.0 (`dist/index.js` and `index.d.ts`), Photon's [webhook event reference](https://photon.codes/docs/webhooks/events.md), the [WhatsApp Business provider pages](https://photon.codes/docs/spectrum-ts/providers/whatsapp-business.md), the [WhatsApp templates kit page](https://photon.codes/docs/advanced-kits/whatsapp/templates.md) and the [WhatsApp Business number page](https://photon.codes/docs/beta/messaging/whatsapp-business.md). No WhatsApp message was sent or received; capturing a real event is blocked on the user.

## Goals / Non-Goals

**Goals:** an Android host links their WhatsApp in two taps and one browser confirmation; a linked host does in WhatsApp everything a linked iPhone host does in iMessage; a WhatsApp event can never act on the iMessage side or the reverse; the 24-hour window never causes a silent loss, and nothing private leaves in a template.

**Non-goals:** requester WhatsApp; personal (non-Business) WhatsApp; WhatsApp groups; SMS, RCS or KakaoTalk; service-initiated first messages and their authentication templates; interactive buttons and lists (commands stay typed text); media; linking both channels at once; renaming the `imessage_*` tables.

## Decisions

### 1. Transport

The provider package is `@spectrum-ts/whatsapp-business` 12.14.0, platform ID `whatsapp_business`, published beside `@spectrum-ts/imessage` with the same version. It has two configurations:

- *direct*: `accessToken`, `phoneNumberId` and `appSecret` from Meta;
- *cloud*: no arguments, using the `projectId` and `projectSecret` passed to `Spectrum()`. The provider calls Photon's `issueWhatsappBusinessTokens`, discovers every WhatsApp line the project owns and renews the tokens on a schedule.

Cloud mode is chosen (D1). The project already has `PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET`, and Photon holds the Meta credentials, so no Meta token reaches our environment. The transport adds the provider to the existing dynamic import: `Spectrum({ projectId, projectSecret, providers: [imessage.config(), whatsappBusiness.config()], telemetry: false })`. A send resolves the space with `whatsappBusiness(app).space.create(await user(waId))`, whose ID is the contact ID itself (the provider supports only one-to-one spaces), and calls `space.send(text)` or `space.send(whatsappTemplate({ name, languageCode, bodyParams }))`. With several lines the provider sends from its first client, so the project keeps one WhatsApp line.

The WhatsApp number is a Photon SMS number registered for WhatsApp Business through Photon; Photon's iMessage numbers are not eligible, so it differs from the iMessage line. `PHOTON_WHATSAPP_NUMBER` holds it as digits for the card and the `wa.me` link.

eve has no native WhatsApp channel, and the reasons iMessage D1 rejected a native channel apply equally, so the adapter stays application-owned.

### 2. Receiver routing

`receivePhotonWebhook` keeps its order: configuration, the raw body within 64 KiB, the webhook ID and the signature, then the payload. Only the payload step changes:

1. `inboundMessage(payload)` (unchanged since PR #63) returns an iMessage message or `null`.
2. If it returned `null`, `inboundWhatsAppMessage(payload)` returns a WhatsApp message or `null`.
3. Only a non-null result is stored, as a receipt with its `channel`.

`inboundWhatsAppMessage` applies the PR #63 rule in reverse. It collects `message.platform`, `space.platform`, `message.space.platform` and `message.sender.platform`. It requires at least one of them, and every one present must normalize to `whatsappbusiness`: lower-case it and keep only letters and digits, so `whatsapp_business`, `WhatsApp Business` and `whatsappBusiness` all match. An unlabelled event, or one that mixes platforms, matches neither parser and is acknowledged with nothing stored. The exact spelling Photon writes is checked against a captured event at the join, and the parser's tests keep the spellings above.

Rejected: widening `isIMessageEvent` to accept WhatsApp and branching later. One parser per platform keeps the iMessage path unchanged, which PR #63 tests, and makes a platform mix-up impossible past the receiver.

### 3. Sender identity

The provider maps each inbound WhatsApp message to `sender: { id: msg.from }` and `space: { id: msg.from }`. Photon's documentation calls this "the WA contact id" and shows `15551234567`: the international number, digits only, no `+`. `normalizeWhatsAppSender`:

- strips one leading `+` and then requires `^[1-9][0-9]{7,14}$`; anything else is not a sender;
- requires `space.id` to normalize to the same value, and `space.type` to be absent or `dm`, so a group or a mismatched space never counts;
- never parses a number from the message text.

The hash is the existing keyed hash over `whatsapp:<digits>`; iMessage hashes stay over the bare sender, so no stored hash changes. One phone number in both apps therefore gives two unrelated hashes. The sealed sender (context `imessage_binding:{id}`, unchanged) is what replies use. The masked display is the last four digits.

### 4. Records

Each of the four tables gets `channel text NOT NULL DEFAULT 'imessage' CHECK (channel IN ('imessage', 'whatsapp'))`:

| Table | What the channel decides |
|---|---|
| `imessage_receipts` | Which parser stored it and which conversation ordering key it joins (ordering is per channel and space hash) |
| `imessage_links` | Which platform's arrival may complete the attempt |
| `imessage_bindings` | Which transport replies, and which window rules apply |
| `imessage_outbox` | Which transport dispatches it; `template` rows are WhatsApp only |

The existing partial unique indexes stay as they are. `imessage_bindings_active_host_key` on `host_account_id` now enforces one active binding across both channels (D5), and `imessage_bindings_active_sender_key` on `sender_hash` cannot collide across channels because of the separate hash namespace. The outbox gains `template_name text` (null unless it is a template row) and the category values `window_closed` and `template_unavailable`. The cleanup function needs no change, since it reads states and times, not channels.

Rejected: four `whatsapp_*` tables. They would copy the cleanup function, the row-level security and every query, and they could not enforce one channel per host in an index. A rename to `messaging_*` is deferred. pg-delta is pre-1.0 and would plan a rename as a drop and create of tables holding production rows, so it needs a hand-written migration of its own.

### 5. One channel per host

A host has at most one active binding (D5). `imessage.link.confirm` already ends the host's earlier binding in the same transaction. That now also covers a binding of the other channel. Its undispatched host-private outbox rows are suppressed, and the selected request moves to the new binding. The card shows "This replaces your iMessage link" (or the reverse) above **Confirm and link** when the host has an active binding on the other channel.

Rejected: both channels at once. Every summary would go out twice, a decision could arrive from two conversations about one proposal version, and the window rules would apply to only one of them. A host with an iPhone and WhatsApp can choose either.

### 6. Linking

Link attempts gain the channel at creation: `imessage.link.create` takes `{ channel }`, and the answer carries the channel's number and link. Everything else is iMessage D5: the `FMAT-` code, the message `Link my Find Me a Time account: FMAT-…`, 15 minutes, at most 5 attempts per host per hour, and 15 minutes to confirm after arrival. A WhatsApp attempt is completed only by a WhatsApp receipt. A code arriving from the other channel voids the attempt with the "not valid any more" reply on the channel it came from.

The deep link is `https://wa.me/<digits>?text=<encodeURIComponent(message)>`. It opens WhatsApp on Android and iOS, and WhatsApp Web or the desktop app on a computer. The QR code is that same URL rendered with `uqr`, and a phone's camera opens it on either platform.

Device rule (D7), decided in `lib/contracts/messaging-channel.ts` from the user agent:

| Device | Card |
|---|---|
| Android | **Connect WhatsApp**: create, then navigate to the `wa.me` link |
| iPhone, iPad, Mac | **Connect iMessage** as today, plus **Use WhatsApp instead**, which switches the card to WhatsApp |
| Anything else | "Which app do you use on your phone?" with **iMessage** and **WhatsApp**, then that channel's card with QR code, number, code and **Copy** |

The link step after sign-in (iMessage D16) uses the same rule and copy. The landing's start before sign-in accepts `/?flow=whatsapp` beside `/?flow=imessage`. It uses the same browser-owned attempt (D15) and its limits, shared across channels, with the channel recorded, and Thyme's reply carries the same sign-in link (D19).

The service-sent fallback code is not offered on WhatsApp: a first message from the service is outside any window and would need an approved authentication template.

### 7. The 24-hour window

Meta lets a business send free-form messages for 24 hours after the user's last message. After that, sends fail with error 131047 and only templates are accepted. The binding's `last_inbound_at`, already written by the receipt job, is the window's start.

At dispatch, after the messaging gate and before marking the row `dispatching`, the send job checks a WhatsApp free-form row. The binding's `last_inbound_at` must be within 23 hours 50 minutes of the database's `now()`; the 10-minute margin covers the send itself and clock skew. If it is not:

| Row kind | Effect |
|---|---|
| Turn reply, command reply, link or unlinked-sender reply | `suppressed`, category `window_closed`. These answer an inbound message, so this happens only after a long admission deferral or an outage |
| New request, awaiting approval, booking confirmed, booking not confirmed | `suppressed` with `window_closed`, and a template row for the event is queued under section 8's limits |
| Booking still pending, welcome, back from Google | `suppressed` with `window_closed`, with no template |

A free-form send that Meta still refuses with 131047 ends `failed` (the transport outcome `rejected`) with category `window_closed` and follows the same table. Every suppressed or rejected row appears in `/app` the way a failed iMessage delivery does: "Not sent on WhatsApp: you have not written for a day."

### 8. Templates

Three utility templates, all `en_US`, each with one body parameter `{{1}}`, the six-character request reference (iMessage D8):

| Name | Event | Body |
|---|---|---|
| `fmat_request_received` | New request | `You have a new meeting request in Find Me a Time. Reply request {{1}} to see it here, or open findmeatime.com/app.` |
| `fmat_proposal_waiting` | Proposal awaits approval | `A meeting proposal is waiting for your decision in Find Me a Time. Reply request {{1}} to review it here, or open findmeatime.com/app.` |
| `fmat_booking_update` | Booking confirmed or not confirmed | `There is an update on one of your meeting requests in Find Me a Time. Reply request {{1}} for details, or open findmeatime.com/app.` |

Each body uses `{{1}}` once: WhatsApp Manager refuses a template that repeats a variable (found when submitting them on 2026-11-04), so the reference appears only in the reply instruction. The code sends the one parameter unchanged.

The bodies hold no requester name, time, place or proposal detail. Meta reviews the text, and the parameter is a reference that means nothing outside the host's account. The host's `request <reference>` reply opens the window and selects the request, and the next turn shows the details as text.

Limits:

- at most one template per host per 12 hours; further events in that time are only suppressed, and the host sees them with `requests` or in `/app`;
- at most `PHOTON_WHATSAPP_TEMPLATE_DAILY_LIMIT` (default 50) per line per rolling 24 hours. Templates are the line's only business-initiated messages, which Meta bills per message and caps by messaging tier (250 unique users per day before business verification);
- a template row is frozen like any outbox row, and an uncertain template send is never repeated.

A template Meta has not approved, or one paused for quality, is refused with a 132xxx error and ends `failed` (outcome `rejected`) with category `template_unavailable`. The `/app` notice then works as for a closed window.

Opt-in (D12): the card, before **Confirm and link**, says "Thyme will message you on WhatsApp about your requests. If you have not written for a day, it sends a short notice instead." The host's own message and confirmation are the opt-in Meta's policy asks for. `stop` (and `unlink`) as an exact command ends the binding the way **Unlink** does and replies once, "Unlinked. You won't get WhatsApp messages from Find Me a Time." `stop` is added to the command list for both channels, so the two keep one parser.

Template registration happens in Meta's WhatsApp Manager for the business portfolio that owns the number. It needs a person with access to that portfolio, which is an operator step blocked on the user. Korean templates are an open question for the team.

### 9. Transport and outbox

`lib/server/photon.ts` takes the row's channel and kind. The outcomes are the four iMessage transport outcomes (design 3 of `host-imessage-channel`): `accepted` and `rejected` are final (the row ends `accepted` or `failed`), `unavailable` is retried and `uncertain` is never resent. WhatsApp's errors map to them as follows:

| Meta error | Meaning | Outcome |
|---|---|---|
| 131047 | Outside the 24-hour window | `rejected`, category `window_closed` |
| 131026 | Message undeliverable (no WhatsApp account, old app, blocked) | `rejected` |
| 132000–132999 | Template missing, paused, parameter mismatch | `rejected`, category `template_unavailable` |
| 130429, 131056 | Throughput or pair rate limit | `unavailable`, retried with backoff (five attempts) |
| A thrown error before the request left, token issuance failure | Not sent | `unavailable` |
| A lost answer or a 20-second timeout after the request left | Unknown | `uncertain`, never resent |

The provider's `WhatsAppPartialSendError` applies only to multi-part content, which this channel never sends. Text is capped at 2,000 characters as on iMessage, well under WhatsApp's 4,096. No read receipt is sent, and inbound read, typing and reaction events never count as anything.

The stand-in gains `POST /whatsapp/messages` with the same answers, a template branch, and a switch that answers 131047, so tests cover the window without a real line.

### 10. Reused behavior

These are unchanged in shape and only take the channel:

- **What an inbound message may do** (iMessage design 7): ordering per conversation, `FMAT-` handling first, the unlinked-sender reply (once per sender per 24 hours, at most 200 per line per day, counted per channel), the suspended host, "I can read text messages only." for other content (WhatsApp voice notes included), commands, then forwarding.
- **Exact commands** (iMessage D8) with `stop` added (section 8).
- **Forwarding and replies** (iMessage D11): the transcript prefix is `[WhatsApp] …`, and the host instructions name the channel and its lack of cards, as for iMessage. `/app` shows these messages on their own **WhatsApp** tab, as iMessage D20 does.
- **Summaries** (iMessage D12) inside the window, and section 7 outside it.
- **Setup over chat** with the welcome by host state and the Calendar link that returns to the conversation (iMessage D19). The return message is subject to the window.
- **Admission limits and backpressure** from `chat-workspaces`, with the same deferral and ordering waits.
- **Retention** (iMessage D14), unchanged.
- **Messaging environments**: the WhatsApp transport passes the same gate as iMessage. Only the identified production deployment reaches Photon, and everything else reaches the loopback stand-in or nothing.

**Add to contacts** is not offered on WhatsApp. WhatsApp shows the business's verified display name, and contact sharing would add nothing.

## Risks / Trade-offs

- **Template approval may change the wording or category.** Meta may reclassify a utility template as marketing, which costs more and can be blocked by the user's settings. Mitigation: neutral transactional wording with no promotion; the `template_unavailable` path keeps `/app` truthful whatever happens.
- **Webhook spelling unconfirmed.** If Photon's `platform` value differs from every accepted spelling, WhatsApp events are dropped silently, as today. Mitigation: the join captures one real event before any acceptance, and the parser's test fixture is updated from it.
- **Coalesced notices hide events.** With one template per 12 hours, a host may get one notice for several events. The notice says to look, and `requests` and `/app` list everything waiting. The team may prefer one notice per event (open question).
- **Shared table names.** `imessage_*` tables holding WhatsApp rows will confuse readers until the deferred rename. Comments on each table and the `channel` column say so.
- **Cost.** Each template is billed by Meta. The daily limit and the 12-hour coalescing bound it, and diagnostics count templates per day.

## Open Questions

- Template language: English only, or also Korean (`ko`) chosen from the host's language?
- One notice per 12 hours, or one per event, when the window is closed?
- Which business portfolio owns the number and who on the team can submit templates and the display name?
- Should the landing's iMessage-first entry offer WhatsApp to Android visitors at once, or only after sign-in?

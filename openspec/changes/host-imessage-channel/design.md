# Design

## Context

See [proposal.md](proposal.md). Earlier phases left these pieces to build on:

- the host's discussions (one setup discussion, one private review discussion per request) and `acceptHostMessage`, which redacts, admits, records and delivers a host's input to its indexed eve session;
- the session-owner hook, which completes an input when its turn ends and delivers the next one, and already wakes Phase 7's waiting email replies;
- the command pipeline (`runCommand`) with retry keys, and the host commands of Phases 2 and 4: `setup.confirm_settings`, `request.approve`, `request.decline`, `request.share_changes`, `request.dismiss_changes`;
- durable jobs with fencing, and the messaging gate (`messaging.ts`) every transport and delivery worker passes;
- Phase 7's signed receiver (`agentmail-receiver.ts`), receipt job and turn replies (`email-replies.ts`), which this design mirrors;
- sealed values (`token-encryption.ts`) and redaction of `FMAT-` codes (`redaction.ts`).

Before designing each module, read the reference files the [plan names for Phase 6](../../../documentations/technical_specification/06_implementation_plan.md#5-reference-repositories-per-phase): the personal-agent template's `agent/channels/photon.ts` and `PhoneInput.vue`, OpenInstinct's `agent/channels/linq.ts`, `agent/lib/linq/transport.ts` and its verification and delivery tests, and the retired iteration-1 design (`git show e3c01d2:openspec/changes/host-imessage-assistant/design.md`). The pull request names the revisions.

## Goals / Non-Goals

**Goals:** an authenticated host links their own iMessage in two taps (connect, send) and one browser confirmation; a linked host receives summaries, discusses, revises, approves and declines in text, and runs setup there; nothing a sender claims grants access; retries, restarts and lost responses neither duplicate a decision nor lose a message; delivery failure stays visible on the web.

**Non-goals:** phone-number accounts or iMessage-first account creation (Google stays the only way in); requester iMessage; attachments, reactions and group conversations; provisioning a Photon line or registering its webhook (operator steps, blocked on the user); live device acceptance (the join's real-device steps, blocked on the user).

## Decisions

### 1. The transport spike and the adapter

The spike read eve 0.80.1's native channel (`eve/channels/photon` and the bundled `@photon-ai/chat-adapter-imessage`), Photon's webhook documentation, the Spectrum SDK (`@spectrum-ts/core` and `@spectrum-ts/imessage` 12.14.0) and teammate draft PR #23. No real line was used: provisioning one and texting a number are blocked on the user. The four criteria the plan names:

| Criterion | Native `photonIMessageChannel` | Application-owned adapter |
|---|---|---|
| Durable receipt | `handleWebhook` verifies, then calls the Chat SDK's `processMessage` in process and answers `200`; nothing is stored in our database first, so a restart after the `200` loses the message | Receipt and job committed in one transaction before the `200`; Photon retries a `5xx` with the same `message.id` |
| Acknowledgment | `200` as soon as the dispatch is scheduled | `200` only after the commit; a duplicate `message.id` answers `200` with nothing new; a changed payload under the same ID answers `409` |
| Exact sender identity | `message.author` from the payload; one eve session per iMessage thread, auth from `onMessage` | `sender.id` compared to a keyed hash of the bound sender; `space.type` must be `dm`; the session comes from the application's index for the host's selected discussion |
| Recovery | No outbox; the reply is sent from the turn with no record of an uncertain send; admission limits can only drop a message (`onMessage` returns `null`) | Receipts stay pending and retry no earlier than a minute later without being overtaken; every outbound message is a frozen outbox row with accepted, failed and uncertain states |

The native channel would also continue one session per iMessage thread, while the host's work lives in several discussions (setup and one per request) that `/app` shares, and it needs Vercel Connect or OIDC forwarding. So the adapter is application-owned (D1), in the same shape as Phase 7's email channel:

- `agent/channels/photon.ts` is a custom eve channel with one route, `POST /photon/webhook`, routed to the agent service by `vercel.ts`. It never starts a session.
- `lib/server/photon.ts` is the only module that talks to Photon for outbound messages. Production uses the Spectrum SDK, loaded with a dynamic import so nothing else depends on its types: `Spectrum({ projectId, projectSecret, providers: [imessage.config()] })`, then `imessage(app).space.get(spaceId)` for a known conversation or `space.create(await user(address))` for the fallback code's new one, then `space.send(text)` or `space.shareContactCard()`. Local runs and tests use a stand-in at `PHOTON_API_URL` (loopback only) that speaks the same outcomes over HTTP.

The **sender identifier format** (D2): Photon's events give `message.sender.id` as the platform's identifier, an E.164 number for iMessage (`+15551234567`), and the SDK's `space.create` accepts "E.164 phone or email", so an Apple ID email is possible when the host's Messages sends from it. The receiver normalizes an email to lower case and keeps a number as given (`+` and digits); anything else is not a sender. A direct conversation's `space.id` looks like `any;-;+15551234567`; it is opaque and stored only sealed. The spike could not confirm on a device which identifier a given iPhone sends; that is part of the join's real-device check.

Webhook signature, from Photon's documentation, the bundled adapter and PR #23 alike: header `X-Spectrum-Signature: v0=<hex>` where the hex is HMAC-SHA256 under the webhook's signing secret over `v0:{X-Spectrum-Timestamp}:{raw body}`, the timestamp in seconds and within 300 seconds of the server's time; `X-Spectrum-Webhook-Id` names the webhook; `X-Spectrum-Event: messages`.

### 2. Receiver and receipts

`receivePhotonWebhook` in `lib/server/photon-receiver.ts`, in order, before reading anything else:

1. configuration: `PHOTON_WEBHOOK_SECRET` and `PHOTON_WEBHOOK_ID` must be set, else `404`;
2. the raw body, at most 64 KiB, read as a stream (`413` beyond);
3. the webhook ID header must equal `PHOTON_WEBHOOK_ID` (`404` otherwise: another webhook's delivery is not ours), and the signature must verify in constant time within the window (`401`);
4. the payload: only `event = "messages"` with an inbound `message` carrying `id`, `sender.id`, `space.id`, `space.type` and a `content.type` is stored; anything else is acknowledged with `200` and stores nothing.

One transaction then inserts the receipt and publishes the `imessage_receipt` job keyed by the receipt. The receipt holds the provider message ID, the webhook ID, the keyed hash of the normalized sender, the keyed hash of the space ID, the space type, the content type, the provider timestamp, the payload's SHA-256, and the text (at most the chat limit plus a margin) sealed under the token key with the receipt ID as context, together with the sealed sender and space ID that replies need. A second delivery with the same message ID and payload hash is a duplicate (`200`); the same ID with another hash is a conflict (`409`) and writes nothing.

Line provisioning (D7) is one project and one line; `PHOTON_LINE_NUMBER` is the number the card shows and the deep link addresses. PR #23's verification and its durable inbound events (stored before the `2xx`, deduplicated on the message, text cleared after processing) are reused here, credited in the pull request.

### 3. The transport and the outbox

Every outbound message is one `imessage_outbox` row: the kind, the host, the binding or link it belongs to, a dedupe key, the recipient (sealed space ID or address), the text sealed and frozen, and the state `waiting` (a turn reply waiting for its turn), `queued`, `dispatching`, `accepted`, `failed`, `uncertain` or `suppressed`. The `imessage_send` job dispatches one row:

- it checks messaging admission toward the transport's endpoint before reading the row;
- a host-private message whose binding is no longer active is `suppressed`;
- it marks the row `dispatching` and commits before calling the transport;
- the transport answers `accepted` (with the provider message ID and space ID), `rejected` (a definitive refusal, such as a recipient that is not on iMessage), `unavailable` (refused before anything was sent, for example no connection, or no conversation could be opened, which the SDK does not tell apart from a network fault) or `uncertain` (the send began and its answer was lost or timed out after 20 seconds).

`accepted` and `rejected` are final. `unavailable` returns the row to `queued` with its frozen text, fails the attempt and retries with backoff, five attempts in all, then `failed`. `uncertain` is final and is never sent again (D9): Photon's gRPC client deduplicates its own retries but offers no idempotency key we can check, so a second send could reach the host twice. The retired design's lockout is kept in this form: the outbox row stays visible as uncertain, and the web says the message may or may not have arrived. Text is cleared when a row reaches a final state.

### 4. Linking by a host-sent code

The user kept the PRD's scope on 2026-10-23 (D3). `imessage_links` holds attempts; `imessage_bindings` holds bound senders.

- `imessage.link.create` (the card): an active host, at most 5 attempts per hour; a pending attempt is voided; a new `FMAT-` code (D5) is stored as its SHA-256 and sealed so a reload shows it again; valid 15 minutes. The answer is the line number, the exact message `Link my Find Me a Time account: FMAT-XXXXXXXXXX` and the expiry. The saved command outcome holds only the attempt's ID.
- The host sends the message. The receipt job finds the code anywhere in the text. If the attempt is pending and unexpired, the sender is not bound to another host, and the conversation is direct, the attempt becomes `received` with the sealed sender and space ID and a 15-minute confirmation window, and the line replies in that conversation: "Got it. Go back to Find Me a Time in your browser and tap Confirm and link to finish." The same sender sending the code again changes nothing. Any other arrival voids the attempt and gets "That link code is not valid any more. Start again from Connect iMessage in Find Me a Time.", except that a code posted in a group conversation voids the attempt with no reply into the group. A linking message is never forwarded to the model.
- The card polls the status and shows the masked sender (the last four digits of a number, or the first character and domain of an email) with **Confirm and link** and **This isn't me**.
- `imessage.link.confirm` binds the sender to the host: one active binding per host and per sender; an earlier binding of the host ends. The line replies "Linked. Send help for what I can do here." `imessage.link.cancel` voids the attempt.
- `imessage.unlink` ends the active binding in the database only, so it works during a Photon outage; later messages from that sender get the unlinked-sender reply (section 7) and no private data. An outbox message not yet dispatched for that binding is suppressed.

### 5. The one-tap deep link

**Connect iMessage** (D4) calls `imessage.link.create` and, when the answer arrives, opens the deep link in the same tab:

- iOS and iPadOS (an iPhone, iPad or iPod user agent, or a Macintosh one with touch points, which is iPadOS): `sms:<number>&body=<text>`;
- Android: `sms:<number>?body=<text>`;
- the text is percent-encoded with `encodeURIComponent`.

Every other platform, including macOS and Windows desktops, gets no automatic navigation, because Messages either cannot open or does not take a body reliably there. The card then shows the number, the code, **Copy** (the exact message text) and a QR code of the iOS deep link, which an iPhone's camera opens; Android scanning is not a goal, as the MVP targets iPhone hosts. On phones the card also keeps **Open Messages**, the same deep link as a plain anchor, for when the automatic navigation did not open the app. Opening Messages never changes server state; only the arriving message does. The QR code is rendered on the client with `uqr` as an SVG from the text the server answered.

### 6. The fallback code

**Send me a code instead** (D6) shows an E.164 number field. `imessage.link.send_code` stores the number sealed and its keyed hash, creates a six-digit code (stored as a keyed hash), and queues one outbox message to that number: "Your Find Me a Time code is 123456. It expires in 10 minutes." The limits: valid 10 minutes; 3 sends per attempt, at least 60 seconds apart (a resend makes a new code and voids the old one); 5 sends per host per rolling 24 hours; at most `PHOTON_FALLBACK_DAILY_LIMIT` (default 20) fallback sends per line per rolling 24 hours, because each opens a new conversation and Photon caps those per line per day; a number already bound to another host gets nothing, but the send is recorded as suppressed, so it counts toward the limits and the card shows it sent as for any number. `imessage.link.verify_code` with the typed code and **Confirm and link** binds the number; 5 wrong entries void the code. The browser never receives the code: the status says only queued, sent, failed or uncertain, with the masked number. An uncertain send counts toward the limits, and the card says the code may still arrive. The bound sender for a fallback binding is the number as entered; its replies flow like any other once the host writes from that number.

### 7. What an inbound message may do

The `imessage_receipt` job checks messaging admission first, then opens the receipt. In order:

| Check | Effect |
|---|---|
| An earlier receipt from the same conversation is still unprocessed | The receipt waits on a new job, spending no attempt; the earlier receipt's completion brings it forward, so a later message never overtakes an earlier one |
| The text carries an `FMAT-` code | Linking (section 4), also from a group conversation; never forwarded |
| `space.type` is not `dm`, or the content is a reaction | Nothing (no session, no reply) |
| The sender has no active binding | One fixed reply per sender per 24 hours (D10), and at most 200 such replies per line per day: "This number isn't linked to a Find Me a Time host. Sign in at findmeatime.com/app and choose Connect iMessage." No private data |
| The binding's host is no longer eligible (suspended) | The same fixed reply; nothing else |
| Content other than text | "I can read text messages only." |
| An exact command (section 8) | The command runs and its fixed reply is queued |
| Anything else | Forwarded (section 9) |

The binding is row-locked for the receipt's whole processing, so an unlink waits for a message already being processed instead of racing it. An admission limit leaves the receipt unprocessed and a new job retries it no earlier than one minute later, with ordering kept by the first check. If the binding ends or the host is suspended before the retry, the retry reaches the unlinked outcome and admits no model work. After 10 attempts the receipt is recorded `ignored`. The sealed text is cleared once the outcome is recorded.

### 8. Exact commands

A command is the whole message, trimmed, compared case-insensitively (D8). References:

- request reference: six Crockford base32 characters from the SHA-256 of the request ID, looked up among the host's own non-draft requests; an ambiguous reference refuses and points to `/app`;
- review reference: `<request>-<version>` for the latest proposal version;
- suggestion reference: `<request>-S<n>`, where `n` counts the request's shared-change drafts;
- settings reference: the first eight characters of the setup proposal hash, upper-cased.

| Command | Effect |
|---|---|
| `help` | The command list |
| `requests` | Up to ten open requests, newest first, each with its reference, requester name and state |
| `request <ref>` | Selects that request's private discussion for later free text and replies with its summary |
| `setup` | Selects the setup discussion and replies with the next setup step |
| `review` | With a request selected: the current proposal summary and, when it awaits approval, the exact `approve` and `decline` commands. With setup selected: the authored settings review and its `confirm` command, or the browser link when it does not fit one message (1,500 characters) |
| `changes` | The selected request's pending suggested changes with `share <ref>` and `dismiss <ref>` |
| `share <ref>` / `dismiss <ref>` | `request.share_changes` / `request.dismiss_changes` for that suggestion, if it is still the pending one |
| `approve <ref>` | `request.approve` for that version, if it is still the latest |
| `decline <ref>` | `request.decline`, if the reference's version is still the latest |
| `confirm <ref>` | `setup.confirm_settings` with the current proposal hash, if the reference matches it; the live calendar list is read first |

A decision runs through `runCommand` as the linked host, with the retry key `imessage:{receiptId}`, so a replayed or retried receipt replays the saved outcome rather than deciding twice, and its reply is built from that saved outcome even when the request has moved on since; a concurrent web action finds the request already moved on (AC-18). A stale reference is refused with the current reference and the web link; nothing changes. Free text, including an unqualified "yes", is forwarded to the assistant, which has no tool that approves (AC-17).

### 9. Forwarding and replies

The binding records the selected request (null for setup). Free text goes to `acceptHostMessage` as the host's Supabase user, with the selected request, the client input ID set to the receipt ID and the text prefixed `[iMessage] ` (D11), so redaction, admission, the session index and model limits apply as on the web and a retried job finds the same input. A selected request that is no longer the host's, or still a draft, falls back to setup with a notice.

A forwarded message records an outbox row `waiting` for its input. When the input's turn ends, the session-owner hook wakes it; the job reads the turn's `message.completed` texts that end without tool calls, as Phase 7's email replies do, redacts them, caps them at 2,000 characters with a pointer to `/app` beyond, freezes the text and sends it. A turn that fails for good, or yields no text, sends "I couldn't finish that. You can continue in Find Me a Time on the web." A waiting row is retried for at most 30 minutes, then suppressed.

The host instructions gain one fragment: a message starting with `[iMessage]` came from the host's linked iMessage, which shows no cards; ask one question at a time in text, echo what you understood, and name the exact command (`review`, `confirm <ref>`, `approve <ref>`) when a decision is needed, never claiming that a reply in text decided anything.

### 10. Summaries and outcomes

`enqueueHostNotice(tx, requestId, notice)` runs in the domain transaction of the change it reports and, when the host has an active binding, records one `imessage_notice` job for the event; it needs no key, so every domain path can call it. The job freezes the text from the event's own records (the proposal version or the booking it names) into one outbox row (D12):

| Event | Where it is enqueued | Text |
|---|---|---|
| New request | the requester is identified (`identifyDraft`) | requester name, purpose, reference, and "Send request <ref> to discuss it here." |
| Proposal awaits approval | `request.agree` | the time in the host's timezone, duration, mode and place, the reference, and the exact `approve <ref>` and `decline <ref>` |
| Booking confirmed | the booking job records the event | the confirmed time and "It's on your calendar." |
| Booking not confirmed | the booking job fails | that the booking was not confirmed and to check `/app` |
| Booking still pending | the 15-minute pending check finds it still dispatching | that it is taking longer than usual and to check `/app` |

Each is keyed by the event (`notice:{kind}:{request}:{version or booking}`), so a retried transaction or job queues it once, and an awaiting-approval summary whose version is no longer the latest is skipped. The `/app` iMessage card shows the latest failed or uncertain message with its time ("A message to your iMessage could not be delivered. Continue here."), and the host's web review is unaffected: a delivery result never changes request or booking state, and a delivery retry cannot create a booking (FR-28).

### 11. Add to contacts

After linking, the connected card offers **Add to contacts** (D13): `imessage.contact_card.share` queues one outbox row of kind `contact_card` for the binding; the transport calls `space.shareContactCard()`. The card shows queued, accepted ("Check iMessage and choose whether to save it"), failed or uncertain ("Check your conversation"), with **Check contact status** and no resend while uncertain. A failed status read hides the action. Unlinking does not recall a card already sent.

### 12. Setup over iMessage

`setup` selects the setup discussion, so free text reaches the same setup session as `/app`, whose `draft_settings` tool updates the shared draft; a question answered in iMessage is not asked again on the web. Sign-in, Google consent and protected fields stay browser steps: the assistant sends `{origin}/app`. `review` with setup selected renders the authored review from `readSetupState` (every proposed value with its source) with the settings reference; `confirm <ref>` runs `setup.confirm_settings` with the proposal hash the reference matches and the live calendar list, exactly as the web review does. A changed draft changes the hash, so an old reference is refused with the new one. Links are returned only after the server confirms readiness.

### 13. Retention

D14: receipts are deleted 30 days after receipt and their sealed text is cleared at processing; outbox text is cleared at a final state and rows are deleted after 30 days; link attempts are deleted 30 days after they end; an ended binding is deleted 30 days after it ended. `app.cleanup_imessage_records()` runs on the existing hourly schedule pattern.

### 14. The link screens: the /app link step and the iMessage start (D15–D18)

The user decided on 2026-10-23 that the linking flow follows their frontend's screens (draft PR #23's phone check, the landing redesign of `feat/web-language-switch`) on this change's host-sent code. Where the screens and sections 4 to 6 differ, the screens' behavior wins and the server keeps sections 4 and 5.

- **The /app link step (D16).** Right after Google sign-in, where the redesign asked for a phone number, `/app` shows one full screen before the conversation: an active host with no binding who is not ready and has not chosen **Set up here in web chat** (remembered in the browser, like **Maybe later**), or any host with an open attempt. The step opens with a code already made (`imessage.link.create`), so on a phone **Open Messages** is a plain `sms:` link the tap follows and the screen then waits; on a computer the send panel shows the message, the QR code, this Mac's Messages (D17) and **Copy**, with how long the code works. The arriving message shows the masked sender for **Confirm and link** (section 4); **This isn't me** cancels and makes a new code; a code that ran out shows a new one a tap away. A linked host continues to the conversation. The in-chat card (section 5) stays for the menu's **iMessage** item.
- **No service-sent first message (D16).** The browser does not offer **Send me a code instead**: on Photon's shared lines (Free and Pro) a send to a number that has not written first is refused (`Target not allowed for this project`, 2026-10-20 spike, three of three), and opening conversations is a Business-plan feature. The fallback commands stay (section 6) for when a dedicated line exists; an attempt the server already holds still shows its card.
- **The iMessage start before sign-in (D15).** `/?flow=imessage` puts **Onboard with iMessage** where the Google start sits. `POST /api/imessage/start` (same-origin JSON) creates a code attempt with no host, owned by this browser: an HttpOnly, `SameSite=Lax` cookie (`fmat_imessage_start`, 30 minutes) holds a random secret whose keyed hash is the attempt's `starter_hash`; starts are bounded at 5 per source address (the sign-up source hash) and 100 across the service per rolling hour. `GET /api/imessage/start` shows this browser's attempt only. The receipt job treats it as any attempt (section 4) but takes the starter's lock, accepts any direct sender (the bind refuses a sender another host holds) and replies "Got it. Go back to Find Me a Time in your browser and sign in with Google to finish." The Google callback, for an active host, gives the browser's open attempt to that host (`claimStartedLink`: the host's own open attempt is voided; a received attempt gets a fresh confirmation window), and clears the cookie; `/app` then shows **Is this you?**. Nothing is bound before an authenticated browser confirms the masked sender.
- **A Mac (D17).** A Macintosh user agent without touch points is `mac`: the link screens offer **Open Messages on this Mac** with the iOS form of the deep link, beside the QR code and **Copy**; other desktops get only those two. On the user's Mac on 2026-10-23, Messages opened with the line and the body filled in.
- **The ink screens (D18).** The landing (both starts) and the link step use the landing redesign's ink palette, Big Shoulders headings and Geist body (`apps/web/app/_components/ink/ink.css`, scoped under `.ink`), not DESIGN.md's Thyme theme, which the rest of `/app` keeps. Their words are in English and Korean, following a `lang` cookie the language menu sets. The Google start's **Connect my Google Calendar too** box, unchecked, signs in with identity only (`/auth/sign-in?calendar=0`); setup's **Connect Google Calendar** card asks for Calendar later. The agent prompt is the landing's visible agent section and links `/SKILL.md` (public-agent-entry).

### 15. Records

| Table | Holds |
|---|---|
| `imessage_receipts` | provider message ID (unique), webhook ID, sender hash, space hash, space type, content type, provider time, payload hash, sealed text, sender and space (cleared at processing), outcome, times |
| `imessage_links` | host (none for an iMessage start until sign-in claims it, D15, with the starter's keyed hash and the source hash instead), method (`code` or `fallback`), state (`pending`, `received`, `linked`, `voided`, `expired`, `cancelled`), code hash and sealed code, sealed number and its hash (fallback), sends, wrong entries, sealed sender and space with the sender hash once received, expiry, confirmation deadline, times |
| `imessage_bindings` | host, sender hash, sealed sender and space, selected request, state (`active`, `unlinked`), the link that made it, times; unique active binding per host and per sender |
| `imessage_outbox` | kind, host, binding, link, request, input, dedupe key (unique), sealed recipient and text, state, failure category, provider message ID, attempts, times |

Each has row-level security and no `anon` or `authenticated` grants; only the application role reads them.

### 16. Testing

Fixtures prove logic; the join's device steps prove the integration. Tests use a stand-in Photon on loopback (`tests/integration/support/fake-photon.ts`) that records sends and can answer accepted, rejected, unavailable or uncertain, and signed-webhook fixtures built with the documented scheme. Unit tests cover the signature, payload parsing, command parsing, references, deep-link building and masking. Integration tests cover the receiver (stored before `200`, duplicate, conflict, stale, wrong webhook), linking (both paths, wrong, expired, replayed and foreign codes, limits, unlinking), the receipt job (order, backpressure, unlinked and group senders), every command with stale references and replays, forwarding with a turn reply through `eve dev` and the OpenAI stand-in, summaries, the outbox outcomes and the messaging gate. A Playwright journey covers the card on a phone and a desktop viewport.

### 17. Carrying on in iMessage: the sign-in link, the welcome and the Calendar link (D19)

Both entries end in the same iMessage conversation, which carries on setup (user, 2026-10-23). PR35's binding, receipt job, outbox, commands and shared setup discussion are unchanged; three things are added.

- **The sign-in link in Thyme's reply.** When a code from the iMessage start (an attempt with no host yet) arrives, the reply carries `/imessage/continue?token={attempt ID}.{proof}`, where the proof is HMAC-SHA256 under the token key over a versioned label, the attempt ID and the sender's hash. The link works while the attempt is received and before its confirmation deadline. Opening it keeps the token in an HttpOnly cookie on `/auth` for 15 minutes and starts Google sign-in with Calendar, marked `return=imessage`. The callback gives the attempt to the signed-in host unless another host holds it, voids the host's other open attempts and restarts the confirmation window; the link step then asks for **Confirm and link** with the masked sender, as for this browser's own attempt. A used, expired, cancelled or tampered link goes to `/?flow=imessage` and sets nothing. Its responses are uncached, unindexed and send no referrer. A code from the /app link step, whose browser is already signed in, keeps PR35's reply with no link.
- **The welcome.** Confirm and link queues the linked message by where the host stands: a ready host gets PR35's "Linked. Send help for what I can do here."; a host whose Calendar is not usable is welcomed and sent the Calendar link; a host with Calendar but not yet ready is welcomed and asked how long a typical meeting should be. A plain reply already reaches the shared setup discussion (design 12), and the iMessage instruction treats it as a setup answer, so the host need not send `setup` first.
- **The Calendar link.** `/auth/sign-in?consent=calendar&return=imessage`, sent by the welcome, by `setup` while Calendar is the next step, and by the agent. Sign-in records `imessage` in the return cookie. After sign-in the callback queues "You're back from Google…" to the host's active binding, keyed by an HMAC of the redeemed authorization code so a replayed callback queues nothing twice, and still returns to /app. The message does not claim that Calendar was granted. A failed claim or message is logged and sign-in still succeeds.

Messaging stays production-only (design decision 13, `messaging-environments`). The 2026-10-23 device check (tasks 8.3) used a temporary local override outside the repository. Rejected: admitting Spectrum from a local run for one named recipient through the gate, which relaxes that contract for a test; signing in inside iMessage itself, since Google consent is a browser step; a link in the reply to a code from the /app step, whose browser is already signed in.

## Risks / Trade-offs

- **Device behavior partly verified.** On 2026-10-23, on the user's iPhone and Mac with the `fmat-spike` line and a local receiver (tasks 7.3 and 8.3): Messages opened with the line and the body filled in from the landing on iOS Safari and on the Mac, the sent code turned the page to received, and the welcome and the next setup question arrived after a reply. Still verified only against documentation and a stand-in: the QR code on an iPhone camera, Google sign-in from a phone (a local run has no callback the phone can reach) and any production run. The join's device steps must pass before any claim of an iMessage pass.
- **SMS fallback.** If Photon or the host's phone falls back to SMS, a link message may still arrive, but replies may not. The binding records the conversation it came from; a rejected send is shown on the web.
- **Uncertain sends are never retried.** A lost answer can leave the host without a summary; the web always shows the request, and the card shows the uncertain message.
- **Line allowance.** The fallback's daily cap is a guess at Photon's unpublished limit; record fallback use and tune `PHOTON_FALLBACK_DAILY_LIMIT` with Photon.

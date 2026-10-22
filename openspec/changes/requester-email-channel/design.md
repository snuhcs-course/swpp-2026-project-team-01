# Design

## Context

See [proposal.md](proposal.md). Phases 1 to 4 left these pieces to build on:

- one requester discussion per request with its indexed eve session, reached only through `guest-conversations.ts` (`acceptGuestMessage`), which redacts, admits, records and then delivers each input with an internal bearer that `appAuth` checks against the session index;
- the session-owner hook, which completes an input when its turn ends and delivers the next one;
- request creation and identification in `request-start.ts` with the creation bounds (Phase 3 D7) and the creation email (Phase 3 D3);
- durable jobs with fencing and the messaging gate (`messaging.ts`) that every transport and delivery worker passes;
- the status notices of Phase 4 (`booking-notices.ts`) and the email templates that render them;
- the administrator CLI (`operator.ts`) with explicit environment and operator authority.

Before designing each module, read the reference files the [plan names for Phase 7](../../../documentations/technical_specification/06_implementation_plan.md#5-reference-repositories-per-phase): the eve memory template's Slack channel and identity resolution with their tests and test helpers, and the eve chat template's minimal Slack channel. The pull request names the revisions.

## Goals / Non-Goals

**Goals:** a requester starts a request by writing to the product inbox, continues it in the same thread, confirms their address and moves to the booking link for the browser steps; a requester who started on the web links a thread from the booking page; replies and status notices come back in that thread; nothing a message claims grants access; retries, outages and lost responses neither duplicate nor lose a message.

**Non-goals:** the host's own email channel (a proposed extension); attachments; candidate selection, agreement or approval by email (they stay on the booking page, AC-05); creating the inbox or the webhook at AgentMail (operator steps, blocked on the user); deleting provider-side threads (Phase 8).

## Decisions

### 1. The channel and the receiver

`agent/channels/agentmail.ts` is a custom eve channel (D1). Its only route is `POST /agentmail/webhooks/:receiverId`, which `vercel.ts` routes to the generated `eve` service before the catch-all web route; eve's own `/eve/v1/*` stays as it is. The channel declares no session state, no events and no `from()` call. Its handler calls `receiveAgentMailWebhook` in `lib/server/agentmail-receiver.ts`, which:

1. reads the raw body (at most 256 KiB) before parsing it;
2. loads the receiver by the path's ID and refuses with `404` unless it is `enabled`, its inbox equals `AGENTMAIL_INBOX_ID`, and its stored fingerprint equals the SHA-256 of `AGENTMAIL_WEBHOOK_SECRET` (a replaced secret disables an old registration without a database write);
3. verifies the Svix signature: HMAC-SHA256 over `{svix-id}.{svix-timestamp}.{body}` with the secret's base64 key, any `v1,` signature matching in constant time, the timestamp within five minutes; failure answers `401` without reading anything else;
4. parses the payload; an `event_type` other than `message.received`, or a payload without the locators, answers `204` and stores nothing (unsupported delivery classes create no work);
5. in one transaction, inserts the receipt and publishes the `email_receipt` job with the receipt ID as its only payload, then answers `204`.

Deduplication follows AgentMail's guidance: `event_id` is the same on every retry and on every subscription, so it is the receipt's identity; the Svix ID and the message ID are also unique. An insert that conflicts compares the stored evidence (event ID, Svix ID, inbox, thread, message, payload hash): identical evidence answers `204` with the existing receipt and job; any difference answers `409` and changes nothing. A lost response is retried by AgentMail and lands on the same receipt.

The receipt stores the receiver, event ID, Svix ID, event type, inbox ID, thread ID, message ID, the payload's SHA-256 and the receipt time. It stores no body, subject, sender, recipient, header or attachment. Neither `anon` nor `authenticated` can read it.

Registration (D10) is an operator command in the administrator CLI: `email-receiver register --inbox <inboxId> --webhook <webhookId>` writes an enabled row with the secret fingerprint and disables any earlier enabled receiver for the inbox, in one audited transaction; `email-receiver disable --receiver <id>` disables one; `email-receiver list` prints IDs, inboxes, states and dates. The operator then creates the webhook at AgentMail with the URL `{origin}/agentmail/webhooks/{receiverId}` and the `message.received` event, and stores its secret as `AGENTMAIL_WEBHOOK_SECRET`.

Rejected: the Chat SDK bridge, which has no AgentMail adapter, and whose Gmail adapter reads a Google mailbox; letting the channel call `from(threadId).send()`, which creates an eve session per thread outside the session index, so a request would have two sessions and email would skip admission and the model limits' attribution. A Next.js route would work as well; the agent service is chosen because the plan and the agent configuration place the email channel in `agent/channels/`, and the receiver needs nothing from the web service.

### 2. One shared inbox

The account allows three inboxes, and `findmeatime@agentmail.to` is the selected one (D2). Every host and request share it. A thread's first message names its host by `@handle` anywhere in the subject; the first token that is a ready host's handle wins. The public host page shows "Prefer email? Write to findmeatime@agentmail.to" with a `mailto:` link whose subject is `Meeting with @{handle}`, only when `AGENTMAIL_INBOX_ID` and the inbox address are configured. Replies need no handle: the thread binding names the request.

Rejected: one inbox per host, which the limit forbids and which makes inbox creation (irreversible, provider-side) part of host onboarding; one per request; plus-addressing such as `findmeatime+alice@`, which AgentMail does not document.

### 3. Starting by email

A new thread (no binding, no link code) from an authenticated sender whose subject names a ready host starts a request (D6). In one transaction the job:

1. checks the host through the shared guard and the creation bounds with the keyed hash of the lowercased sender address as the source;
2. creates the draft request, its sealed booking link and its requester discussion exactly as `request.start` does, then identifies it at once with the sender's display name (else the address's local part), the address as unconfirmed contact, the host's timezone, and Korean when the message contains Hangul, else English; identification sends the Phase 3 creation email with the booking link and **Confirm this address**;
3. binds the thread with origin `started` and the keyed hash of the sender address;
4. records the first message (subject and text) as the discussion's first accepted input, keyed by the receipt ID, and a waiting reply for it.

The guest can then continue in the thread or at the booking link; both are the same discussion. The thread never carries the booking link: it reaches the sender's address through the creation email, as on the web.

A new thread naming no ready host gets one fixed reply, "Find Me a Time could not tell which host you want to meet. Open the host's page and use its email link." and creates nothing. Creation bounds that refuse leave nothing either and get the same reply with "Try again later." instead.

### 4. Continue by email

`/api/requests/{bookingId}/email-link` serves the card (D7, D9):

- `GET` returns `unavailable` (no inbox configured), `needs_confirmation` (the contact is not confirmed), `none`, `pending` with the code, the inbox address and the expiry, or `linked` with the masked address and the time.
- `POST { action: "create", retryKey }` runs `request.email_link.create`: the request must be open and its contact confirmed; at most 5 codes per request per hour; a pending code is voided; the new code is stored as its SHA-256 and sealed under the token key for display after a reload. The exact retry returns the same code.
- `POST { action: "unlink", retryKey }` runs `request.email_link.unlink`: the active binding becomes `unlinked` and any pending code is voided, in the database only, so it works while AgentMail is unreachable.

The card shows the inbox address, the code in a copyable block, **Open email** (a `mailto:` with the code as the subject), the expiry, **Check email link** and **Cancel**. A link code in the thread's first message, from the confirmed contact with authenticated evidence, binds the thread (origin `linked`), consumes the code, replaces any earlier binding of the request and records a fixed confirmation reply: "This thread is now linked to your request with {host}. Reply here to continue." The linking message is never forwarded to the model. An uncertain command answer offers **Retry same linking action**, which repeats the request with the same retry key.

### 5. What a message must prove

The `email_receipt` job reads the message with `GET /v0/inboxes/{inbox}/messages/{message}` and checks it against the receipt's locators. It then applies, in order:

| Check | Fails when | Effect |
|---|---|---|
| Our own message | From is the product inbox | Nothing |
| Delivery class | Labels include `unauthenticated`, `spam` or `blocked` | Nothing |
| Sender evidence (D5) | Neither `dmarc: pass` nor `dkim: pass` with `dkim_domain` equal to the From domain | Nothing, and a carried link code is voided |
| Link code | The text carries `FMAT-` and ten characters | Bind (section 4) if every condition holds, else void the code; never forwarded |
| Bound thread | The thread has an active binding | Forward if the From address hashes to the binding's address and the request is open; a closed request gets one closed notice per binding; another sender gets nothing |
| New thread | No binding and the message starts the thread | Start (section 3) |
| Anything else | A reply in an unbound or unlinked thread | Nothing |

Forwarding uses `acceptGuestMessage` with the receipt ID as the client input ID, so a retried job finds the same input. The text is the provider's extracted new text (quoted history removed), falling back to the plain text. Over-long messages get one fixed reply and are not forwarded (D11). Redaction already removes booking links and bearer-like values; link codes are added to it. An admission refusal fails the job's attempt, so the receipt is retried with backoff rather than dropped.

The job has a messaging endpoint (the AgentMail base URL), so the worker claims it only where messaging is admitted, and the transport is gated as every other one is.

### 6. Replies

Each forwarded message gets an `email_replies` row in `waiting` with its input, and an `email_reply` job due 30 seconds later (D8). The session-owner hook, on `turn.completed`, `turn.failed` and `turn.cancelled`, moves the jobs of replies waiting on the completed input to now, so the per-minute sweep picks them up. The job:

1. while its input is not completed, fails the attempt with `not_ready` (12 attempts span about 3 hours);
2. reads the session's recorded events with an internal read bearer and joins the `message.completed` texts whose finish reason is not `tool-calls` and whose delivery IDs belong to the input; none gives the fixed fallback "I could not finish a reply. Continue at your booking link.";
3. freezes the text with the footer and moves the reply to `queued`, then `dispatching`, committing before the network call;
4. sends `POST /v0/inboxes/{inbox}/messages/{message}/reply` with `text` and `Idempotency-Key: {replyId}`; `200` with a message ID is `accepted`, `4xx` other than `409` and `429` is `rejected`, anything else uncertain.

A reply found in `dispatching` by a later attempt is sent again with the same key while its first dispatch is under 23 hours old; AgentMail returns the original message without a second email. After that it is recorded `uncertain` and never sent again. Fixed replies (link confirmation, start refusal, closed notice, over-long message) skip step 1 and 2.

### 7. Thread notices

`enqueueStatusNotice` also records an `email_replies` row of kind `notice` for a request with an active binding, with the same template, language and parameters and the booking link sealed as the secret, replying to the binding's latest received message. At dispatch the notice is suppressed when its condition no longer holds (the same check as the email delivery) or the binding is no longer active. The thread therefore gets the same four notices as the contact address. The booking confirmation stays a Cloudflare email with the calendar part.

### 8. Records

| Table | Holds |
|---|---|
| `email_receivers` | ID, inbox ID, AgentMail webhook ID, secret fingerprint, state (`enabled`, `disabled`), created and disabled times. One enabled receiver per inbox |
| `email_receipts` | ID, receiver, event ID, Svix ID, event type, inbox, thread and message IDs, payload SHA-256, received time, outcome (`forwarded`, `linked`, `started`, `ignored`, `refused`) |
| `email_threads` | ID, request, inbox and thread IDs, origin (`started`, `linked`), keyed hash of the bound address, state (`active`, `unlinked`, `closed`), latest received message ID, closed-notice time, bound and ended times. One active binding per thread and per request |
| `email_links` | ID, request, code hash, sealed code, state (`pending`, `consumed`, `voided`), retry key, expiry, created, consumed and voided times, the binding it created |
| `email_replies` | ID (the idempotency key), request, binding, kind (`turn`, `link_confirmation`, `start_refusal`, `closed`, `too_long`, `notice`), dedupe key, inbox and replied-to message IDs, input, template, language, parameters, frozen text, sealed secret, state (`waiting`, `queued`, `dispatching`, `accepted`, `rejected`, `uncertain`, `suppressed`), first dispatch time, provider message ID, evidence |

All have row-level security and no grants to `anon` or `authenticated`.

### 9. Retention

`app.cleanup_email_records(limit)` runs every 15 minutes (D4): it deletes receipts older than 30 days, bindings and consumed or voided links of requests created more than 30 days ago, and replies in a final state older than 30 days. A request's closure marks its active binding `closed`, so nothing more is forwarded. Final replies already hold no text or secret.

### 10. Testing

- Unit: Svix verification (valid, wrong secret, stale timestamp, several signatures), code generation and parsing, sender evidence, reply text extraction from recorded events.
- Integration against the local stack with a fake AgentMail (`tests/integration/support/fake-agentmail.ts`): the receiver's dedupe, conflict, disabled and replaced receivers and unsupported events; starting by email to a first reply in the thread through a real `eve dev` with the OpenAI stand-in; linking, voiding and unlinking; forwarded and foreign senders; a reply with a lost response retried with the same key; thread notices; the messaging gate.
- Browser: the **Continue by email** card on the booking page, keyboard-operable at 390 and 1280 pixels.
- Database: the new tables are unreachable from client roles.

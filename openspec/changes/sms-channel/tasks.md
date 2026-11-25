# Tasks

## 1. Review and gateway spike

- [ ] 1.1 Get a teammate's review of D1–D16 and the modified requirements, and record the outcome in the decision log's "SMS channel scope" section (verify: the section names the reviewer and date).
- [ ] 1.2 With the user, set up and record the gateway phone (verify: provider setup has an "SMS Gate" section listing the device, settings, plan limits and the carrier's answer, with the date):
  - check the carrier plan's daily send limit, its international SMS coverage, and whether its terms allow a service to relay texts over the SIM;
  - an Android phone with a dedicated Korean SIM;
  - SMS Gate in cloud mode with end-to-end encryption (note the device ID), a signing key, a ping interval and a send-rate limit;
  - SMS Gate's local history off or limited, and the message app set to delete old threads;
  - webhooks registered through `POST /3rdparty/v1/webhooks` to a temporary HTTPS receiver.
- [ ] 1.3 On that phone, record these in provider setup (verify: each has a dated line, and the D10 mapping names the observed failure reasons):
  - a send to a Korean number and to a US number, with the `sms:sent`, `sms:delivered` and `sms:failed` events;
  - an inbound text and its `sms:received` payload, with the sender format;
  - a long Korean text and how its parts arrive;
  - what SMS Gate does with a repeated message `id`;
  - how long the cloud keeps a message while the phone is off;
  - the `X-Signature` check against a captured body.

## 2. Records and contracts

- [ ] 2.1 In `supabase/schemas/`, add `sms` to the `channel` checks and `channel_usage`, the consent columns and their check on `imessage_links`, the `sms_consents` table with RLS and grants matching the `imessage_*` tables and its four-year cleanup, the delivery columns on `imessage_outbox` if needed, and `sms_gateway_health`. Generate the migration with `supabase db schema declarative sync --name sms_channel --no-apply` and review it (verify: `supabase db reset --local` succeeds; pgTAP tests reject an SMS link without consent and show that cleanup keeps a consent row past 30 days and deletes it after four years).
- [ ] 2.2 In `lib/contracts/`, add `sms` to `MESSAGING_CHANNELS`, `GUEST_CHANNELS`, the device table (Apple: iMessage; everything else: SMS first), `configuredChannels` (including gateway health), the `[SMS] ` prefix and `cameFromMessagingChannel` (verify: `messaging-channel.test.ts` covers the Android, Apple and other device rows with SMS configured, unconfigured and stale).
- [ ] 2.3 Fill every `Record<StoredChannel>` map in `lib/server/channel-texts.ts`, including the fixed SMS keyword texts, and the agent tools' channel enums (verify: `npm run typecheck` passes).

## 3. Transport and webhook

- [ ] 3.1 Write `lib/server/sms-gate.ts`: the send with the outbox row ID as message ID and delivery reports, end-to-end encryption, the D10 mapping, `X-Signature`/`X-Timestamp` verification, the event parser and E.164 normalization (verify: unit tests for each outcome category, a bad and a stale signature, a national-format sender, a foreign `recipient`, a media-only message and an unknown event).
- [ ] 3.2 Add `agent/channels/sms.ts` (`POST /sms/webhook`) storing `sms:received` receipts through `storeReceipt` before `200`, applying delivery events to outbox rows and heartbeats to gateway health. Verify with integration tests:
  - a signed event posted twice gives one receipt;
  - the same ID with another body gets `409`;
  - an unconfigured key gets `404`;
  - `sms:failed` annotates the row without a resend.
- [ ] 3.3 Add an SMS Gate stand-in to `tests/integration/support/` and `tests/e2e/support/`: the send endpoint with error answers, plus a signed event sender for received, sent, delivered, failed and ping events (verify: the tests in 3.2 and groups 4–5 run against it).
- [ ] 3.0 Add `npm run sms:webhooks`, which registers the six events through `POST /3rdparty/v1/webhooks` and lists the registrations (verify: running it against the stand-in registers six and a second run changes nothing).
- [ ] 3.4 Route SMS rows through the SMS transport in the outbox, parking rows that are unavailable for the phone cap or a stale gateway without spending send attempts. Add the per-recipient 24-hour cap with its single notice, the per-phone hourly cap, and the stale-gateway gate, and send no buttons, pictures or extras on SMS. Verify with integration tests:
  - the notice at the recipient cap, and a message suppressed after it;
  - sending resuming as the window slides, with no second notice;
  - phone-cap waiting;
  - a stale gateway holding sends for longer than five attempts' worth of retries, then releasing them on a ping with nothing failed;
  - `uncertain` never resent.

## 4. Linking, keywords and conversation

- [ ] 4.1 Host SMS attempts: refuse one without the current consent version; store the version and time; reuse the `FMAT-` code rules; bind on arrival; void on a code from another channel; write and close `sms_consents` rows with the binding (verify: integration tests for each scenario in "Linking SMS by a host-sent code after consent" and "SMS consent record").
- [ ] 4.2 `/?flow=sms`: the browser-owned start with the consent gate, binding at sign-in and from the reply's sign-in link (verify: integration tests for each "SMS start before sign-in" scenario).
- [ ] 4.3 SMS keywords on receipts for every sender (English and Korean opt-out, `HELP`, `START`): end host and guest bindings together, send each fixed reply once a day, and keep them away from the assistant (verify: integration tests for `STOP`, `수신거부`, a number that is host and guest, a repeated `STOP`, and `HELP`).
- [ ] 4.4 Actions by SMS: `approve_proposal`, `decline_request`, `share_changes`, `dismiss_changes`, `confirm_settings` and settings changes refuse an SMS turn whose inbound text lacks the current reference, and Thyme answers with the exact text (verify: integration tests for "yes, book it" and "confirm my settings" changing nothing, and each action with its reference working).
- [ ] 4.5 Host conversation over SMS: commands, summaries, setup and schedule lookup reuse the iMessage paths with the `[SMS] ` prefix and per-channel unlinked counts, and a schedule image request is answered in words. Add the SMS sections to `agent/instructions/` and to the requester instructions served from `lib/server/entry-documents.ts:130`: 480 characters, plain text, references written out (verify: an integration test asks for a schedule image by SMS and finds only a text reply).
- [ ] 4.6 Guest SMS: linking from `requester-imessage-links.ts` with consent, a code on another channel voiding the attempt, the agent's connect token sealed to `{ requestId, channel: "sms" }` that creates the attempt on tick, guest routing, the agreement notice, and guest opt-out (verify: integration tests for each `guest-sms-channel` scenario and the `meeting-requests` "Guest linked by SMS agrees" scenario).
- [ ] 4.7 Operational diagnostics report a stale SMS gateway, and channel usage records count SMS (verify: unit tests for diagnostics with a stale and a fresh heartbeat, and a `channel_usage` test with an SMS row).

## 5. Web

- [ ] 5.1 Add the SMS card states to the link step, the linking card, the landing's `/?flow=sms`, the booking page's **Get updates by text** and the agent connect page. Each shows the consent checkbox, **Get my code** disabled until ticked, the encryption and rates sentence, the deep link (QR and **Copy** on computers), and the masked number with unlink (verify: component tests, and a Playwright test that the code stays hidden until the box is ticked and the link completes against the stand-in).
- [ ] 5.2 The device rule in the UI: Apple devices offer iMessage first, every other device offers SMS first, and a stale gateway removes SMS (verify: Playwright tests with Android, iPhone and Windows user agents).

## 6. Documents

- [ ] 6.1 Update the owning documents and regenerate their `ko/` mirrors (verify: `npm run lint` and the documentation check pass, and each document names SMS where it lists channels):
  - provider setup's SMS Gate section, env vars and the phone's operating routine;
  - `.env.example`, fixing the malformed `TELEGRAM_API_URL` line too;
  - the PRD channel lists and FR-37;
  - the implementation plan and decision log;
  - the page list's *Channel link*, interfaces, host onboarding flow and user journeys;
  - frontend architecture and agent configuration;
  - the privacy notice (SMS Gate's relay with end-to-end encryption, the carrier, the consent record);
  - the operations runbook (what to do when the gateway is stale);
  - the testing baseline.

## 7. Integration and release checks

- [ ] 7.1 Run `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration` and `npm run test:e2e` (verify: all pass, and any check that cannot run is reported).
- [ ] 7.2 After the user sets the Production variables, check on real phones and record dated rows in the acceptance record:
  - an Android host and a guest link by SMS;
  - a proposal is approved with its reference, and "yes" alone approves nothing;
  - `STOP` and `수신거부` end the bindings with one confirmation;
  - with the gateway phone switched off for 35 minutes, SMS is not offered, and a summary waits and is sent after it returns.

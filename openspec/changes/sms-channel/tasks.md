# Tasks

## 1. Review, prerequisite and spike

- [ ] 1.1 Get a teammate's review of D1–D15 and the modified requirements, and record the outcome in the decision log's "SMS channel scope" section (verify: the section names the reviewer and date).
- [ ] 1.2 Confirm PR #492 (#488 consent checkbox, `smsConsent`, policy clauses) is merged to `main` before task group 5 (verify: `git log origin/main` contains it).
- [ ] 1.3 With the user's approval, buy a Photon SMS number, create a project API key and a Beta webhook destination, then send and receive one SMS on a real phone. Record in provider setup: the send endpoint and body, the inbound event type, `platform` value and sender/space fields, and whether STOP/HELP/START reach the webhook. If SMS arrives on the Spectrum webhook instead, revise the specs as design section 2 says before task group 3 (verify: the provider setup "Photon SMS" section lists each fact with the date seen). Status 2026-11-26: the send path, users, spaces and event types are recorded. Inbound, STOP and delivery wait for an approved campaign assigned to the line.
- [ ] 1.4 In the same spike, send to a `+82` number and to an opted-out number, and record each problem `code` and status (verify: the codes appear in provider setup and in the D10 mapping). Status 2026-11-26: before a campaign, `+82` got `409 SMS_CAMPAIGN_NOT_ELIGIBLE`; retest after approval.

## 2. Records and contracts

- [ ] 2.1 In `supabase/schemas/`: add `sms` to the `channel` checks and `channel_usage`; add `sms_consent_version`/`sms_consent_at` with their check on `imessage_links`; add the `sms_consents` table with RLS and grants matching the `imessage_*` tables, plus its four-year cleanup. Generate the migration with `supabase db schema declarative sync --name sms_channel --no-apply` and review it (verify: `supabase db reset --local` succeeds; pgTAP tests reject an SMS link without consent and show cleanup keeps a consent row past 30 days and deletes it after four years).
- [ ] 2.2 Add `sms` to `MESSAGING_CHANNELS`, `GUEST_CHANNELS`, the device table, `configuredChannels`, the `[SMS] ` prefix and `cameFromMessagingChannel` in `lib/contracts/` (verify: `messaging-channel.test.ts` covers the Android, Apple and other device rows with and without SMS and WhatsApp configured).
- [ ] 2.3 Fill every `Record<StoredChannel>` map in `lib/server/channel-texts.ts` and the agent tools' channel enums (verify: `npm run typecheck` passes).

## 3. Transport and webhook

- [ ] 3.1 Write `lib/server/photon-sms.ts`: send with an idempotency key, the D10 error mapping, Standard Webhooks verification and the inbound parser from the spike's facts, with media ignored (verify: unit tests for each outcome category, a bad signature, a stale timestamp, a group message, a media-only message and a non-message event).
- [ ] 3.2 Add `agent/channels/photon-sms.ts` (`POST /photon/sms/webhook`) storing receipts through `storeReceipt` before `200` (verify: integration tests: a signed event posted twice gives one receipt; the same ID with another body gets `409`; an unconfigured secret gets `404`; a Spectrum-signed request to this route and a Standard-Webhooks-signed request to `/photon/webhook` are both refused).
- [ ] 3.3 Extend both Photon stand-ins (`tests/integration/support/fake-photon.ts`, `tests/e2e/support/fake-photon-server.ts`) with `/sms/messages`, opted-out and unsupported-number answers, and a signed SMS webhook sender (verify: the tests in 3.2 and groups 4–5 run against them).
- [ ] 3.4 Route SMS rows through the SMS transport in the outbox, add the 24-hour cap with its single notice, and send no buttons, pictures or extras on SMS (verify: integration tests for the notice at the cap, a suppressed message after it, sending resuming as the window slides with no second notice, `blocked` ending the bindings and `uncertain` never resent).

## 4. Linking, keywords and conversation

- [ ] 4.1 Host SMS attempts: refuse an attempt without the current consent version, store version and time, reuse the `FMAT-` code rules, bind on arrival, void on a code from another channel, register nothing with Photon, and write and close `sms_consents` rows with the binding (verify: integration tests for each scenario in "Linking SMS by a host-sent code after consent" and "SMS consent record").
- [ ] 4.2 `/?flow=sms`: the browser-owned start with the consent gate, binding at sign-in and from the reply's sign-in link (verify: integration tests for each "SMS start before sign-in" scenario).
- [ ] 4.3 Opt-out keywords on SMS receipts for every sender, ending host and guest bindings together, plus silent `stop`/`unlink`/`help` on SMS in `imessage-commands.ts` (verify: integration tests show `STOP` from a number bound as host and guest ends both with no outbox row, and `HELP` starts no turn).
- [ ] 4.4 Decisions by SMS: `approve_proposal` and `decline_request` refuse an SMS turn whose inbound text lacks the current reference, and Thyme answers with the exact text (verify: integration tests for "yes, book it" changing nothing and `approve <ref>-<version>` approving).
- [ ] 4.5 Host conversation over SMS: commands, summaries, setup and schedule lookup reuse the iMessage paths with the `[SMS] ` prefix and per-channel unlinked counts; a schedule image request is answered in words. Add the SMS sections to `agent/instructions/` and the requester instructions served from `lib/server/entry-documents.ts:130` (480 characters, plain text, references written out) (verify: an integration test asks for a schedule image by SMS and finds no picture row, only a text reply).
- [ ] 4.6 Guest SMS: linking from `requester-imessage-links.ts` with consent, a code on another channel voiding the attempt, the agent's connect token sealed to `{ requestId, channel: "sms" }` that creates the attempt on tick, guest routing, the agreement notice, and guest opt-out (verify: integration tests for each `guest-sms-channel` scenario and the `meeting-requests` "Guest linked by SMS agrees" scenario).

## 5. Web

- [ ] 5.1 The SMS card states in the link step, the linking card, the landing's `/?flow=sms`, the booking page's **Get updates by text** and the agent connect page. Each shows the consent checkbox, **Get my code** disabled until it is ticked, the encryption and rates sentence, the deep link (QR and **Copy** on computers) and the masked number with unlink (verify: component tests, and a Playwright test that the code stays hidden until the box is ticked and that the link completes against the stand-in).
- [ ] 5.2 The device rule in the UI: Android without WhatsApp offers SMS first, and every device lists SMS among its switches (verify: Playwright tests with Android, iPhone and Windows user agents).

## 6. Documents

- [ ] 6.1 Update the owning documents and regenerate their `ko/` mirrors (verify: `npm run lint` and the documentation check pass, and each document names SMS where it lists channels):
  - provider setup: the Photon SMS section and env vars;
  - `.env.example`, fixing the malformed `TELEGRAM_API_URL` line too;
  - the PRD channel lists and FR-37;
  - the implementation plan and decision log;
  - the page list's *Channel link*, interfaces, host onboarding flow and user journeys;
  - frontend architecture and agent configuration;
  - the privacy notice (Photon as SMS carrier, the consent record and its four-year retention);
  - the testing baseline.
- [ ] 6.2 Rewrite the 10DLC campaign's opt-in description to match the shipped SMS card (checkbox → **Get my code** → texted code), with a public screenshot of that card, and record the submitted text in provider setup. Do this before the campaign is submitted or resubmitted (verify: provider setup quotes the text and the screenshot URL opens without sign-in).

## 7. Integration and release checks

- [ ] 7.1 Run `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration` and `npm run test:e2e` (verify: all pass, and any check that cannot run is reported).
- [ ] 7.2 After the user sets the Production variables, check on a real phone and record dated rows in the acceptance record: link a host and a guest by SMS, approve a proposal with its reference, check that "yes" alone approves nothing, and text `STOP` to confirm the bindings end with only Photon's reply.

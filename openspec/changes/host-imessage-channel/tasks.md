# Tasks

Group 1 records the decisions and is serial. Group 2 is the plan's Lane A (spike, receiver and transport), group 3 its Lane B (the linking card) and group 4 its Lane C (channel, commands, summaries and setup). Lanes B and C are built against stored receipts and the stand-in transport, so they do not wait for a real line. Group 5 is the join and group 6 the release, which is blocked on the user.

Before each group, read the [Phase 6 reference repository files](../../../documentations/technical_specification/06_implementation_plan.md#5-reference-repositories-per-phase) and name the files and revisions followed in the pull request. Evidence goes to the [acceptance record](../../../documentations/technical_specification/07_acceptance_record.md) with command, date, revision and environment.

## 1. Decisions (serial, first)

- [x] 1.1 Record D1–D14 from the [proposal](proposal.md#decisions) in the proposal, the design, the delta spec and the [decision log](../../../documentations/technical_specification/08_decision_log.md#phase-6--host-imessage-channel). Verify `openspec validate host-imessage-channel --strict` and `npm run check` pass.

## 2. Spike, receiver and transport (Lane A)

- [x] 2.1 Record the spike ([design 1](design.md#1-the-transport-spike-and-the-adapter)) and the sender identifier format in the provider setup and the agent configuration.
- [x] 2.2 Add `imessage_receipts`, `imessage_links`, `imessage_bindings` and `imessage_outbox` ([design 15](design.md#15-records)) with row-level security, generate the migration with `supabase db schema declarative sync --no-apply`, and verify `supabase db reset --local` and the grant tests.
- [x] 2.3 Add the signature check, the receiver (`lib/server/photon-receiver.ts`), the `agent/channels/photon.ts` route and its `vercel.ts` route ([design 2](design.md#2-receiver-and-receipts)). Verify unit tests for the signature and payload, and integration tests for a receipt and job stored before `200`, a duplicate, a changed payload (`409`), a stale signature, another webhook's delivery and an ignored event.
- [x] 2.4 Add the transport (`lib/server/photon.ts`) with the Spectrum adapter and the loopback stand-in behind the messaging gate, the outbox and the `imessage_send` job ([design 3](design.md#3-the-transport-and-the-outbox)). Verify tests for accepted, rejected, unavailable and uncertain sends, suppression after unlinking and the gate in a preview.

## 3. Linking card (Lane B)

- [x] 3.1 Add the linking commands and `/api/host/imessage` routes ([design 4](design.md#4-linking-by-a-host-sent-code), [design 6](design.md#6-the-fallback-code)) and the receipt job's linking side. Verify integration tests for a code bound only after confirmation, a wrong, expired, replayed and foreign code, a sender bound to another host, the fallback's limits and wrong entries, unlinking without Photon, and exact retries.
- [x] 3.2 Add the **Connect iMessage** card with the one-tap deep link, the inline fallback with **Copy** and the QR code, the masked-sender confirmation, **Send me a code instead**, the connected card with **Unlink**, delivery failure, and **Add to contacts** ([design 5](design.md#5-the-one-tap-deep-link), [design 11](design.md#11-add-to-contacts)). Verify unit tests for platform detection and deep links, and a Playwright journey at 390 and 1280 pixels by keyboard.

## 4. Channel and commands (Lane C)

- [x] 4.1 Add the receipt job's channel side ([design 7](design.md#7-what-an-inbound-message-may-do)): order, backpressure, unlinked and group senders, non-text content. Verify integration tests for each row of the table.
- [x] 4.2 Add the exact commands and references ([design 8](design.md#8-exact-commands)). Verify tests for each command, stale and ambiguous references, a replayed approval after a restart while a web action occurs, and "yes" forwarded rather than approving.
- [x] 4.3 Add forwarding and turn replies ([design 9](design.md#9-forwarding-and-replies)) with the host instruction fragment. Verify an integration test through `eve dev` with the OpenAI stand-in for a forwarded message and its reply, and the fallback text.
- [x] 4.4 Add the host summaries ([design 10](design.md#10-summaries-and-outcomes)) and the failure display in `/app`. Verify tests for each summary queued once, suppression after unlinking and a failed delivery shown on the web with no change to the request.
- [x] 4.5 Add setup over iMessage ([design 12](design.md#12-setup-over-imessage)) and the retention cleanup ([design 13](design.md#13-retention)). Verify tests for `setup`, `review` and `confirm` with a stale reference, and the cleanup.

## 5. Join

- [x] 5.1 Against the stand-in Photon, the OpenAI stand-in and the local stack: link by code, select a request, ask a private question, revise, approve the resulting proposal; decline a second request; replay the approval; simulate a failed delivery. Record the Phase 6 evidence list for what fixtures can prove.

## 6. Release (blocked on the user)

- [ ] 6.1 Provision the Photon line, set `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET`, `PHOTON_LINE_NUMBER`, `PHOTON_WEBHOOK_ID` and `PHOTON_WEBHOOK_SECRET` in Production, and register the webhook for `{origin}/photon/webhook`.
- [ ] 6.2 Push the migration to `anelszynxtvxoxqvzgqt` after a shown dry run and deploy.
- [ ] 6.3 On a controlled iPhone with the user present: the one-tap deep link on iOS Safari and in the Messages app, the QR code from a desktop, the sender identifier, linking, AC-16, AC-17 and AC-18 including replay after a restart and a simulated delivery failure; record device and client versions.
- [ ] 6.4 Teammate review of D1–D14, then `openspec archive host-imessage-channel`.

## 7. Link screens (D15–D18, user 2026-10-23)

- [x] 7.1 Add the iMessage start before sign-in: the start attempt, `/api/imessage/start`, the receipt job's handling and the claim in the Google callback ([design 14](design.md#14-the-link-screens-the-app-link-step-and-the-imessage-start-d15d18)). Verify integration tests for a start bound only after sign-in and confirmation, another browser seeing nothing, a replaced and an expired start, a sender held by another host refused at confirmation, the per-source bound, and the callback's claim and cleared cookie.
- [x] 7.2 Add the ink landing (both starts, the language menu, the Calendar box with identity-only sign-in, the agent section) and the /app link step with the send panel and popup, and stop offering the fallback in the card. Verify unit tests for the Mac platform, the identity-only sign-in, and Playwright journeys for the link step, the skip, the landing popup, an iPhone's deep link and the landing language.
- [ ] 7.3 On a controlled iPhone and Mac with a provisioned line: Open Messages from the link step and the landing on iOS Safari (including after the code request), the QR code from a desktop, and whether a Mac's Messages takes the prefilled body (D17). On 2026-10-23, with the `fmat-spike` line: the landing's Open Messages on iOS Safari and on the Mac filled in the line and the body, and the sent code turned the page to received. Still open: the link step on a phone and the QR code.

## 8. Carrying on in iMessage (D19, user 2026-10-23)

- [x] 8.1 Add the sign-in link in Thyme's reply to a code from the iMessage start, `/imessage/continue` and its claim in the Google callback ([design 17](design.md#17-carrying-on-in-imessage-the-sign-in-link-the-welcome-and-the-calendar-link-d19)). Verify integration tests for the reply's link, a claim by one host only and again by the same host, tampering, an expired attempt, the link ending at confirmation, the route through local Auth with its cookie set and cleared, and a used link leading back to the iMessage start.
- [x] 8.2 Send the welcome by where the host stands, the Calendar link from the welcome, `setup` and the agent, and one "back from Google" message after signing in from it. Verify integration tests for the three welcomes, a plain reply reaching the setup discussion, and a replayed callback queuing one message.
- [ ] 8.3 On a controlled iPhone with the line: the welcome after **Confirm and link**, a plain reply and the next setup question, the Calendar link from iMessage and its "back from Google" message. On 2026-10-23, through a local receiver with a temporary local override outside the repository, an earlier fixed welcome arrived and a reply brought the next setup question. Google sign-in from a phone needs a callback the phone can reach, which a local run does not have.

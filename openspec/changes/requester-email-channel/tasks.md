# Tasks

Group 1 records the decisions and is serial. Group 2 is the plan's Lane A (ingress), groups 3 and 4 its Lane B (channel and linking); Lane B's forwarding is built against stored receipts, so it does not wait for a real inbox. Group 5 is the join and group 6 the release, which is blocked on the user.

Before each group, read the [Phase 7 reference repository files](../../../documentations/technical_specification/06_implementation_plan.md#5-reference-repositories-per-phase) and name the files and revisions followed in the pull request. Evidence goes to the [acceptance record](../../../documentations/technical_specification/07_acceptance_record.md) with command, date, revision and environment.

## 1. Decisions (serial, first)

- [x] 1.1 Record D1–D11 from the [proposal](proposal.md#decisions) in the proposal, the design, the delta specs and the [decision log](../../../documentations/technical_specification/08_decision_log.md#phase-7--requester-email-channel). Verify `openspec validate requester-email-channel --strict` and `npm run check` pass.

## 2. Ingress (Lane A)

- [x] 2.1 Add `email_receivers` and `email_receipts` ([design 8](design.md#8-records)) with row-level security, generate the migration with `supabase db schema declarative sync --no-apply`, and verify `supabase db reset --local` and the grant tests.
- [x] 2.2 Add the Svix verification, the receiver (`lib/server/agentmail-receiver.ts`), the `agent/channels/agentmail.ts` route and its `vercel.ts` route ([design 1](design.md#1-the-channel-and-the-receiver)), and the `email-receiver` operator commands. Verify unit tests for signatures and integration tests for a stored receipt and job before `204`, concurrent identical deliveries, a lost response, a changed retry (`409`), a disabled, replaced or unknown receiver, a stale signature, an unsupported event, and that the receipt holds no body or sender.

## 3. Thread binding and forwarding (Lane B)

- [x] 3.1 Add `email_threads`, `email_links` and `email_replies` and the AgentMail transport (get message, reply with `Idempotency-Key`) behind the messaging gate. Verify unit tests for the transport's outcome classification and the gate.
- [x] 3.2 Add the `email_receipt` job ([design 5](design.md#5-what-a-message-must-prove)): sender evidence, starting by email ([design 3](design.md#3-starting-by-email)), forwarding into the request's discussion, the closed, over-long and unknown-host replies. Verify integration tests for a start, a reply forwarded once across a retried job, a spoofed sender, a copied recipient, a closed request, a reply in an unbound thread, and an admission refusal that keeps the receipt pending.
- [x] 3.3 Add the `email_reply` job and the session-owner wake-up ([design 6](design.md#6-replies)). Verify integration tests, with the session's recorded events, for a reply with the turn's final text in the same thread, a lost response retried with the same key, the 23-hour horizon, a refusal, an unlinked thread and the fallback; the real `eve dev` run is task 5.1.

## 4. Linking and notices (Lane B)

- [x] 4.1 Add `request.email_link.create` and `request.email_link.unlink`, the `/api/requests/{bookingId}/email-link` route and the binding by code ([design 4](design.md#4-continue-by-email)). Verify integration tests for an unconfirmed contact, a code bound as written, a forwarded code, an expired code, a code in an existing thread, a replaced binding, unlinking without AgentMail, and the exact retry.
- [x] 4.2 Add the **Continue by email** card with **Check email link**, **Unlink email** and **Retry same linking action**, and the email start link on the public host page. Verify a Playwright check of the card by keyboard at 390 and 1280 pixels.
- [x] 4.3 Add thread notices ([design 7](design.md#7-thread-notices)) and the retention cleanup ([design 9](design.md#9-retention)). Verify integration tests for each notice in the thread, suppression after unlinking, and the cleanup.

## 5. Join

- [ ] 5.1 A requester starts by email, confirms the address, continues at the booking link and receives thread notices, and an old-option reply cannot book (AC-05); a web requester links a thread and continues by email (AC-11). Run the Phase 7 evidence list against the fake AgentMail, the fake Cloudflare, the OpenAI stand-in and the local stack, and record it.

## 6. Release (blocked on the user)

- [ ] 6.1 Create `findmeatime@agentmail.to` (blocked by the three-inbox limit), create the webhook at AgentMail for `message.received`, register the receiver with the operator CLI, and set `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID` and `AGENTMAIL_WEBHOOK_SECRET` in Production.
- [ ] 6.2 Push the migration to `anelszynxtvxoxqvzgqt` after a shown dry run, deploy, and record real multi-turn delivery with a team-controlled address.
- [ ] 6.3 Teammate review of D1–D11, then `openspec archive requester-email-channel`.

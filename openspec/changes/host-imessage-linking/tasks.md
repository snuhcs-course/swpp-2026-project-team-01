# Tasks

## 1. Decisions

- [ ] 1.1 Settle the rest of open decision 1: a Google identity that already belongs to another host, and the per-source and per-number limits on anonymous starts. Until then the iMessage start stays in demo mode.
- [ ] 1.2 Settle open decision 2 from spike step 6 and record it in the design.
- [ ] 1.3 After #22 merges, write the MODIFIED deltas for `chat-workspaces`, `host-admission`, `email-delivery` and `public-agent-entry` that allow phone sign-up and sign-in (D10).

## 2. Spike

- [ ] 2.1 Run the [spike](design.md#spike) on a controlled iPhone and record the results, device and client versions in the design.
- [ ] 2.2 Choose the native eve Photon channel or an application-owned receiver from that evidence and record the sender identifier format.

## 3. Documents

- [ ] 3.1 Update each document in the [differences table](proposal.md#differences-from-the-current-documents) to the agreed flow, including the implementation plan's Phase 6 Lane B and risk table and the [OpenSpec status](../../README.md).
- [ ] 3.2 Regenerate the `ko/` mirror of every English document changed in 3.1.

## 4. Implementation (after #22 merges and 2.2)

- [ ] 4.1 Move `phone-link.ts` into `lib/contracts/` unchanged, with unit tests for the schema.
- [ ] 4.2 Add the connection, outbound attempt and inbound event tables in `supabase/schemas/`, generate the migration with pg-delta, and add `supabase test db` tests for one active claimant per number and owner-only reads.
- [ ] 4.3 Implement the routes and the rules in [design §2](design.md#2-server-rules-from-the-screens-and-the-demo-linker) with unit tests for spacing, the window, expiry, wrong replies and lockout.
- [ ] 4.4 Implement the outbound sender and the webhook receiver and processor, with integration tests for duplicate delivery, restart before processing and a lost send result.
- [ ] 4.5 Port the phone and verify screens into `apps/web/app` for the Google start, removing the STOP sentence from the consent line, keeping the demo linker for tests, and add a Playwright journey through sign-in, number, wrong reply and connection against a provider stand-in.

## 5. Acceptance

- [ ] 5.1 On a controlled iPhone against production: link, wrong reply, lockout, expiry, number without iMessage, unlink. Record the results in the acceptance record.

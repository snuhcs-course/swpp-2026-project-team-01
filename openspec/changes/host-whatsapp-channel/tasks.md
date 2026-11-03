# Tasks

Group 1 records the decisions and is serial. Group 2 is the plan's Lane A (routing, records and transport), group 3 its Lane B (linking in the browser) and group 4 its Lane C (window, templates and the reused channel behavior). Lanes B and C are built against stored receipts and the stand-in transport, so they do not wait for a real line. Group 5 is the join and group 6 the release, which is blocked on the user.

Before each group, read the [Phase 9 reference files](../../../documentations/technical_specification/06_implementation_plan.md#phase-9--host-whatsapp-channel) and name the files and revisions followed in the pull request. Evidence goes to the [acceptance record](../../../documentations/technical_specification/07_acceptance_record.md) with command, date, revision and environment.

## 1. Decisions (serial, first)

- [x] 1.1 Record D1–D13 from the [proposal](proposal.md#decisions) in the proposal, the design, the delta spec and the [decision log](../../../documentations/technical_specification/08_decision_log.md#phase-9--host-whatsapp-channel); update the PRD with the 2026-11-02 audience decision, FR-37 to FR-39 and AC-29 to AC-31. Verify `openspec validate host-whatsapp-channel --strict` and `npm run check` pass.
- [ ] 1.2 Teammate review of D1–D13 and the open questions in the [design](design.md#open-questions), especially the template wording, languages and coalescing.

## 2. Routing, records and transport (Lane A)

- [x] 2.1 Add the `channel` column, the outbox's `template_name` and the new categories to the four `imessage_*` tables ([design 4](design.md#4-records)); generate the migration with `supabase db schema declarative sync --no-apply`, and verify `supabase db reset --local`, the grant tests and that existing rows read as `imessage`.
- [x] 2.2 Add `inboundWhatsAppMessage` and `normalizeWhatsAppSender` in `lib/server/whatsapp.ts` and route by platform in `receivePhotonWebhook` ([design 2](design.md#2-receiver-routing), [design 3](design.md#3-sender-identity)). Verify unit tests for each accepted spelling, a mixed event, an unlabelled event, a group, a mismatched space and the separate hash namespace, and keep PR #63's iMessage tests passing unchanged.
- [x] 2.3 Add the WhatsApp provider and template sends to `lib/server/photon.ts`, the error mapping, and the stand-in's WhatsApp branch with its 131047 switch ([design 1](design.md#1-transport), [design 9](design.md#9-transport-and-outbox)). Verify tests for accepted, rejected, `window_closed`, `template_unavailable`, rate-limited, unavailable and uncertain sends, and the gate in a preview.

## 3. Linking in the browser (Lane B)

- [x] 3.1 Take the channel in `imessage.link.create`, complete WhatsApp attempts only from WhatsApp receipts, and end the other channel's binding on confirmation ([design 5](design.md#5-one-channel-per-host), [design 6](design.md#6-linking)). Verify integration tests for a code bound only after confirmation, a code from the wrong channel, the replacement of an iMessage binding with suppression of its queued rows, and exact retries.
- [ ] 3.2 Add the device rule in `lib/contracts/messaging-channel.ts`, the WhatsApp card states, **Use WhatsApp instead**, the app choice on other computers, the replacement notice and the opt-in sentence, in the card, the link step and `/?flow=whatsapp`. Verify unit tests for the rule and the `wa.me` link, and Playwright runs with Android, iPhone and Windows user agents.

## 4. Window, templates and channel behavior (Lane C)

- [ ] 4.1 Check the window at dispatch, suppress or reject free-form rows as [design 7](design.md#7-the-24-hour-window) says, and queue template rows under the 12-hour and daily limits ([design 8](design.md#8-templates)). Verify tests with a fixed clock for each row kind, a 131047 refusal, coalescing and the daily limit.
- [ ] 4.2 Add `stop` to the command parser, the `[WhatsApp]` transcript prefix, the host instructions' WhatsApp fragment, per-channel unlinked-sender limits and the `/app` notices for `window_closed` and `template_unavailable` ([design 10](design.md#10-reused-behavior)). Verify integration tests for an approval and a replay after restart, an ambiguous "yes", a stale reference, setup over WhatsApp and `stop`.
- [ ] 4.3 Update the page list, the interfaces, the host onboarding flow, the user journeys, the frontend architecture and the agent configuration, with their Korean mirrors.

## 5. Join

- [ ] 5.1 Capture one real WhatsApp event on the production webhook and update the parser's fixture from it (blocked on the user: it needs a message sent to the line).
- [ ] 5.2 On a controlled Android phone against the production deployment: link, select a request, revise, approve, decline; let the window close and receive a template; replay after restart and simulate a delivery failure. Record AC-29, AC-30 and AC-31 with device, WhatsApp and browser versions.

## 6. Release (blocked on the user)

- [ ] 6.1 Register the three templates in WhatsApp Manager and wait for approval; confirm the business display name and the line's messaging tier.
- [ ] 6.2 Set `PHOTON_WHATSAPP_NUMBER` and, if changed, `PHOTON_WHATSAPP_TEMPLATE_DAILY_LIMIT` on Vercel Production; apply the migration through the shared-project workflow; deploy.
- [ ] 6.3 Archive the change after `host-imessage-channel` with `openspec archive host-whatsapp-channel`, closing #66.

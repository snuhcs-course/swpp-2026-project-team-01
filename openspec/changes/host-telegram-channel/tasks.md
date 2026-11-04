# Tasks

Group 1 records the decisions and is serial. Group 2 is the plan's Lane A (webhook, records and transport), group 3 its Lane B (linking in the browser) and group 4 its Lane C (buttons, extras and the reused channel behavior). Lanes B and C are built against stored receipts and the Bot API stand-in, so they do not wait for the live bot. Group 5 is the join and group 6 the release, which is blocked on the user.

Before each group, read the [Phase 10 reference files](../../../documentations/technical_specification/06_implementation_plan.md#phase-10--host-telegram-channel) and name the files and revisions followed in the pull request. Evidence goes to the [acceptance record](../../../documentations/technical_specification/07_acceptance_record.md) with command, date, revision and environment.

## 1. Decisions (serial, first)

- [x] 1.1 Record D1–D13 from the [proposal](proposal.md#decisions) in the proposal, the design, the delta spec and the [decision log](../../../documentations/technical_specification/08_decision_log.md#phase-10--host-telegram-channel); update the PRD with the 2026-11-04 decision, FR-40 to FR-42 and AC-32 to AC-34. Verify `openspec validate host-telegram-channel --strict` and `npm run check` pass.
- [ ] 1.2 Teammate review of D1–D13 and the [open questions](design.md#open-questions), especially the buttons (D8) and the device rule (D7).

## 2. Webhook, records and transport (Lane A)

- [ ] 2.1 Add `telegram` to the `channel` checks of the four `imessage_*` tables ([design 4](design.md#4-records)); generate the migration with `supabase db schema declarative sync --no-apply`, and verify `supabase db reset --local`, the pgTAP tests and that existing rows are unchanged.
- [ ] 2.2 Add the update parser, sender normalization and callback parser in `lib/server/telegram.ts`, and `POST /telegram/webhook` in `agent/channels/telegram.ts` ([design 2](design.md#2-webhook), [design 3](design.md#3-sender-identity)). Verify unit tests for the secret check, each update type, groups, bots, a mismatched chat, duplicates and the separate hash namespace, and keep the Photon receiver tests passing unchanged.
- [ ] 2.3 Add the Bot API client, the error mapping, chat spacing and splitting to the transport, and the stand-in's Telegram branch ([design 1](design.md#1-transport), [design 9](design.md#9-transport-and-outbox)). Verify tests for accepted, `403` with the binding ended, `400`, `429` with `retry_after`, unavailable and uncertain sends, and the messaging gate in a preview.
- [ ] 2.4 Add `scripts/telegram-webhook.mjs` (`npm run telegram:webhook`) with its production-host guard; verify it against the stand-in.

## 3. Linking in the browser (Lane B)

- [ ] 3.1 Take channel `telegram` in `imessage.link.create`, complete Telegram attempts only from Telegram receipts with `/start <code>` or the code, keep the display name for confirmation, and end any other binding on confirmation ([design 5](design.md#5-one-channel-per-host), [design 6](design.md#6-linking)). Verify integration tests for a code bound only after confirmation, `/start` without a code, a code from the wrong channel, the replacement of an iMessage binding and exact retries.
- [ ] 3.2 Extend the device rule in `lib/contracts/messaging-channel.ts` to three configured channels, and add the Telegram card states, **Use Telegram instead**, the QR code, the replacement notice and the privacy sentence in the card, the link step and `/?flow=telegram`. Verify unit tests for the rule and the `t.me` link, and Playwright runs with Android, iPhone and Windows user agents, with and without WhatsApp configured.

## 4. Buttons, extras and channel behavior (Lane C)

- [ ] 4.1 Add the decision buttons, callback admission and answers, and button retirement ([design 7](design.md#7-inline-buttons)). Verify integration tests for an approval from a button, a decline, a stale tap, a tap from another user, a replayed callback after restart and the keyboard removed after a decision.
- [ ] 4.2 Add the leading `/` and bot mention to the command parser, `setMyCommands`, the typing indicator, silent delivery, the `[Telegram]` transcript prefix and the host instructions' Telegram fragment ([design 8](design.md#8-telegram-extras), [design 10](design.md#10-reused-behavior)). Verify integration tests for setup over Telegram, `stop` and `/stop`, a blocking update and literal requester markup.
- [ ] 4.3 Update the page list, the interfaces, the host onboarding flow, the user journeys, the frontend architecture, the agent configuration and the privacy policy, with their Korean mirrors.

## 5. Join

- [ ] 5.1 Capture one real Telegram update on the production webhook and update the parser's fixture from it (blocked on the user: it needs the webhook registered and a message sent to the bot).
- [ ] 5.2 On a controlled Android phone and an iPhone against the production deployment: link, select a request, revise, approve with a button, decline, tap a stale button, replay after restart, and block and unblock the bot. Record AC-32, AC-33 and AC-34 with device, Telegram and browser versions.

## 6. Release (blocked on the user)

- [ ] 6.1 Set the bot's name, description and picture in @BotFather; set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET` on Vercel Production.
- [ ] 6.2 Apply the migration through the shared-project workflow; deploy; run `npm run telegram:webhook` against production.
- [ ] 6.3 Archive the change after `host-imessage-channel` and `host-whatsapp-channel` with `openspec archive host-telegram-channel`, closing #111.

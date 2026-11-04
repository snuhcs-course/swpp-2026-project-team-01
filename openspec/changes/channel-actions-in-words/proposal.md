# Proposal

Tracking issue: #148 (folds in #137 and #138)

## Why

In the linked iMessage, WhatsApp and Telegram conversations, only approving a proposal ([`host-imessage-channel`](../host-imessage-channel/proposal.md) D23, #88) and switching requests (D26, #125) work in the host's own words. Declining, sharing or dismissing suggested changes and confirming settings still need an exact typed command (`decline <ref>`, `share <ref>`, `confirm <ref>`) or a web button, and the fixed replies tell the host which command to type. Those replies and the pickers are English even in a conversation held in Korean (#137), a host who is also a guest is stopped by an English picker that drops their message (#137), and the setup conversation cannot list the host's own requests (#138). The user decided on 2026-11-04 that natural language should work for everything, everywhere.

## What Changes

- **Every host action in words.** Thyme gets a tool for each decision that still needed a command: `decline_request`, `share_changes` and `dismiss_changes` in a request's review, and `confirm_settings` in setup. Each is guarded like `approve_proposal`: it acts only while the turn answers a message from the linked conversation, only on what the host was shown (the current proposal version, the pending suggestion, the current settings review), only on an open request, and once. Each runs the command the web button runs.
- **Questions in words.** Setup gains `list_host_requests` (#138), on the web and in the linked conversation. "Show me the review", "what changed" and "what requests do I have?" are answered by Thyme from `read_request`, `read_setup_state` and `list_host_requests`; the instructions say so.
- **Replies ask for no command.** Help, summaries, the settings review, the pickers and every fixed reply say what the host can tell Thyme instead of which command to type.
- **Replies follow the conversation's language.** Fixed replies and host notices are written in English and Korean and follow the host's message, or for a command word or button tap, the host's latest message to Thyme.
- **A sender with several conversations is asked in words (#137).** A message that names one of the sender's conversations in words (the host's own account, or a guest request by its host's name or reference) goes there; otherwise the choice is asked in the message's language, answerable in words.
- **Commands stay.** The exact commands keep working, unadvertised: reply buttons on WhatsApp and Telegram send them, and the receipt router's selection relies on `setup` and `request <ref>`.
- **Telegram switching.** `switch_conversation` also accepts a turn from Telegram, which it refused before.

## Decisions

Taken on 2026-11-04 in the session that wrote this change, from the user's instruction on #148. They have had no teammate review yet; the tasks' **Teammate review** box covers them.

| # | Decision | Choice |
|---|---|---|
| D1 | Tools ([design 1](design.md#1-tools-for-the-remaining-actions)) | `decline_request({ version })` (the current version, or null with no proposal), `share_changes({ suggestionId })`, `dismiss_changes({ suggestionId })` and `confirm_settings({ reviewRef })`, each refusing unless the session's current input came from a channel receipt and carries its prefix (`channelOfTurn`), and `list_host_requests` in setup. A repeated call answers "already" from the record. Rejected: a read-back confirmation before each decision, which D23 already rejected for approval |
| D2 | Exact commands ([design 2](design.md#2-exact-commands-stay-unadvertised)) | Every exact command keeps working before any model turn, as before, but no reply, help or summary names one. Rejected: forwarding typed command words to Thyme, which would break the reply buttons that send them, the selection that `setup` and `request <ref>` record for a sender with several conversations, and the Telegram command menu |
| D3 | Reply wording ([design 3](design.md#3-replies-that-ask-for-words)) | Each fixed reply says what to tell Thyme ("tell me to book it", "tell me which request you mean") or points to the browser; unlinking in words points to **Unlink** in `/app`, while `stop` still works |
| D4 | Reply language ([design 4](design.md#4-the-conversations-language)) | English and Korean, the product's languages. A message with Hangul is Korean, one with other letters English; a command word, button tap or message without letters follows the host's latest message to Thyme, else English. Rejected: handing every fixed reply to Thyme, which costs a model turn per button tap and cannot carry buttons |
| D5 | Several conversations ([design 5](design.md#5-a-sender-with-several-conversations)) | When a sender's next message has no current conversation, words that name exactly one choose it: saying they are the host ("호스트인데 나", "I'm the host") or a role word alone for the host's own account, or a guest request's reference, a whole word of its host's name, or a Korean name (given name with 님 or 씨); a guest role word alone when there is one guest request. A role mentioned in passing ("ask the host") names nothing. The choice is acknowledged, recorded as `setup` or `request <ref>` would record it, and the message goes on to that conversation. Otherwise the question names each conversation in words, in the message's language |

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `host-imessage-channel`: decisions and questions in words, commands kept but unadvertised, fixed replies in the conversation's language, Telegram switching.
- `requester-imessage-channel`: a sender with several conversations who names one in words reaches it; the question is asked in words and in the message's language.

## Impact

- `lib/server/host-review-tools.ts`, `setup-channel-tools.ts` (new), `setup-tools.ts`, `channel-selection.ts`, `channel-language.ts` (new), `channel-texts.ts` (new), `imessage-commands.ts`, `imessage-receipts.ts`, `imessage-notice-job.ts`, `request-ref.ts`.
- `agent/tools/request.ts`, `agent/tools/setup.ts`; `agent/instructions/host-imessage.ts`, `host-review.ts`, `host-setup.ts`.
- The PRD's channel requirements, the host UX documents, the agent configuration and the decision log, with their `ko/` mirrors.
- No schema change.

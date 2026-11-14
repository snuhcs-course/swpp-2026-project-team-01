# Design

## Context

See [proposal.md](proposal.md). [`host-imessage-channel`](../host-imessage-channel/design.md) design 19 (D23) made approval a tool, `approve_proposal`, that acts only for a message from the linked conversation, and design 21 (D26) did the same for `switch_conversation`. Everything else a host decides in the linked conversation still needed an exact command (design 8), whose fixed replies were English. This change finishes the pattern.

## Goals / Non-Goals

**Goals:** every host action in the linked iMessage, WhatsApp and Telegram conversations works in the host's own words; no reply asks the host to type a command; fixed replies follow the conversation's language; reply buttons keep working.

**Non-goals:** guest-side commands and texts beyond the picker and the routing it decides; unlinking in words; languages other than English and Korean for fixed replies (Thyme answers free text in any language); agents deciding over MCP or the CLI (#149, another change).

## Decisions

### 1. Tools for the remaining actions

Each tool passes its audience's fence (`authorizeHostReviewTool` or `authorizeSetupTool`) and then `channelOfTurn(db, sessionId, hostAccountId)` (`lib/server/channel-selection.ts`): the session's current input, the message this turn answers, must have been recorded by the receipt job (its client input ID is a receipt's ID) and start with that receipt's channel prefix, `[iMessage] `, `[WhatsApp] ` or `[Telegram] `. A message typed on the web refuses even when it starts with a prefix, which also closes that gap for `approve_proposal` and `switch_conversation`. On the web each tool refuses and names the button.

- **`decline_request({ version })`** (`declineRequestForTool`, `lib/server/host-review-tools.ts`). `version` is the current proposal's version from `read_request`, or null when the request has none; any other value refuses and names the current one, as `decline <REF-version>` does. It runs `declineCommand` with the revision it read and the retry key `tool:{callId}`, so the requester is told as from the web. A request already declined answers "already declined"; any other closed request refuses.
- **`share_changes({ suggestionId })` and `dismiss_changes({ suggestionId })`** (`resolveChangesForTool`). `read_request` now carries the suggestion's `id`. The id must be the request's pending suggestion; one already shared (`checking` or `shared`) or dismissed answers "already", read from `shared_change_drafts` because the view drops a dismissed suggestion; a closed request refuses. They run `shareChangesCommand` and `dismissChangesCommand`.
- **`confirm_settings({ reviewRef })`** (`confirmSettingsForTool`, `lib/server/setup-channel-tools.ts`). `read_setup_state` now carries `reviewRef`, the settings review's reference (`settingsRef`, moved to `request-ref.ts`). Saved settings that match the review answer "already saved" with the links; another reference refuses and names the current one; missing fields refuse. It reads the live calendars and runs `confirmSettingsCommand` exactly as `confirm <ref>` does, then retires older Telegram Confirm settings buttons. The settings review the service sends for `review` is not in the model's transcript, so the tool description and instructions let Thyme save only after it listed the settings itself in this conversation and the host answered that list; when the host refers to the service's review, Thyme reads setup, lists the settings and asks again.
- **`list_host_requests`** in setup (`listHostRequestsForSetupTool`). It only reads, so it works on the web too. Both tool sets now return each request's `ref`, which `switch_conversation` takes.

The instructions (`agent/instructions/host-imessage.ts`) tell Thyme to read the current state first, act only on a clear decision, and never when the host hesitates, adds a condition, asks a question, asks for a change or could mean something else. The host-review and host-setup fragments keep the web rule and point to it.

### 2. Exact commands stay, unadvertised

`parseCommand` and `executeCommand` are unchanged in what they accept and do. WhatsApp reply buttons and Telegram inline buttons send command IDs, the Telegram menu registers `requests`, `review`, `help` and `stop`, and the receipt router's selection between a sender's conversations is recorded by the replies to `setup` and `request <ref>`. Hosts who learned the commands keep them. Nothing tells a new host about them.

### 3. Replies that ask for words

`lib/server/channel-texts.ts` holds every fixed reply of the linked conversations. Help lists things to say; a summary awaiting approval ends with "To approve, tell me so, such as "book it". To decline, tell me to decline it."; the settings review ends with "If these look right, tell me to save them."; the change listing ends with "Tell me to send them to the requester, or to drop them."; stale and unknown references say "Ask me to show it" or "Ask me which requests you have". Selecting setup or a request answers "We're now talking about …". A unit test checks that no reply in either language asks for a typed command. Unlinking stays a deliberate step: help points to **Unlink** in `/app`, and `stop` still works; a tool cannot confirm an unlink in a conversation it has just ended.

### 4. The conversation's language

`lib/server/channel-language.ts`: `textLanguage` returns `ko` for a text with Hangul, `en` for one with other letters and null otherwise; `hostConversationLanguage` reads the host's latest `conversation_inputs.message` in any of their discussions. Command replies, button replies and host notices use the conversation's language, since a command word or a tap says nothing about it; the too-long and fallback replies use the message's own language, then the conversation's; an unlinked sender's reply and a guest's fixed replies use the message's language, else English. Button titles and prompts follow too, within WhatsApp's 20-character title limit.

### 5. A sender with several conversations

`guestRoute` still returns `ambiguous` when a sender holds several bindings (guest bindings, and possibly the host's own) with no current choice. Before asking, `namedConversation(text, guests, host)` (`lib/server/imessage-receipts.ts`) reads the message. Each role talks about the other ("ask the host", "the requester wants Tuesday"), so a role word in passing names nothing: the host's own account is named only when the sender says they are the host ("호스트인데 나", "저 호스트예요", "I'm the host", "as the host") or answers with a role word alone ("host", "setup", "settings", "호스트", "설정"). A guest request is named by its reference, by a whole word of its host's name (never a substring), by a Korean full name, or by a three-syllable name's given name followed by 님 or 씨 ("은우님"); a guest role word alone ("guest", "게스트", "예약 요청") names the only guest request. Exactly one named conversation is chosen; none or two ask. A message that is an exact command is left to the existing rules.

- **The host's own account.** The receipt continues on the host path. Setup is selected (`selected_request_id` cleared) and one `command` reply with the dedupe key `host-selection:{receipt}` says "Now talking about your own Find Me a Time account as a host.", which records the choice as `setup` does; the message then reaches Thyme in setup.
- **A guest request.** `guestMessage` sends the switch reply (`guest-selection:{receipt}`), as `request <ref>` does, and then forwards the message instead of stopping; for a closed request that can be revised, the message starts the revised request, as an already selected one would.
- **The question.** In the message's language, else the host's conversation's: "Which conversation is this message for?", one line per conversation named by its host and reference, or as the host's own account, and "Tell me which one, for example by the person's name, or say "I'm the host"." The reference lets a sender tell apart two requests with the same host; no command is named.

Rejected: forwarding every ambiguous message to the host's own conversation, which would send a guest's words to the wrong discussion; a model call to classify the message, which would spend a turn before the sender is routed and needs a principal the router does not have.

## Risks / Trade-offs

- **Misread words.** As with D23, a misread decision acts on exactly what the host was shown, once, and nothing undoes a decline. The instructions forbid acting on hedges, conditions and questions; measuring misreads needs the frozen AI evaluation set.
- **Router words.** A message that happens to say "I'm the host" or a host's name about another conversation goes to the conversation it names. This happens only when the sender has several conversations and no current choice, and the reply says where it went.
- **Two languages.** A host writing in a third language gets English fixed replies; Thyme's own replies follow them.
- **Not verified on a device.** The tools and replies are covered by integration tests against the local stack and the Photon and Telegram stand-ins; no real phone ran them (task 4.2).

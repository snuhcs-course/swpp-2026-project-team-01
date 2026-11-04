# Tasks

## 1. Tools

- [x] 1.1 Add `channelOfTurn` and accept Telegram turns in `switch_conversation`.
- [x] 1.2 Add `decline_request`, `share_changes` and `dismiss_changes` to the host-review tools, and the suggestion's id to `read_request`. Verify integration tests for a channel message, a web message, a stale version or suggestion, a closed request and a repeated call.
- [x] 1.3 Add `list_host_requests` and `confirm_settings` to the setup tools, and `reviewRef` to `read_setup_state`. Verify integration tests for a channel message, a web message, a stale review and a repeated call, and the list on the web.
- [x] 1.4 Tell the assistant to act on clear words with these tools and to answer reviews, changes and request lists in words.

## 2. Replies

- [x] 2.1 Move the fixed replies to an English and Korean catalog that names no command, and choose the language per message. Verify a unit test that no reply asks for a typed command.
- [x] 2.2 Route a sender with several conversations by the words of the message, and ask in words otherwise. Verify integration tests for a host who is also a guest (#137), a guest who names a host, and a Korean question.
- [x] 2.3 Update the integration tests that asserted the old command texts.

## 3. Documents

- [x] 3.1 Update the PRD, the host UX documents, the agent configuration and the decision log, and regenerate their `ko/` mirrors.

## 4. Release

- [ ] 4.1 Teammate review.
- [ ] 4.2 With a linked phone, decline, share and confirm settings in Korean and English words, and record the replies.
- [ ] 4.3 After `host-imessage-channel` and `guest-flow-completion` are archived, archive this change so its MODIFIED requirements apply to the archived specs.

# Design

## Context

A KakaoTalk group is a room with several people and the product's account. The Mac relay ([`host-kakaotalk-mac-relay`](../host-kakaotalk-mac-relay/design.md)) reads every room's messages from KakaoTalk for Mac's database with exact room and user IDs. Every eve conversation so far belongs to a host account or to an open request, and every model call is charged to one of them (`lib/server/model-limits.ts`). A group has neither.

## Goals / Non-Goals

**Goals**

- A member who calls the assistant in any group the account is in gets an answer in that group.
- The assistant understands the call from the group's recent messages.
- A group can never reach a host's calendar, requests or settings.
- Spend per group and in total is bounded.

**Non-Goals**

- Scheduling in a group: proposing times, collecting answers, booking. The group-chat scheduling draft owns that (Q2).
- Groups on the Android relay, Telegram or iMessage.
- Answering untitled groups (Q3).

## Decisions

### 1. Which groups and messages

The Mac relay sends a `group_message` event for each text message from another member of a group or open chat:

```json
{ "relay": "mac", "kind": "group_message", "eventId": "<chatId>:log:<logId>", "roomId": "<chatId>", "roomName": "카톡테스트용", "senderUserId": "93652019", "senderName": "Dohyeon Dodo Park", "text": "…", "postedAt": "…" }
```

The account's own messages, non-text messages and messages with a link code are not sent as text; a code still goes as `void_code`. The service stores the event as a receipt with `space_type` `group`, the member's user ID as the sender and the room as the space, so receipts of one group stay in order. The relay's config can turn it off (`"groupMessages": false`).

### 2. A conversation owned by no host

`app.kakaotalk_groups` holds one row per room: the room's keyed hash, the sealed room ID and `left_at`. A group is the principal `{ type: "kakaotalk_group", id }`, with one `discussions` row of audience `group_chat`. Its eve principal ID is `group:<id>`, and the session attributes carry `groupId`. The authorization path accepts a group's bearer for its own discussion while the account is in the group, and for reading afterwards. `withPrincipalAuthority` and the model limits refuse a group the account left.

Every tool and every fragment but `base.md` is gated on a host or requester session, so a group session has no tools. Rejected: running the message in the session of a member who is a linked host. The group would then reach that host's calendar and requests through the tools, and other members' messages would sit in the host's private conversation.

### 3. Context and calls

A message calls the assistant when it names one of `KAKAOTALK_GROUP_NAMES` (default `TimeRabbit` and `타임래빗`, the account's KakaoTalk name in English and Korean), with or without `@` in front. A Latin name counts only as a whole word, so "TimeRabbits" does not call. A Korean name counts when no Hangul syllable comes right before it and nothing or a particle (아, 야, 님, 한테, 에게, …) comes right after it, so "타임래빗아" calls and "새타임래빗" does not. An `@` before another member's name ("@김철수") calls no one. The assistant's other names are left out on purpose: "eve" is the framework the service runs on, not a name members see, and the Korean "타임" is an everyday word ("다음 타임").

A message that does not call is sealed into `app.kakaotalk_group_messages` as one line, `name: text`, and runs no model. A group keeps at most 30 such lines, and an hourly sweep removes every line past 24 hours. A call reads the kept lines, oldest first, and records one input; the same transaction that records the input deletes exactly the lines it read. A call that admission defers, or that fails before its input is recorded, therefore loses no context, and a recorded call never sends the same lines twice:

```text
[KakaoTalk group] 카톡테스트용
Earlier messages:
Kim: 다음 주에 다같이 밥 먹을까?
Lee: 좋아 화요일 어때

Message to you:
Park: 타임래빗, 화요일 저녁 괜찮을까?
```

If the input is too long, the oldest lines are left out, and deleted with the rest. The input is keyed by the receipt, so a retried job records nothing twice; it then records the reply whatever the limits say by then. An untitled group's call is kept as context, because its reply could not be sent (Q3).

### 4. Replies

The reply is a `turn` row with no host, binding or request, for the group's room, waiting on the input as host replies do. Its dedupe key starts with `group-input:`, the one marker the claim, the daily count and the reply's cut use to tell a group's reply from a host's or a guest's. When the turn ends it is frozen with the turn's text, cut at the usual length with no link to `/app`. The claim hands it out in reply mode only to the Mac relay, and only for a room in the claim's new `groupRooms` list: titled groups whose title no other room's name contains. The Mac relay sends it with the same checks as a 1:1 reply (the chat-list check and the landing check). While the phone is the active relay, the row is suppressed as `unsupported`, and a group reply still queued an hour after the call is suppressed as `stale`: a late answer out of context is worse than none.

### 5. Limits and cost

- At most `KAKAOTALK_GROUP_DAILY_REPLIES` (30) calls in one group and `KAKAOTALK_GROUPS_DAILY_REPLIES` (300) across groups are answered in 24 hours, counted from the group reply rows under one lock, so parallel receipts of different groups never pass the total together. A call past either limit is kept as context.
- Inputs pass the conversation admission windows under a new `group` scope (20 a minute, 100 an hour per group), and the service windows.
- Model calls are charged to the group's principal under the groups' own allowances: $3 per group and $20 for all groups together per 24-hour window, inside the service window. They do not draw on the anonymous pool, so groups cannot use up what unconfirmed guests depend on.

### 6. A failed session

A group has no recovery page. When its latest session has failed, the next call starts the next generation and its unfinished inputs go on there in order, so one failure never silences the group.

### 7. Retention

The hourly sweep (`app.sweep_kakaotalk_group_messages`) removes context lines past 24 hours, and deletes a group's whole conversation (its inputs, which hold the calls and the context sent with them, its sessions and recorded events) 30 days after the group's last call, through `app.delete_discussion_records`. Receipts follow the 30-day rule of the KakaoTalk records. A group's row holds only the room's hash and sealed ID.

### 8. Instructions

`agent/instructions/group-chat.ts` applies to `group_chat` sessions only. It says the assistant is in a group, reads the input's format, answers the calling message in its language in a few plain sentences, has no tools, never claims to have checked a calendar or booked anything, and points people to findmeatime.com or a 1:1 chat with the account to set up a meeting.

## Risks / Trade-offs

- **Privacy.** Every member's text in every group with the account reaches the service; calls with up to 30 earlier lines reach the model. Members never agreed to Find Me a Time's terms. Mitigation: uncalled messages are kept for 24 hours at most, sealed, and a group's conversation is deleted 30 days after its last call (design 7); the privacy policy says so (Q1).
- **Abuse.** Anyone can add the account to a group and call it. The per-group and total reply limits and the groups' own model allowances bound the cost.
- **Prompt injection.** Members can write instructions to the model. The group session has no tools, so the most it can do is write text into that group.
- **Wrong group.** As for 1:1 chats, a reply goes only to a room the name rule picks, and the landing check reports any other room as `wrong_room`.

## Open Questions

- Q1 to Q3 in the [proposal](proposal.md#unresolved-decisions-for-the-team).
- Should `stop` or leaving the group (feed messages) mark the group left automatically? Today only `markGroupLeft` does, which nothing calls yet.

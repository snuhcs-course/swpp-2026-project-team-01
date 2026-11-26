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

A message calls the assistant when it starts with `@`, or contains one of the names in `KAKAOTALK_GROUP_NAMES` (default `TimeRabbit`, `타임래빗`, `eve`, `이브`). A Latin name counts only as a whole word, so "every" and "seven" do not call. A Korean name counts anywhere, because particles attach to it ("이브야").

A message that does not call is sealed into `app.kakaotalk_group_messages` as one line, `name: text`, and runs no model. A group keeps at most 30 such lines, none older than 24 hours. A call takes the kept lines, oldest first, and deletes them, then records one input:

```text
[KakaoTalk group] 카톡테스트용
Earlier messages:
Kim: 다음 주에 다같이 밥 먹을까?
Lee: 좋아 화요일 어때

Message to you:
Park: 이브, 화요일 저녁 괜찮을까?
```

If the input is too long, the oldest lines go first. The input is keyed by the receipt, so a retried job records nothing twice and sends no context twice.

### 4. Replies

The reply is a `turn` row with no host, binding or request, for the group's room, waiting on the input as host replies do. When the turn ends it is frozen with the turn's text, cut at the usual length with no link to `/app`. The claim hands it out in reply mode only to the Mac relay, and only for a room in the claim's new `groupRooms` list: titled groups whose title no other room's name contains. The Mac relay sends it with the same checks as a 1:1 reply (the chat-list check and the landing check). While the phone is the active relay, the row is suppressed as `unsupported`.

### 5. Limits and cost

- At most `KAKAOTALK_GROUP_DAILY_REPLIES` (30) calls in one group and `KAKAOTALK_GROUPS_DAILY_REPLIES` (300) across groups are answered in 24 hours, counted from the group reply rows. A call past either limit is kept as context.
- Inputs pass the conversation admission windows under a new `group` scope (20 a minute, 100 an hour per group), and the service windows.
- Model calls are charged to the group's principal as anonymous work, so the anonymous per-principal and total caps apply.

### 6. Instructions

`agent/instructions/group-chat.ts` applies to `group_chat` sessions only. It says the assistant is in a group, reads the input's format, answers the calling message in its language in a few plain sentences, has no tools, never claims to have checked a calendar or booked anything, and points people to findmeatime.com or a 1:1 chat with the account to set up a meeting.

## Risks / Trade-offs

- **Privacy.** Every member's text in every group with the account reaches the service; calls with up to 30 earlier lines reach the model. Members never agreed to Find Me a Time's terms. Mitigation: context is kept for 24 hours at most, sealed, and receipts follow the 30-day retention; the privacy policy says so (Q1).
- **Abuse.** Anyone can add the account to a group and call it. The per-group, total and anonymous model caps bound the cost.
- **Prompt injection.** Members can write instructions to the model. The group session has no tools, so the most it can do is write text into that group.
- **Wrong group.** As for 1:1 chats, a reply goes only to a room the name rule picks, and the landing check reports any other room as `wrong_room`.

## Open Questions

- Q1 to Q3 in the [proposal](proposal.md#unresolved-decisions-for-the-team).
- Should `stop` or leaving the group (feed messages) mark the group left automatically? Today only `markGroupLeft` does, which nothing calls yet.

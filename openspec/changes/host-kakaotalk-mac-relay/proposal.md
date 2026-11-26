# Proposal

Tracking issue: [#494](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/494). This change builds on [`host-kakaotalk-channel`](../host-kakaotalk-channel/proposal.md) (pull request #501), which is not yet on `main`, and lands in the same pull request.

## Why

`host-kakaotalk-channel` relays KakaoTalk through an Android phone. The phone sees only notifications: it cannot write first in private, it has no Kakao user IDs, and it cannot see who is in a group. Its proposal rejected a Mac relay because `kakaocli` hung and `openkakao-cli` timed out on 2026-11-26.

Later on 2026-11-26, the same day, KakaoTalk for Mac worked on a Mac mini signed in to the product's sub-account (user ID 448221044), the same account as the relay phone:

- `kakaocli` 0.6.0 read the encrypted database once its key was derived from the hardware UUID and the user ID. The user ID was recovered from the preferences plist, because `status` cannot detect it.
- A send through `kakaocli` reached the 1:1 chat with the user's main account in 3 seconds and appeared in the database. It needed a one-line patch, because KakaoTalk now labels chat-list names `_NS:40`, not `_NS:18`.
- The database gives what notifications do not: every room's exact `chatId`, its type, each message's `authorId`, and the members of a group (`NTChatRoom.displayMemberIds`, `activeMembersCount`).
- The 1:1 room ID that the relay phone reported in its tests, `486083133936417`, is the `chatId` of the same chat in the Mac database. A binding made through either relay therefore works on the other.

The group-chat scheduling draft (branch `docs/group-chat-scheduling`) needs exactly these facts: member IDs, group events and a way to leave a room for `/kickout`. This change gives it that transport and does not implement scheduling.

## What Changes

- **Mac relay.** A daemon, `apps/kakaotalk-mac-relay/`, runs on the Mac mini as a LaunchAgent in the logged-in GUI session. It reads new messages from the KakaoTalk database, posts them to the existing webhook, claims outbox messages and sends them through `kakaocli`, and leaves group rooms through accessibility. A small Swift helper holds the Accessibility grant and starts the daemon.
- **Same routes, same signing.** The Mac relay uses PR #501's four routes and the HMAC scheme unchanged. The protocol gains optional fields: a `relay` field on every body, log-based event IDs, the sender's user ID, membership events and a `leave` claim mode.
- **One active relay.** `KAKAOTALK_ACTIVE_RELAY` (`mac` or `android`) picks the relay. The service refuses the other one's events, claims and heartbeats, so the two never act on the same account at once. The Android relay stays as a standby.
- **Wrong-room safety.** `kakaocli` opens a chat by matching a name in the chat list. Private content goes only to a room whose name matches no other room, checked in the database and in the chat list just before sending. After every send the daemon checks in the database that the message landed in the expected room. A mismatch is reported `uncertain` and raises an alert.
- **No first 1:1 message.** The Mac relay sends into a 1:1 room only after the other person has written in it.
- **Leaving a room.** A new outbox kind, `leave_room`, which only the Mac relay can carry. The group change will create these rows for `/kickout`.
- **Documents.** PR #501's design, proposal and the decision log stop calling the Mac relay rejected.

## Decisions

Proposed on 2026-11-26 by the session that wrote this change. None has had a teammate review yet.

| # | Decision | Choice |
|---|---|---|
| D1 | Main relay ([design 1](design.md#1-relays-and-the-active-one)) | KakaoTalk for Mac on a Mac mini, driven by `kakaocli`. The Android phone becomes a standby. Rejected: running both at once, which would forward every message twice and send from two places |
| D2 | One active relay ([design 1](design.md#1-relays-and-the-active-one)) | `KAKAOTALK_ACTIVE_RELAY` on the service, default `android` so PR #501 keeps working. Every Mac body says `"relay": "mac"`, covered by the signature. A body without it is the Android relay. Rejected: automatic failover by heartbeat, because a phone left running would take over silently |
| D3 | Room identity ([design 2](design.md#2-room-identity)) | The `chatId` from the database is the room ID. It equals the phone's room ID, so bindings carry over. The sender's user ID is sent but not stored in this change |
| D4 | Reading ([design 3](design.md#3-reading-the-database)) | `kakaocli query` with the derived key, every 2 seconds, IDs cast to text. A saved log ID mark per room gives at-least-once delivery. Rejected: `kakaocli sync`, whose JSON numbers lose the 19-digit log IDs in JavaScript, and its resume point is one of those IDs |
| D5 | Wrong-room safety ([design 5](design.md#5-sending-and-wrong-room-safety)) | A name rule in the database, a chat-list check before sending, and a database check after. A message found in another room is `uncertain` with reason `wrong_room`, which raises an alert |
| D6 | No first 1:1 message ([design 6](design.md#6-no-first-11-message)) | The relay lists a 1:1 room as sendable only when the other person has a message in it |
| D7 | Leaving ([design 7](design.md#7-leaving-a-room)) | Outbox kind `leave_room`, claim mode `leave`, done through the chat window's menu and checked in the database. Suppressed while the Android relay is active |
| D8 | Process and grants ([design 9](design.md#9-process-and-grants)) | A LaunchAgent starts the Swift helper `kakao-ax`, which holds Accessibility and starts the Node daemon as its child. The grant belongs to the helper, not to `node` |

## Unresolved decisions for the team

| # | Question | Why it blocks |
|---|---|---|
| Q1 | PR #501's Q1 (Kakao's terms) applies unchanged. Driving KakaoTalk for Mac is the same kind of automation as driving the phone | The channel ships only if the team accepts that risk |
| Q2 | Who owns the Mac mini and keeps it signed in, awake and unlocked? | The Mac relay sends nothing while the screen is locked (design 8) |
| Q3 | Should `kakaocli`'s fixes go upstream: the `_NS:40` label, the chats tab as a button, and an exact-match option? | Until then the daemon needs a patched `kakaocli` build, recorded in the README |

## Capabilities

### New Capabilities

- `host-kakaotalk-mac-relay`: the active relay, the Mac relay's events from the database, its claims and sends with the wrong-room checks, the rule against first 1:1 messages, leaving a room, its health, and its process.

### Modified Capabilities

`host-kakaotalk-channel` is still a pending change, so its requirements are not in the main specs. This change widens three of them. The deltas are written when both changes are synced at archive time.

| Requirement in `host-kakaotalk-channel` | Change |
|---|---|
| Private content only to the verified chat | While the Mac relay is active, private content may also go to a room that "Mac relay sends only to an exactly matched room" allows. The Mac relay never sends the nudge |
| KakaoTalk sender identity | The Mac relay also sends the sender's Kakao user ID. The service validates it and stores nothing new |
| Group and open chats | The Mac relay may also send membership events with room and user IDs and no text, when enabled |

## Impact

- **New code:** `apps/kakaotalk-mac-relay/` (TypeScript daemon, Swift helper, LaunchAgent template, tests and fixtures).
- **Changed code:** `lib/server/kakaotalk.ts`, `lib/server/kakaotalk-receiver.ts` and `lib/server/kakaotalk-outbox.ts`, and the relay stand-in.
- **Schema:** `leave_room` in the outbox kind check, and `relay_kind` on the heartbeat row, through pg-delta.
- **Dependencies:** none new in the web app or agent. The Mac needs `kakaocli` (patched), Node 24 or later, and Xcode's command-line tools to build the helper.
- **Systems:** `KAKAOTALK_ACTIVE_RELAY` on Vercel Production when the Mac relay goes live; the Mac mini's settings (no screen lock, the helper's Accessibility grant). Both are left to the team (Q2).
- **Documents:** `host-kakaotalk-channel`'s design and proposal, the [decision log](../../../documentations/technical_specification/08_decision_log.md), the [provider setup](../../../documentations/technical_specification/03_provider_setup.md) and `apps/kakaotalk-relay/PROTOCOL.md`, with Korean mirrors where they exist.

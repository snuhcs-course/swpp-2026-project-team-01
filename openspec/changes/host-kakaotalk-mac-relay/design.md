# Design

## Context

[`host-kakaotalk-channel`](../host-kakaotalk-channel/design.md) puts an Android phone between KakaoTalk and the service. The phone reads notifications, answers through their reply action and pulls its work from four signed routes ([`PROTOCOL.md`](../../../apps/kakaotalk-relay/PROTOCOL.md)). This change adds a second relay behind the same routes: KakaoTalk for Mac on a Mac mini, which reads the app's own database instead of notifications.

The facts below were checked on the Mac mini on 2026-11-26: macOS 27.2.1, KakaoTalk for Mac signed in to the product's sub-account (user ID 448221044), and `kakaocli` 0.6.0 with a one-line patch.

## Goals / Non-Goals

**Goals**

- The Mac relay does everything the phone relay does for hosts, without the nudge: it receives 1:1 messages and sends replies and notices the service starts.
- Private content reaches only the room that was bound, and a send that lands anywhere else is caught at once.
- The group-chat scheduling change gets member IDs, group events and a way to leave a room.
- Only one relay acts on the account at a time.

**Non-Goals**

- Group scheduling itself: group messages, `/kickout`, member identity. The group change owns them. Group conversations, where every member's text reaches the service and the assistant answers when called, are [`kakaotalk-group-conversations`](../kakaotalk-group-conversations/design.md).
- Starting a 1:1 chat with someone who has never written.
- Running the phone and the Mac relay at the same time.
- Sending images or files.

## Decisions

### 1. Relays and the active one

Both relays sign with the same two secrets and call the same four routes. Each Mac relay body carries `"relay": "mac"`, inside the signed body. A body without `relay` comes from the Android relay, so the phone app needs no release.

The service reads `KAKAOTALK_ACTIVE_RELAY`, which is `mac` or `android`, with `android` as the default. A webhook event, claim or heartbeat from the other relay is answered `409` with `{ "status": "standby" }`. It changes no delivery state; only its nonce is recorded, as for every signed request. The Android relay treats `409` from the webhook as a final refusal and drops the event, and backs off on a claim error. A result report is accepted from either relay, because only the lease token decides it, so a lease that was open when the active relay changed can still be reported.

The heartbeat row records which relay sent it (`relay_kind`). A claim hands out nothing unless the last heartbeat came from the active relay. After a switch, claims therefore wait until the new relay's first heartbeat.

Rejected: picking the relay automatically, so that the phone takes over when the Mac is silent. A phone left running would start answering from another device without anyone deciding it. Rejected: separate secrets per relay. The `relay` field is already signed, and a holder of either secret can already act as a relay.

### 2. Room identity

`NTChatRoom.chatId` is the room ID. The phone's tests used room `486083133936417` from the notification tag; the Mac database has the same chat under the same `chatId`. Bindings, hashes (`kakaotalk:<room ID>`) and sealed reply targets therefore stay as they are.

The room types seen in the database on 2026-11-26:

| `type` | `linkId` | Room | Relay treats it as |
|---|---|---|---|
| 0 | 0 | 1:1 chat with a friend (`directChatMemberUserId` set) | 1:1 |
| 1 | 0 | Group chat (`activeMembersCount` 5) | Group |
| 2 | 0 | 카카오계정 notices | Ignored |
| any | not 0 | Open chat (`linkId` is `NTOpenLink.linkId`) | Group |

Any other combination is ignored. A 1:1 message event carries the author's user ID (`NTChatMessage.authorId`) as `senderUserId`. The service checks that it is a decimal ID and stores nothing new in this change; the group change decides whether a hash of it becomes an identity.

### 3. Reading the database

The daemon reads the database with `kakaocli query --key <derived key> <SQL>`. The key is PBKDF2-SHA256 of the hardware UUID and user ID (`KeyDerivation.swift`), saved once in a file only the relay's user can read, and passed only as an argument to `kakaocli`. Every ID is selected as `CAST(... AS TEXT)`, because log IDs have 19 digits and JavaScript numbers hold 15 or 16.

The daemon keeps a mark per room: the last log ID it handled there. Every 2 seconds it reads the rooms, and for each room whose `lastLogId` moved past its mark it reads the newer messages in `logId` order, 100 at a time. One global mark would not do: log IDs grow with time across rooms, and a room that syncs late could bring messages older than another room's newest. The daemon moves a room's mark past a message only after the service answered its events with `2xx` or refused them for good (`400`, `409`, `413`, `422`), and saves the marks after each move, so a crash or restart re-sends at most the unanswered tail, which the webhook's deduplication absorbs. On its first start it marks every room at its `lastLogId`, so no history is replayed. A room it first sees later, such as the 1:1 chat a host opens to send the link code, is read from the first start time. A `409` standby answer counts as final, so a standby relay does not build up a backlog to replay after a switch.

The event ID is `<chatId>:log:<logId>`. `logId` is unique per message in a room, so the receipt ID `kakaotalk:<chatId>:log:<logId>` never collides with a phone event ID (`<room>:<ms>:<index>`). The two relays never run together, so the same message is not expected to arrive under both forms.

`NTChatRoom.displayMemberIds` is a binary property list holding an array of user IDs. The relay decodes it with a small reader for that one shape. The account's own user ID is `NTChatContext.userId`, and messages it authored are never forwarded.

Rejected: `kakaocli sync`. Its NDJSON writes log IDs as JSON numbers, which lose precision in Node, and its resume point is one of those IDs. Rejected: linking SQLCipher into Node, which needs a native module the repository does not otherwise build.

### 4. Events

For each new message the daemon sends one of these:

- **1:1 message** from the other person: `{ relay, eventId, roomId, isGroup: false, senderName, senderUserId, logId, text, postedAt }`, with `nonText: true` for anything but plain text (`type` other than 1). `senderName` is the friend's name from `NTUser`, never from the text.
- **Group or open-chat message**: no text. A link code in it becomes `void_code`, exactly as on the phone (HMAC of the upper-cased code under the inbound secret).
- **Membership** (off unless `FMAT_RELAY_GROUP_EVENTS=1`): `{ relay, kind: "room_members", eventId: "<chatId>:members:<logId>", roomId, memberUserIds, activeMembersCount }` when a group's member list changes, read from `displayMemberIds`, with no text and no names. The service answers `200` and stores nothing until the group change consumes it.

The service accepts the log-form event ID only together with `relay: "mac"`.

### 5. Sending and wrong-room safety

`kakaocli send <name> <text>` activates KakaoTalk, closes other chat windows, finds a chat-list row whose name label contains `<name>` case-insensitively, opens it with Enter and types the text. It never sees a room ID. Three checks keep private content in the right room.

1. **Name rule, in the database.** The daemon computes the name the chat list shows for each room: a group's title (`NTChatMeta` type 3), else the friend's `displayName`, `friendNickName` or `nickName`. An untitled group has no name of its own, because its label lists its members, so the daemon counts its members' names (from `displayMemberIds` and `NTUser`) among the names other rooms may contain, and never addresses the group itself. A room is sendable only when its name is not empty and no other room's name contains it case-insensitively. Room A named "Kim" is not sendable while room B is named "Kim Jisoo". A sendable 1:1 room also has to pass design 6.
2. **Chat-list check, just before sending.** The helper reads the chat list's name labels (`AXTable > AXRow > AXCell > AXStaticText`, id `_NS:18` or `_NS:40`). Exactly one label must contain the name, and that label must equal it. Otherwise nothing is sent and the outcome is `failed`.
3. **Landing check, after sending.** The daemon notes the highest `logId` before the send. For 10 seconds after `kakaocli` returns, it looks for a message above that mark, authored by the account, with exactly the sent text. Found in the expected room: `accepted`. Found in another room: `uncertain` with reason `wrong_room`, an error log line and an operational alert on the service. Not found: `uncertain`.

`kakaocli`'s exit maps as follows. "Chat not found in the chat list" is `failed`, because nothing was typed. "No windows", "input field not found" and its start-up errors (the login screen, a required update, a 2FA prompt) are `not_started`, because all fail before typing. Any other failure, a crash or a 30-second timeout runs the landing check and is `accepted` only when the message is in the right room, and `uncertain` otherwise. Once `kakaocli send` has run, any error of the daemon's own, such as a failed database read during the landing check, is `uncertain`, so a message that may have gone out is never requeued.

**Checks before typing, investigated.** Two signals could confirm the opened window before any text is typed:

- The chat window's title equals the room name. This needs to run between opening the chat and typing. `kakaocli send` does both in one call, so it would need an upstream option (`--expect-title`), or the helper would have to open and type itself.
- `NTChatRoom.lastSeenLogId` of the expected room moves up to `lastLogId` when its window opens. This works only when the room has unread messages. A reply usually follows the host's unread message, so it often does, but a second reply in a row would not.

Neither is in this change. Check 2 runs seconds before `kakaocli` searches the same list with the same rule, so a wrong match needs a new room with a matching name to appear in those seconds, and check 3 catches it. Upstream `--exact` and `--expect-title` options in `kakaocli` are Q3.

The name rule also covers renames. If a host renames their profile to a name that another room contains, their room stops being sendable and its messages wait in the queue. They do not go to the other room.

### 6. No first 1:1 message

The daemon lists a 1:1 room as sendable only when it holds at least one message whose `authorId` is the room's `directChatMemberUserId`. A bound host always qualifies, because binding needs their code message. The rule stops the relay from writing first to a friend who added the account and never wrote, whatever the service queues. The Mac relay never sends the nudge, which exists only because the phone cannot write without a notification.

### 7. Leaving a room

A `leave_room` outbox row names a group room by its sealed room ID and carries no text. It is KakaoTalk only. A claim hands it out as `{ id, leaseToken, mode: "leave", roomId, text: "" }` when the room is in the claim's `memberRooms` list. When the Mac relay's claim omits the room, the row is suppressed (`not_member`), because the account has already left. While the Android relay is active, the row is suppressed as `unsupported`.

The helper leaves through the chat window: it opens the room by the same name rule and chat-list check as a send, after closing every other window and reading the row selection back, and goes on only when exactly one chat window opened and its title is the room's name. It then opens the window's menu, presses **나가기** (or **Leave**) and confirms it in the alert. The daemon then checks that the room's row is gone from `NTChatRoom`. Gone within 10 seconds: `accepted`, and a room already gone is `accepted` too. No single chat-list row: `failed`. If any other room disappeared from the database instead, the helper left the wrong room: `failed`, never retried. Anything else (no menu, no item, no alert, or the room still there): `not_started`, which the service retries up to three times. Leaving a room the account already left does no harm, so nothing here is `uncertain`. A group with no title cannot be left this way, because its chat-list label is a list of member names.

`queueKakaoTalkLeave` in `lib/server/kakaotalk-outbox.ts` creates the row. Nothing calls it in this change; the group change will, for `/kickout`. The chat window's menu could not be read on 2026-11-26 because the screen was locked, so the helper looks it up by title and fails closed. Reading the menu and one real leave on a test group are device tasks (task 5.3).

### 8. Health

The Mac relay sends the same heartbeat every minute with these meanings:

- `listenerEnabled`: the last database read succeeded within two minutes.
- `accessibilityEnabled`: the helper is trusted for accessibility (`AXIsProcessTrusted`).
- `locked`: the console session's screen is locked (`CGSessionCopyCurrentDictionary`, `CGSSessionScreenIsLocked`).
- `kakaoVersion`: `CFBundleShortVersionString` of `/Applications/KakaoTalk.app`.
- `replyableRooms`: the sendable 1:1 rooms (designs 5 and 6). `postedRooms` is always empty.

Claims and heartbeats list at most 1,500 room IDs each, and the service takes up to 3,000 per list, so a claim stays under the 64 KB body limit. Past 1,500 hosts the list needs to name only rooms with queued work.

On 2026-11-26 the mini's screen was locked, and KakaoTalk then exposed no windows to accessibility. A locked Mac cannot send, so the service hands the Mac relay no claim while its last heartbeat or claim reports `locked`, and the daemon does not claim while locked. Messages stay queued. The phone's rule (replies through kept actions while locked) does not apply to the Mac.

### 9. Process and grants

A LaunchAgent (`~/Library/LaunchAgents/com.findmeatime.kakaotalk-mac-relay.plist`) runs in the logged-in user's GUI session, never over SSH. It starts `kakao-ax supervise`, the Swift helper, which starts the Node daemon as its child and restarts it after a crash. macOS attributes the child processes (`node`, `kakaocli`) to the helper, so the Accessibility grant, and any prompt to read another app's data, belong to the helper's binary and not to `node` in general. A rebuilt helper has a new code hash and needs the grant again.

The daemon reads its settings from `~/Library/Application Support/FindMeATime/kakaotalk-mac-relay/config.json` (mode 600): the service origin, the two secrets, the key file path and the `kakaocli` path. The state file there holds only each room's mark and the first start time. No message text is written to disk by the daemon; KakaoTalk's own database keeps the chat history, as the phone's app does.

Over SSH on 2026-11-26, sending needed Accessibility for `/usr/libexec/sshd-keygen-wrapper`. Once the helper holds its own grant, that grant should be turned off.

## Risks / Trade-offs

- **Name-based sending.** `kakaocli` cannot open a chat by ID. The three checks in design 5 make a wrong send unlikely and visible, not impossible, until upstream options exist (Q3).
- **Arguments are visible.** `kakaocli` takes the database key and the message text as command-line arguments, which any user of the Mac can read with `ps` while the command runs. The Mac mini therefore has one user account, the relay's. Passing them through standard input needs an upstream change (Q3).
- **Rows that wait on the Mac.** A message for a room the Mac relay does not list (a name collision, a renamed host) waits with no nudge and no expiry. The claim reads the oldest 200 chats' heads, so 200 such chats would hide newer ones. The operator snapshot's queue counts show it; listing only serviceable heads is a follow-up.
- **Patched `kakaocli`.** KakaoTalk updates can move the chat-list labels again, as `_NS:18` moved to `_NS:40`. Check 2 then fails closed: nothing is sent, and the outcome is `failed`.
- **Screen must stay unlocked.** An unlocked Mac mini is a physical security exposure. Mitigation: the mini stays in a locked room, KakaoTalk's own lock mode stays off only on this machine, and FileVault stays on.
- **Database format.** The SQL depends on KakaoTalk's private schema. The heartbeat reports the KakaoTalk version, and a failing read turns `listenerEnabled` false, which marks the relay down within five minutes.
- **Terms of service.** As PR #501's Q1.

## Open Questions

- Q1 to Q3 in the [proposal](proposal.md#unresolved-decisions-for-the-team).
- Which `NTChatMessage.status` values mean sent? The 2026-11-26 send showed `1` right after sending and earlier own messages `4`. The landing check therefore does not read `status`.
- Can KakaoTalk for Mac store a room's newest message before older ones it backfills after sleep? The per-room mark would then skip the gap. If a device check shows it, the watcher should re-read a short window below each mark; the webhook's deduplication makes that safe.
- Which feed types (`type` 0, `feedType` in the JSON) mark a member leaving, being removed and the account itself leaving? Only `feedType` 1 (invitation) was seen.

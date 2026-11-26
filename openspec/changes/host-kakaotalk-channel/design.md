# Design

## Context

The host channels so far, [iMessage](../../specs/host-imessage-channel/spec.md), [WhatsApp](../../specs/host-whatsapp-channel/spec.md) and [Telegram](../../specs/host-telegram-channel/spec.md), each run through a provider API that the product is allowed to automate. They share the `imessage_*` tables, the receipt-before-acknowledgment rule, the outbox with uncertain sends, and one active binding per host. The Telegram receiver in `agent/channels/telegram.ts` is the closest model: one authenticated route stores a deduplicated receipt and its job, and never starts a session itself.

KakaoTalk offers no such API for a personal account. This design puts an Android phone between KakaoTalk and the service. It relies on what Android shows any notification listener, which the device check on 2026-11-26 confirmed (see the proposal's Why). The relay pulls its work from the service, because a phone cannot receive inbound HTTPS.

## Goals / Non-Goals

**Goals**

- A host can link KakaoTalk and do on it what they can do on Telegram, apart from buttons and images.
- The service can start a conversation: summaries, confirmations and reminders reach the host.
- Private content reaches only the chat whose room ID was bound.
- A message that may have gone out is never sent twice.

**Non-Goals**

- Group chats, open chats (오픈채팅) and KakaoTalk Channels (Q3).
- Requester messaging over KakaoTalk.
- Sending photos or files. Incoming ones get a text reply saying only text is read.
- Running the relay on more than one phone at once.

## Decisions

### 1. Transport

The relay app (`apps/kakaotalk-relay/`, Kotlin) has three parts.

- **Notification listener.** A `NotificationListenerService` reads `com.kakao.talk` notifications in the `MessagingStyle` template. It reads the tag (`<account>_<room ID>`), `isGroupConversation`, and each message's sender `Person`, text and timestamp.
- **Reply path.** It fills the **답장** action's `RemoteInput` and fires its `PendingIntent`. The notification belongs to one room, so the room ID is known before anything is sent. This works only while that notification is posted.
- **Accessibility path.** It opens KakaoTalk, finds the chat in the chat list by the name sealed at linking, types the fixed nudge and taps send. It runs only when the screen is on and the phone is unlocked. A name can point at the wrong chat when the host has renamed their profile, so this path never carries private content.

The fixed nudge reads: "Find Me a Time에 새 소식이 있어요. 아무 말이나 답장해 주시면 바로 보내드릴게요." The host's answer raises a notification for the bound room, and the queued content follows through its reply action.

Rejected:

- **KakaoTalk Channel chatbot (Kakao i Open Builder).** It is the official route, but a skill can only answer the message the user just sent. Every notice the service starts would be lost.
- **알림톡 and 친구톡.** They can write first, but they need a business registration, a reseller contract, a fee per message and a review of every template. Phase 9 showed how a provider review can disable a channel before its first message.
- **`openkakao-cli` on a Mac.** Tried on 2026-11-26. Version 1.19.4 could not read or send: on an account with many chats its accessibility snapshot exceeds a fixed 30-second budget (about 7,900 nodes).

KakaoTalk for Mac with `kakaocli` was first rejected here too, because `status` and `send` hung on 2026-11-26. Later that day both worked on a Mac mini signed in to the product's sub-account: the user ID was recovered from the preferences hash, and `send` needed a one-line patch for KakaoTalk's new chat-list labels. The Mac also gives exact room and member IDs. The [`host-kakaotalk-mac-relay`](../host-kakaotalk-mac-relay/design.md) change therefore makes it the main relay behind these routes, and this phone relay becomes its standby. The two never run at the same time.
- **adb from a server.** It needs a computer tethered to the phone, and `input text` cannot type Korean without an extra keyboard app.
- **Private content through the accessibility path, checked by name.** A renamed host or a friend with the host's old name would receive another person's summary (reviewer finding, 2026-11-26).

### 2. Relay authentication

Every relay request carries these headers:

- `X-FMAT-Relay-Timestamp`: Unix seconds.
- `X-FMAT-Relay-Nonce`: 16 random bytes in hex.
- `X-FMAT-Relay-Signature`: hex HMAC-SHA256 over `METHOD\npath\ntimestamp\nnonce\nbody`.

There are two route classes. Inbound events use `KAKAOTALK_RELAY_INBOUND_SECRET`. Claims, results and heartbeats use `KAKAOTALK_RELAY_OUTBOX_SECRET`. A stolen inbound secret can therefore inject messages but not read anyone's queue. Each secret also accepts a `_PREVIOUS` value, so a secret can be rotated in two deploys. Nonces are stored for ten minutes in `app.kakaotalk_relay_nonces`, and a repeated one is refused.

For a lost phone: remove both secrets (every route then refuses), sign the account out from another device, and set new secrets on the replacement phone.

### 3. Sender identity

KakaoTalk notifications carry no user ID. The room ID of a 1:1 chat is stable for that pair of accounts, so it stands in for the sender. It is hashed as `kakaotalk:<room ID>` under the existing key, in its own namespace.

The `Person` name is the host's KakaoTalk profile name, which the host can change. It is sealed at linking for display and for the nudge, and updated when a later notification shows a new name.

The relay forwards no message posted before it was first configured, so the notifications already on the phone when it starts are not replayed. Each message has its own event ID: `<room ID>:<message timestamp>:<index>`, where the index counts the messages that share that timestamp. A notification that is updated with more messages yields only the new IDs. The relay keeps a ring of the last 500 acknowledged IDs, so a re-posted notification is not forwarded twice.

Group and open-chat text never leaves the phone. Open chats are told apart by the chat type the KakaoTalk notification reports (a device check during implementation confirms which field). When such a message contains `FMAT-` followed by the code pattern, the relay sends `{ kind: "void_code", codeHash }`, keyed under the inbound secret. The service then voids a pending attempt whose code hashes the same.

### 4. Records

`kakaotalk` is added to the `channel` checks of the four `imessage_*` tables, as Phase 9 D4 decided for WhatsApp. It is also added to the channel list in `channel_usage_days` and `record_channel_usage_day`.

The outbox gains three columns: `lease_token_hash`, `lease_expires_at` and `claim_attempts`. The sealed reply target holds the room ID and the name. `app.kakaotalk_relay_nonces` and `app.kakaotalk_relay_heartbeats` are new tables. Their RLS denies all client roles, as for the other `imessage_*` tables.

### 5. Outbox and delivery

The relay calls `POST /kakaotalk/outbox/claim`, a long poll of up to 25 seconds. Its body lists the rooms with a posted notification. The service returns at most one message, for a chat with nothing already leased.

At claim time the service runs these checks first:

- Suppress the message if its binding is no longer active.
- Suppress a summary whose proposal version is no longer the latest.
- Hand out private content only for a room in `postedRooms` or `replyableRooms`. Otherwise hand out a nudge, at most one per chat per hour, and keep the content queued.

The claim returns `{ id, leaseToken, mode: "reply" | "nudge", roomId?, displayName?, text }`.

Firing a notification's **답장** action makes KakaoTalk remove that room's notification, but the action's `PendingIntent` stays valid. The relay keeps the newest reply action per room in memory and reuses it after the notification is gone. The device test on 2026-11-26 sent three separate replies to one room from one incoming message, with the phone locked, and all three arrived. The claim body therefore lists `replyableRooms` (rooms with a posted or kept action) beside `postedRooms`, and private content may go to either. A restart of the relay empties the kept actions; a room then gets the nudge until the host writes again.

The relay reports through `POST /kakaotalk/outbox/<id>/result` with `{ leaseToken, outcome }`. The outcomes map to the existing outbox states:

| Outcome | State | Meaning |
|---|---|---|
| `accepted` | `accepted` | The reply action fired, or the nudge appeared in the chat |
| `failed` | `failed` | Nothing was sent, and the cause is final: no chat matched, or several did |
| `uncertain` | `uncertain` | Sending started and its result was not seen |
| `not_started` | `queued` | Nothing was sent, and the cause can pass: the notification was dismissed, or the phone locked. Requeued up to three times, then `failed` |

When a lease ends with no report, the message becomes `uncertain`. A later report changes nothing. Uncertain messages are never resent, as iMessage D9 decided.

### 6. Linking

The card keeps the device's default channel and adds **Use KakaoTalk instead**. The KakaoTalk card shows these, after the privacy sentence:

- The account's KakaoTalk ID (`KAKAOTALK_ACCOUNT_ID`) with **Copy ID**. KakaoTalk has no public link that adds a personal account as a friend, so the host searches the ID in KakaoTalk.
- The `FMAT-` code with **Copy code**.
- When the host has another binding, the sentence that linking KakaoTalk ends it.

The code binds on arrival (`link-on-code` D1). The binding transaction ends any other binding and suppresses its undispatched messages. The welcome message is sent through the reply path, because the host's code message has just raised a notification.

### 7. Relay health

The relay app posts `POST /kakaotalk/heartbeat` every minute. The heartbeat reports these:

- Whether the notification listener and the accessibility service are enabled.
- Whether the phone is locked.
- The KakaoTalk version.
- The rooms with a posted notification.

The service treats the relay as down after five minutes with no heartbeat, or after a heartbeat that reports a disabled listener. While the relay is down, claims stop and messages stay queued. While the phone is locked, only reply-mode claims are handed out, for rooms with a posted notification or a kept reply action. An operational alert is written when the relay goes down and again if it is still down an hour later.

### 8. Privacy

The relay phone sees every notification for the account, including chats that never link. The relay app forwards only 1:1 events and keeps no text after the webhook acknowledges it. The phone's own KakaoTalk app keeps every chat for as long as the account exists. The privacy policy says so, because the 30-day retention of `imessage_*` rows does not reach it. The phone is enrolled with no other accounts, and its notification history is turned off.

## Risks / Trade-offs

- **Inbound secret is full trust.** Whoever holds the inbound secret can post a message event for any room ID, and room IDs are numeric. A leaked inbound secret therefore lets someone speak as any bound host, approvals included. The outbox secret is separate so a leak of one does not expose both directions; rotation (design 2) and the lost-phone steps are the response.
- **Kept reply actions and shared intents.** Android identifies a `PendingIntent` by its intent and request code, not its extras. If KakaoTalk reused one intent across rooms, a kept action could point at another room. On 2026-11-26 the 답장 actions of two rooms on the relay phone (a 1:1 chat and a group) were different `PendingIntentRecord`s, so KakaoTalk appears to build one intent per room. The relay still drops a kept action whose intent equals one held for another room, and a test with two 1:1 rooms is a release task.

- **Terms of service (Q1).** Kakao can suspend the account. Every linked host loses the channel at once, and the service cannot tell them through KakaoTalk. Mitigation: hosts keep `/app` and email, and the relay-down alert fires within five minutes.
- **Nudge delay.** A notice the service starts reaches the host as a nudge first. The content follows only when the host writes back. This is the price of never sending private content to a chat chosen by name.
- **App updates.** A KakaoTalk update can change the notification tag or the chat list layout. The reply path depends only on Android's notification API and is the less fragile of the two. The heartbeat reports the KakaoTalk version.
- **Single phone.** The relay is a single point of failure. KakaoTalk allows one phone per account, so a second relay phone is not possible. KakaoTalk for Mac can be signed in beside the phone, which is how [`host-kakaotalk-mac-relay`](../host-kakaotalk-mac-relay/design.md) keeps this phone as a standby.

## Open Questions

- Q1 to Q5 in the [proposal](proposal.md#unresolved-decisions-for-the-team).
- Is the room ID in the tag stable across a KakaoTalk reinstall or a move of the account to a new phone?
- Which notification field marks an open chat? The device check covered 1:1 and group chats only.

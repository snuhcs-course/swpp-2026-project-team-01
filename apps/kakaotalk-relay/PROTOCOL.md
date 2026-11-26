# Relay wire protocol

This file is the exact contract between the relay app and the service for the [`host-kakaotalk-channel`](../../openspec/changes/host-kakaotalk-channel/design.md) change. The design (§2, §3, §5 and §7) and the [spec](../../openspec/changes/host-kakaotalk-channel/specs/host-kakaotalk-channel/spec.md) decide the behavior. This file fixes the bytes. The relay code that produces these shapes is `app/src/main/java/com/findmeatime/kakaorelay/core/RelayProtocol.kt`, and its tests are `app/src/test/java/com/findmeatime/kakaorelay/core/`.

Every request is a `POST` with a JSON body and `Content-Type: application/json; charset=utf-8`. The base URL is the service origin, for example `https://findmeatime.com`, and the routes below are appended to it.

| Route | Secret | Purpose |
|---|---|---|
| `POST /kakaotalk/webhook` | inbound | One message event or one `void_code` event |
| `POST /kakaotalk/outbox/claim` | outbox | Long poll of up to 25 seconds for one outgoing message |
| `POST /kakaotalk/outbox/<id>/result` | outbox | The outcome of one claimed message |
| `POST /kakaotalk/heartbeat` | outbox | Relay health, every 60 seconds |

## Signing

Each request carries three headers:

- `X-FMAT-Relay-Timestamp`: Unix seconds, in decimal.
- `X-FMAT-Relay-Nonce`: 16 random bytes as 32 lowercase hex characters.
- `X-FMAT-Relay-Signature`: lowercase hex HMAC-SHA256 over the canonical string.

The canonical string joins five parts with `\n` (one line feed, no trailing one):

```text
METHOD\npath\ntimestamp\nnonce\nbody
```

- `METHOD` is upper case: `POST`.
- `path` is the request path exactly as sent, without the query, such as `/kakaotalk/webhook` or `/kakaotalk/outbox/m1/result`. When the base URL has a path prefix, the prefix is part of the signed path. Outbox IDs are percent-encoded as a path segment (unreserved characters `A-Z a-z 0-9 - . _ ~` are kept), and the encoded form is signed.
- `timestamp` and `nonce` are the header values.
- `body` is the exact request body bytes (UTF-8).

The HMAC key is the UTF-8 bytes of the secret string, as configured (the relay trims surrounding whitespace when it is saved). To decide whether a repeated event ID has the same payload, the service should compare parsed fields, not body bytes, because the relay does not promise a key order.

### Known-answer vectors

The relay's `RelaySignerTest` and `KakaoNotificationParserTest` assert these. The service tests should assert the same values.

**Vector 1: webhook**

- Secret: `test-inbound-secret`
- Method: `POST`
- Path: `/kakaotalk/webhook`
- Timestamp: `1795662000`
- Nonce: `00112233445566778899aabbccddeeff`
- Body (one line, no trailing newline):

```json
{"eventId":"486083133936417:1795662000123:0","roomId":"486083133936417","isGroup":false,"senderName":"Test Host","text":"hello","postedAt":"2026-11-26T03:00:00.123Z"}
```

- Signature: `83ea0d183792ab410a9b1795d8837af1c85087b3c04263f43d8358b7117a90e9`

**Vector 2: claim**

- Secret: `test-outbox-secret`
- Method: `POST`
- Path: `/kakaotalk/outbox/claim`
- Timestamp: `1795662000`
- Nonce: `ffeeddccbbaa99887766554433221100`
- Body: `{"postedRooms":["486083133936417"],"locked":false}` (an older claim shape, kept as the vector because only the bytes matter for signing)
- Signature: `c7760506fd48489399251e46543b56529c93fc1a425b560bc9d46ac7e205e7a5`

**Vector 3: void_code hash**

- Inbound secret: `test-inbound-secret`
- Code as found in the text: `fmat-7k3q9m2xwa` (upper-cased before hashing: `FMAT-7K3Q9M2XWA`)
- `codeHash`: `2a6f0e5c45fef716cd8c61d3ebfce454cb918bd2a0fccf178aa204356fa23fa2`

Reproduce vector 1 with OpenSSL:

```sh
printf 'POST\n/kakaotalk/webhook\n1795662000\n00112233445566778899aabbccddeeff\n%s' \
  '{"eventId":"486083133936417:1795662000123:0","roomId":"486083133936417","isGroup":false,"senderName":"Test Host","text":"hello","postedAt":"2026-11-26T03:00:00.123Z"}' \
  | openssl dgst -sha256 -hmac 'test-inbound-secret'
```

## Webhook events

### Message event (1:1 chat only)

```json
{
  "eventId": "486083133936417:1795662000123:0",
  "roomId": "486083133936417",
  "isGroup": false,
  "senderName": "Test Host",
  "text": "hello",
  "postedAt": "2026-11-26T03:00:00.123Z"
}
```

- `eventId` is `<roomId>:<message timestamp in epoch milliseconds>:<index>`. The index counts the earlier messages in the same notification that share that timestamp, starting at 0, in notification order.
- `roomId` is the decimal room ID from the notification tag `<accountId>_<roomId>`. It is a string; it does not fit a JavaScript number safely.
- `isGroup` is always `false`. Group and open-chat text is never sent.
- `senderName` is the `Person` name on the message, the sender's KakaoTalk profile name. It never comes from the text.
- `text` is the message text as the notification shows it. It can be `""`.
- `postedAt` is the same timestamp as ISO 8601 UTC with milliseconds.
- `nonText: true` is added only when the notification marks the message as carrying data (an image or file). The text is then KakaoTalk's placeholder, such as a localized "photo". The key is absent otherwise.

There is no `kind` key on a message event. The service tells the two events apart by `kind`.

### void_code event (group or open chat)

```json
{
  "kind": "void_code",
  "eventId": "void:486083133936417:1795662000123:0:0",
  "codeHash": "2a6f0e5c45fef716cd8c61d3ebfce454cb918bd2a0fccf178aa204356fa23fa2"
}
```

- Sent for each distinct link code found in a message from a chat the relay does not treat as 1:1. No text, room ID, name or timestamp field is sent apart from what the `eventId` carries.
- A code is found with the service's `LINK_CODE` pattern (`lib/server/redaction.ts`), case-insensitive, with JavaScript's ASCII `\b` spelled out: `(?<![A-Za-z0-9_])FMAT-[0-9A-HJKMNP-TV-Z]{10}(?![A-Za-z0-9_])`.
- `codeHash` is lowercase hex HMAC-SHA256 of the upper-cased code, keyed by the UTF-8 bytes of the inbound secret the relay holds. During a rotation, the service should compare it under both the current and the `_PREVIOUS` inbound secret.
- `eventId` is `void:<message eventId>:<k>`, where `k` counts the distinct codes in that message from 0. It is for deduplication only.

### Answers the relay expects

| Status | What the relay does |
|---|---|
| `2xx` | Acknowledged: the ID joins the ring of 500 and the event's text is deleted from the phone |
| `400`, `409`, `413`, `422` | Final refusal (such as a changed payload under a stored ID): the event is dropped and counted |
| Anything else, or a network error (including `401`, `404`, `429` and `5xx`) | The event stays queued and is retried, in order, at the next notification or within a minute |

## Claim

Request:

```json
{ "postedRooms": ["486083133936417"], "replyableRooms": ["486083133936417", "512000000000001"], "locked": false }
```

- `postedRooms`: sorted room IDs of 1:1 chats with a notification posted now that has a reply action. Group rooms are never listed.
- `replyableRooms`: sorted room IDs of 1:1 chats the relay holds a reply action for, either posted now or cached in memory after KakaoTalk removed the notification. It is a superset of `postedRooms`. The relay keeps the newest 답장 action per room and drops a room when firing it reports a cancelled `PendingIntent`. The cache is lost when the app restarts. Whether a cached action still delivers is a hypothesis under test (2026-11-26). Until it is confirmed, the service decides whether to hand out a `reply` claim for a room that is only in `replyableRooms`.
- `locked`: the same lock state as the heartbeat, advisory, so the service can skip a nudge without waiting for the next heartbeat.

The service holds the request for up to 25 seconds. The relay waits 40 seconds for the answer and polls again at once, with at least 2 seconds between polls that end with nothing.

Answer with nothing to send: `204 No Content`. The relay also accepts `200` with an empty body, `null` or `{}`.

Answer with a message (`200`):

```json
{ "id": "m1", "leaseToken": "opaque", "mode": "reply", "roomId": "486083133936417", "text": "…" }
```

```json
{ "id": "m2", "leaseToken": "opaque", "mode": "nudge", "displayName": "Test Host", "text": "Find Me a Time에 새 소식이 있어요. 아무 말이나 답장해 주시면 바로 보내드릴게요." }
```

- `reply` needs `roomId` and `text`. `nudge` needs `displayName` and `text`. Other fields are ignored.
- The relay types a nudge only when `text` is exactly the fixed nudge above (design 1). Any other nudge text is reported `failed` and nothing is sent. Changing the nudge sentence therefore needs a relay release.
- A claim with `id` and `leaseToken` but a missing or unknown `mode`, or a missing required field, is reported `failed`. A body without `id` or `leaseToken` is treated as an error, and the lease runs out.
- Any status other than `2xx` (for example `401`, or `503` while the relay is down) is an error. The relay backs off from 5 to 60 seconds.

## Result

`POST /kakaotalk/outbox/<id>/result`:

```json
{ "leaseToken": "opaque", "outcome": "accepted" }
```

`outcome` is one of:

| Outcome | When the relay reports it |
|---|---|
| `accepted` | `reply`: the reply action's `PendingIntent` fired (the posted notification's action, or else the cached one). `nudge`: after the send tap, the text appeared as a message and the input field was empty |
| `failed` | `nudge`: no chat or several chats matched the name in the chat list, or the opened room's header did not show the name, or the text was not the fixed nudge. Either mode: the claim was malformed. Nothing was sent |
| `uncertain` | `reply`: firing raised an error other than a cancelled `PendingIntent`. `nudge`: the send was tapped (or the tap threw) and the message was not seen within 6 seconds |
| `not_started` | `reply`: no posted or cached reply action for the room, or its `PendingIntent` was cancelled (the room then leaves `replyableRooms`). `nudge`: the phone was locked or the screen off, the accessibility service was not connected, or the screen did not respond before the send tap (the typed text is cleared). Nothing was sent |

The relay retries the report on a network error, `429` or `5xx`, every 3 seconds, for up to 100 seconds after the claim answer. It stops at the first `2xx` or at any other `4xx` (a stale or wrong lease token, or a report already taken), which it treats as final.

## Heartbeat

`POST /kakaotalk/heartbeat`, every 60 seconds while the relay service runs:

```json
{
  "listenerEnabled": true,
  "accessibilityEnabled": true,
  "locked": false,
  "kakaoVersion": "26.10.1",
  "postedRooms": ["486083133936417"],
  "replyableRooms": ["486083133936417", "512000000000001"]
}
```

- `listenerEnabled`: notification access is granted and the listener is connected.
- `accessibilityEnabled`: the accessibility service is turned on and connected.
- `locked`: the keyguard is up or the screen is off. Either stops the nudge path.
- `kakaoVersion`: KakaoTalk's `versionName`, or `null` when it is not installed.
- `postedRooms` and `replyableRooms`: as in the claim.

The relay ignores the answer body and shows the status on its screen.

## Mac relay

The [`host-kakaotalk-mac-relay`](../../openspec/changes/host-kakaotalk-mac-relay/design.md) change adds a second relay behind these routes: KakaoTalk for Mac, read from its database ([`apps/kakaotalk-mac-relay/`](../kakaotalk-mac-relay/README.md)). Signing, secrets, answers and outcomes are as above. Everything below is optional for the phone, which needs no release.

### The `relay` field and the active relay

Every Mac body (webhook, claim, result and heartbeat) carries `"relay": "mac"`. A body without `relay` comes from the phone (`"android"`). The service acts only on the relay that `KAKAOTALK_ACTIVE_RELAY` names (`android` by default). A webhook event, claim or heartbeat from the other relay is answered `409` with `{ "status": "standby" }`. A result is decided by its lease token, whichever relay sends it. A claim gets `204` until the active relay has sent a heartbeat.

### Message event from the Mac

```json
{
  "relay": "mac",
  "eventId": "486083133936417:log:3982372862361772034",
  "roomId": "486083133936417",
  "isGroup": false,
  "senderName": "Test Host",
  "senderUserId": "93652019",
  "logId": "3982372862361772034",
  "text": "hello",
  "postedAt": "2026-11-26T03:00:00.000Z"
}
```

- `roomId` is `NTChatRoom.chatId`, the same number as the phone's room ID for the same chat.
- `eventId` is `<roomId>:log:<logId>`, accepted only with `"relay": "mac"`. `logId` has up to 20 digits and is a string.
- `senderUserId` is `NTChatMessage.authorId`, the sender's Kakao user ID, as a decimal string. The service checks its form and stores nothing new for it.
- `nonText: true` and `"text": ""` mark anything but plain text.

### Group events from the Mac

- `void_code` is as above, with `"relay": "mac"` and `eventId` `void:<roomId>:log:<logId>:<k>`.
- `room_members`, sent only when the relay runs with membership events on, carries no names and no text. The service answers `200` and stores nothing:

```json
{ "relay": "mac", "kind": "room_members", "eventId": "486083613488751:members:3982014812382740481", "roomId": "486083613488751", "memberUserIds": ["93652019"], "activeMembersCount": 5 }
```

- `group_message` ([`kakaotalk-group-conversations`](../../openspec/changes/kakaotalk-group-conversations/design.md)) is one member's text in a group or open chat. It is never sent for the account's own messages, non-text messages, or a message with a link code (that one goes as `void_code` only):

```json
{ "relay": "mac", "kind": "group_message", "eventId": "486083613488751:log:3982014858587193345", "roomId": "486083613488751", "roomName": "카톡테스트용", "senderUserId": "93652019", "senderName": "Test Host", "text": "이브, 화요일 저녁 괜찮을까?", "postedAt": "2026-11-26T03:00:00.000Z" }
```

### Claim from the Mac

```json
{ "relay": "mac", "locked": false, "postedRooms": [], "replyableRooms": ["486083133936417"], "groupRooms": ["486083613488751"], "memberRooms": ["486083613488751"] }
```

- `replyableRooms`: the 1:1 rooms the relay may send to: the other person has written, and no other room's name contains the room's name.
- `groupRooms`: the titled group rooms whose title no other room's name contains. A group's reply is handed out only for one of these.
- `memberRooms`: the group rooms the account is in.
- The service hands the Mac relay no nudge, and nothing while its last heartbeat says `locked`.

A leave claim:

```json
{ "id": "m3", "leaseToken": "opaque", "mode": "leave", "roomId": "486083613488751", "text": "" }
```

It is handed out only for a room in `memberRooms`. The phone never receives one. The relay reports `accepted` once the room is gone from the database, and `not_started` when it could not press leave or the room is still there.

### Result from the Mac

`{ "relay": "mac", "leaseToken": "opaque", "outcome": "uncertain", "reason": "wrong_room" }` reports a message the relay found from the account in a room other than the claimed one. The service records `relay_wrong_room` and raises an alert. `reason` is only ever `wrong_room`.

### Heartbeat from the Mac

The fields are the phone's, with these meanings: `listenerEnabled` is a database read within two minutes, `accessibilityEnabled` is the helper's `AXIsProcessTrusted`, `locked` is the console session's screen lock, and `replyableRooms` is as in the claim. `postedRooms` is always empty.

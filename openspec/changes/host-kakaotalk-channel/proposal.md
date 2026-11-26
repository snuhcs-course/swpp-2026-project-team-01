# Proposal

Tracking issue: [#494](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/494).

The [PRD](../../../documentations/02_product_requirements.md#outside-the-initial-release) lists KakaoTalk as out of scope. This change and its implementation land in one pull request, and a teammate's approval of that pull request is the team decision on Q1. Until it is approved, KakaoTalk stays out of scope and the channel stays unconfigured in production.

## Why

KakaoTalk is the messenger most people in Korea use, and the user expects Korean hosts to read it more than iMessage, WhatsApp or Telegram. Today a KakaoTalk-only host has `/app` and email, and no conversation in the app they actually read. On 2026-11-26 the user asked for a KakaoTalk host channel that connects to eve, as the Telegram channel does. The channel must reply to incoming messages, and it must also be able to write first: proposal summaries, booking confirmations and reminders.

KakaoTalk has no public API for personal accounts. The official options are a KakaoTalk Channel chatbot (Kakao i Open Builder) and paid business messages (알림톡 and 친구톡 through a reseller). The chatbot can only answer a message the user has just sent. Business messages need a business registration, a reseller and a review of every template. This change proposes a third path, and the team has to accept its risk (Q1).

The path was checked on a real device on 2026-11-26: a Galaxy S22 (SM-S901N) signed in to a test account, with KakaoTalk 26.10.1.

- An incoming message in a 1:1 chat raises an Android `MessagingStyle` notification with **읽음** and **답장** actions, and `android.isGroupConversation` is `false`.
- A message in a group chat raises the same notification, with **답장**, and `android.isGroupConversation` is `true`.
- An invitation to a group chat raises no message notification. Only the group summary is updated, and it has no actions.
- A Kakao account notice (**카카오계정**) has **읽음** only.

Each message notification is tagged with the chat's room ID, so one chat can be told apart from another without reading its text.

## What Changes

- **Relay device.** A team-owned Android phone, signed in to a Find Me a Time KakaoTalk account, runs a small relay app. The relay app reads KakaoTalk notifications with a notification listener. It sends private content only through the **답장** action of a notification posted for the host's own room, and keeps that action to send again after KakaoTalk removes the notification (three separate replies were delivered this way on 2026-11-26). When it holds no reply action for the room, for example after a restart, it sends only a fixed nudge with no private content, through an accessibility service that drives the KakaoTalk app. The host's answer to the nudge raises a notification, and the queued content follows through its **답장** action.
- **Webhook.** The relay app posts each new 1:1 message to `POST /kakaotalk/webhook` on the agent service, signed over method, path, timestamp and nonce. The service stores a receipt and its job before acknowledging, as the Telegram channel does.
- **Outbox.** The relay app claims outgoing messages from `/kakaotalk/outbox/claim` with a lease token and reports how each one ended. A message whose result is unknown is never sent again.
- **Images.** The relay cannot send images, so a setup or schedule review that needs one sends a link to the same review on `/app`.
- **Linking.** The host adds the Find Me a Time KakaoTalk account as a friend and sends it the `FMAT-` code in a 1:1 chat. The code binds that chat on arrival (`link-on-code` D1).
- **Reused behavior.** Everything else works as on Telegram: commands and references, approval in the host's own words, summaries, one active channel per host, ordered receipts, retention and messaging only in production.

## Decisions

The session that wrote this change proposed these on 2026-11-26. None has had a teammate review yet; task 1.1 covers them. The [design](design.md) records the reasoning and the rejected options.

| # | Decision | Choice |
|---|---|---|
| D1 | Transport ([design 1](design.md#1-transport)) | A relay app on a team-owned Android phone. Inbound messages come through a notification listener. Private content goes only through the `RemoteInput` (**답장**) of a notification posted for the bound room. A fixed nudge with no private content may go through an accessibility service. Rejected: a KakaoTalk Channel chatbot, which cannot write first; business messages, which need a reseller and template review for every notice; a Mac relay with `kakaocli` and `openkakao-cli`, whose sends could not complete on 2026-11-26 and which needs a Mac that is always signed in |
| D2 | Relay authentication ([design 2](design.md#2-relay-authentication)) | Every relay request is signed with HMAC-SHA256 over method, path, timestamp, a single-use nonce and body. Inbound events use `KAKAOTALK_RELAY_INBOUND_SECRET`; outbox, result and heartbeat use `KAKAOTALK_RELAY_OUTBOX_SECRET`. Each accepts a `_PREVIOUS` value for rotation. A missing secret refuses its routes |
| D3 | Sender identity ([design 3](design.md#3-sender-identity)) | The KakaoTalk room ID of a 1:1 chat, taken from the notification tag. It is hashed as `kakaotalk:<room ID>` and sealed for replies. Group and open-chat text is never forwarded; a link code seen there voids its attempt by hash. No phone number or Kakao user ID is read |
| D4 | Records ([design 4](design.md#4-records)) | `kakaotalk` is added to the `channel` checks of `imessage_receipts`, `imessage_links`, `imessage_bindings` and `imessage_outbox`, and to the channel list of `channel_usage_days`. The outbox gains `lease_token_hash`, `lease_expires_at` and `claim_attempts`. A receipt's message ID is `kakaotalk:<event ID>` |
| D5 | Outbox and delivery ([design 5](design.md#5-outbox-and-delivery)) | One claim per chat at a time, checked against the binding and the latest proposal at claim time. A 120-second lease with an opaque token. Outcomes map to the existing states `accepted`, `failed` and `uncertain`, plus `not_started`, which requeues up to three times. An ended lease becomes `uncertain` and is never resent |
| D6 | Linking ([design 6](design.md#6-linking)) | **Use KakaoTalk instead** beside each device's default channel. The card shows the account's KakaoTalk ID with **Copy ID** and the `FMAT-` code with **Copy code**. The host's 1:1 message with the code binds the chat on arrival and ends any other binding in the same transaction |
| D7 | Relay health ([design 7](design.md#7-relay-health)) | A heartbeat every minute with the service states, the lock state, the KakaoTalk version and the rooms with a posted notification. No claims after five minutes of silence or a disabled service; no nudges while locked. An alert when the relay goes down and again after an hour |
| D8 | Privacy ([design 8](design.md#8-privacy)) | The card says in one sentence that chats pass through Kakao and a relay phone. The privacy policy names both and says the relay phone's KakaoTalk app keeps every linked host's chat history. The relay app keeps no text after acknowledgment. `stop` ends the binding |

## Unresolved decisions for the team

| # | Question | Why it blocks |
|---|---|---|
| Q1 | Is the risk of Kakao's terms acceptable? Kakao's terms prohibit programs that use the service in ways Kakao has not authorized. The account may be suspended without notice, and every linked host would lose the channel at once | The PRD would have to move KakaoTalk out of "Outside the initial release". Only the team can make that call |
| Q2 | Who owns the relay phone and the KakaoTalk account? Who keeps the phone charged, online and unlocked? | The channel stops whenever the phone does |
| Q3 | Group chats stay out, as the PRD says for every channel. Should a host be able to invite the account into a group? | The device check showed that an invitation raises no notification, so the account cannot greet a group without the accessibility path |
| Q4 | Which device gets KakaoTalk? This change offers **Use KakaoTalk instead** beside the device's default channel and does not change the default | A Korean Android host might be better served with KakaoTalk as the default |
| Q5 | Setup and schedule reviews need an image, which the relay cannot send. This change sends a link to the review on `/app` instead | A host who never opens the browser cannot confirm setup in chat |

## Conflicts to resolve before implementation

| Conflict | Proposed resolution |
|---|---|
| **PRD non-goals.** Section 3 lists KakaoTalk as out of scope, and the decision log's Android audience row rejected "KakaoTalk for Korean hosts" | The PRD and decision log record the proposed decision, marked as pending until a teammate approves the pull request (Q1). Production stays unconfigured until then |
| **Provider channels are business APIs.** iMessage goes through Photon, WhatsApp through Meta and Telegram through the Bot API. Each has an account the product is allowed to automate | KakaoTalk is automated through a personal account on a relay phone. The proposal names this risk instead of hiding it (Q1, D1) |

## Capabilities

### New Capabilities

- `host-kakaotalk-channel`: the relay webhook and its signature, KakaoTalk sender identity by room ID, linking by a code sent in a 1:1 chat, the relay outbox and its delivery outcomes, relay health, privacy and the behavior reused from the Telegram channel.

### Modified Capabilities

The main specs name three channels in these requirements. This change adds KakaoTalk to each of them as follows. The deltas are written when the main specs are synced at archive time, because each one only widens a channel list.

| Specification | Requirement | Change |
|---|---|---|
| [`host-telegram-channel`](../../specs/host-telegram-channel/spec.md) | One messaging channel across three | Four channels; specified here in "Linking KakaoTalk by a code" |
| [`host-telegram-channel`](../../specs/host-telegram-channel/spec.md) | Channel offered by device with Telegram | Specified here in "KakaoTalk offered beside the device default" |
| [`host-imessage-channel`](../../specs/host-imessage-channel/spec.md) | Approval in the host's own words; No session for unlinked or group senders | KakaoTalk added to the channels named |
| [`chat-workspaces`](../../specs/chat-workspaces/spec.md) | Guided host setup in the linked chat | On KakaoTalk the review is a link to `/app` (Q5) |
| [`host-schedule-lookup`](../../specs/host-schedule-lookup/spec.md) | Schedule image in the linked chat | On KakaoTalk the image is a link to `/app` (Q5) |
| [`messaging-environments`](../../specs/messaging-environments/spec.md) | Preserve delivery state on environment denial | The relay routes deny before reading delivery state |

## Impact

- **New code:**
  - `lib/server/kakaotalk.ts`: the event parser, signature check, outbox claims and results.
  - `agent/channels/kakaotalk.ts`: the webhook, claim, result and heartbeat routes.
  - `apps/kakaotalk-relay/`: the Android relay app (Kotlin), with its notification listener, accessibility service and outbox client.
- **Changed code:**
  - `lib/contracts/messaging-channel.ts`: a fourth channel.
  - The outbox transport and the `/app` card.
  - The stand-in, which plays the relay.
- **Schema:** the `channel` checks of the four `imessage_*` tables, generated through pg-delta.
- **Dependencies:** none in the web app or agent. The relay app needs the Android SDK.
- **Systems:** a relay phone, a KakaoTalk account for the product, `KAKAOTALK_ACCOUNT_ID` and the two relay secrets on Vercel Production. All are left to the team (Q2).
- **Documents updated in the same pull request:** the [PRD](../../../documentations/02_product_requirements.md), the [decision log](../../../documentations/technical_specification/08_decision_log.md), the [provider setup](../../../documentations/technical_specification/03_provider_setup.md), the [implementation plan](../../../documentations/technical_specification/06_implementation_plan.md) and the privacy policy, with Korean mirrors.

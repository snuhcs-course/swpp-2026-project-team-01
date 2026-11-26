# Proposal

Tracking issue: [#494](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/494). This change builds on [`host-kakaotalk-channel`](../host-kakaotalk-channel/proposal.md) and [`host-kakaotalk-mac-relay`](../host-kakaotalk-mac-relay/proposal.md), which are not yet on `main`, and lands in the same pull request (#501).

## Why

On 2026-11-26, during the Mac relay's device check, the user sent a message in a KakaoTalk group the product's account is in and expected the assistant to answer there. Both earlier changes keep group text on the relay device, so nothing happened. The user then decided:

- The assistant replies in **every** group chat the account is in, not only groups bound by an organizer's code.
- It reads **every member's** messages, not only linked hosts'. A group has no host, so it gets its own conversation with no host tools.
- It replies **only when called**, for cost: a message that starts with `@` or names the account or the assistant. The other messages are context for the next call.

This supersedes, for KakaoTalk groups, the [group-chat scheduling draft](https://github.com/snuhcs-course/swpp-2026-project-team-01/tree/docs/group-chat-scheduling)'s rule that group messages go through a fixed parser with no model, and `host-kakaotalk-channel`'s rule that group text never leaves the relay (Q1).

## What Changes

- **Relay.** The Mac relay sends each member's group text as a `group_message` event with the room's ID and title and the sender's user ID and name. A message with a link code still goes only as its hash. The Android relay is unchanged.
- **Group conversations.** Each group is a `kakaotalk_group` principal with one `group_chat` discussion owned by no host. Its sessions get the group instructions and no tools.
- **Context and calls.** A message that does not call the assistant is kept, sealed, for 24 hours (at most 30 per group). A call becomes one input: the kept messages, then the call, each with its sender's name. The reply goes to the group.
- **Limits.** At most 30 calls a group and 300 across groups are answered in 24 hours; a call past them is kept as context. Model spend is charged to the group as anonymous work, under the existing anonymous caps.
- **Sending.** Only the Mac relay sends to a group, and only to a titled group whose title no other room's name contains (the Mac relay's name rule). A group's reply is never handed to the phone.
- **Privacy.** The privacy policy says that, in a group with the account, every member's messages reach the service, and those that call the assistant reach the model.

## Decisions

Proposed on 2026-11-26 from the user's answers in the session. None has had a teammate review.

| # | Decision | Choice |
|---|---|---|
| D1 | Scope ([design 1](design.md#1-which-groups-and-messages)) | Every group and open chat the Mac relay's account is in, every member's text. Rejected: only code-bound groups (the draft's rule), only linked hosts' messages |
| D2 | Identity ([design 2](design.md#2-a-conversation-owned-by-no-host)) | A new principal type, `kakaotalk_group`, and audience, `group_chat`, with no tools. Rejected: running group messages in a member host's session, which would let a group read that host's calendar through the tools |
| D3 | Calls ([design 3](design.md#3-context-and-calls)) | Reply only to a message that starts with `@` or names the account or the assistant (`KAKAOTALK_GROUP_NAMES`). Other messages are kept for 24 hours as context. Rejected: answering every message, which costs a model call per message in a chatty group |
| D4 | Delivery ([design 4](design.md#4-replies)) | The reply is a `turn` row with no binding, for the group's room, claimed only by the Mac relay in reply mode for a room in its `groupRooms` |
| D5 | Limits ([design 5](design.md#5-limits-and-cost)) | 30 answered calls per group and 300 across groups per 24 hours; anonymous model caps; a `group` admission scope |
| D6 | Instructions ([design 6](design.md#6-instructions)) | Short plain-text answers in the caller's language, no claims of checking calendars or booking, a pointer to the web or a 1:1 chat for scheduling |

## Unresolved decisions for the team

| # | Question | Why it blocks |
|---|---|---|
| Q1 | Is it acceptable that every member's group messages reach the service, and calls reach the model, when anyone can add the account to a group? | It reverses two earlier privacy rules and the PRD's group-chat non-goal |
| Q2 | Should the group-chat scheduling draft be rewritten on top of these conversations? | The draft's fixed parser and FMAT-G binding now conflict with D1 to D3 |
| Q3 | Untitled groups cannot be answered, because `kakaocli` finds a chat only by its name. Is that acceptable until an exact way to open a chat exists? | Many groups are untitled |

## Capabilities

### New Capabilities

- `kakaotalk-group-conversations`: group messages from the Mac relay, the group conversation, calls and context, replies, limits and the group instructions.

### Modified Capabilities

`host-kakaotalk-channel` and `host-kakaotalk-mac-relay` are pending changes, so their requirements are not in the main specs. This change replaces their "Group and open chats" and "Group chats on the Mac relay" requirements, for the Mac relay, when both are synced at archive time.

## Impact

- **Code:** `lib/server/kakaotalk-groups.ts` (new), `kakaotalk.ts`, `imessage-receipts.ts`, `imessage-outbox.ts`, `kakaotalk-outbox.ts`, `eve-auth.ts`, `model-limits.ts`, `internal-bearer.ts`, `conversations.ts`, `conversation-admission.ts`; `agent/instructions/group-chat.ts`; the Mac relay's events, rooms, delivery and claim.
- **Schema:** `kakaotalk_groups` and `kakaotalk_group_messages`; `kakaotalk_group` in the principal checks of `discussions`, `agent_sessions` and `model_reservations`; `group_chat` in the audience check; `group` in the admission scope check.
- **Documents:** the privacy policy, `apps/kakaotalk-relay/PROTOCOL.md`, the provider setup and the decision log, with Korean mirrors.

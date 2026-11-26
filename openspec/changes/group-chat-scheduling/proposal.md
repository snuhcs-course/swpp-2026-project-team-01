# Proposal

Tracking issue: [#502](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/502).

**Status: draft, accepted in scope by the user on 2026-11-26 and simplified the same day, not yet reviewed by a teammate.** The [PRD](../../../documentations/02_product_requirements.md#outside-the-initial-release) still puts group scheduling, internal team coordination and group conversations outside the initial release, until task 1.1 updates it and the decision log.

## Why

On 2026-11-26 the user suggested that inviting the product's KakaoTalk account into a group chat could start group scheduling. In Korea, friends, clubs and study groups usually pick a meeting time in a KakaoTalk group chat. They do it with a long thread of "I can't do Tuesday" messages, or with a link to an outside poll. A Find Me a Time account in the room could do that work for them, using a host's real calendar and rules.

KakaoTalk for Mac on an always-on Mac mini, signed in to the account, is the relay for groups (`host-kakaotalk-mac-relay`, on `main` since #501). It reads each room's exact `chatId`, each message's author user ID (`senderUserId`) and each group's member IDs from the app's database, and it can send to a room and leave it. The [`kakaotalk-group-conversations`](../kakaotalk-group-conversations/proposal.md) change, also from #501, gives every group a conversation owned by no host. It answers a message that calls the account by name (`타임래빗`, `TimeRabbit`), with up to 30 earlier messages as context, and it has no tools.

The first version of this draft asked an organizer to fetch a one-time `FMAT-G` code, kept every decision out of the group, and tied members to the poll page with a second `FMAT-M` code. Later on 2026-11-26 the user asked for the simplest UX they could get: "그냥 최대한 ux가 간편하면 좋을것같은데" ("I'd like the UX as simple as possible"), and "링크로 들어가서 각자 구글로그인하면 알아서 연동되고 캘린더 수합되게" ("everyone opens the link and signs in with Google, and it connects and collects the calendars on its own"). This version drops both codes and the reuse question, and lets the organizer start and confirm in the group. The Mac relay's exact user IDs make that safe enough: the service knows which member is a linked host without trusting a profile name.

## What Changes

All of this is proposed. A teammate has not reviewed it.

- **Start by calling the account.** A member writes in the group, for example "타임래빗, 이번 주 금요일 저녁 2시간 잡아줘". If the sender's KakaoTalk user ID belongs to a linked, set-up host, that host becomes the **organizer** and a group request opens for the room. The host's user ID is learned from their own 1:1 KakaoTalk room with the account. A caller who is not a linked host gets one fixed reply with the sign-up link. No code is needed.
- **One link, Google sign-in, calendars collected on their own.** The bot posts one poll page link (`/g/<token>`). Each member opens it and signs in with Google. The service then reads that member's busy times, read-only, and removes them from the organizer's candidate times. Nobody signs up. A member who used the product before, with the same Google account, is recognized with no further step. A member who does not want to connect ticks times on the same page.
- **Numbered times in the group.** When enough members have signed in or ticked, the bot posts up to five numbered times. Members can also answer with numbers in the group ("1 3").
- **Confirmation in the group by the organizer.** The organizer writes "2번으로 확정" in the group. It books only when the message's KakaoTalk user ID is the organizer's, and only through the Mac relay. The organizer can still book from their 1:1 chat or `/app`. Booking rechecks the organizer's calendars first, as `calendar-booking` already does. Members who left an email on the poll page are invited as attendees, and the group gets one confirmation.
- **Inside eve's group conversation.** Scheduling is part of the group conversation from `kakaotalk-group-conversations`. Bare numbers, a confirmation, `stop` and `/kickout` are handled before the model. The model gets tools to start a group request for the sender, show the poll and give the link, and record the sender's own answer, never a tool to book. Its context holds only what the group may see.
- **Counts, not reasons.** For each time, the group sees how many people said it works and their display names. It never sees why a time was left out, or anything from anyone's calendar.
- **Private notes.** A member can tell the account in their 1:1 chat a limit they do not want to say in the group. It shapes the candidate times and is never repeated.
- **`stop` and `/kickout`.** Anyone can end the group request with `stop` or `그만`, and anyone can make the account leave with `/kickout`. The account never leaves on its own.
- **Opening the right room.** For a group with no name of its own, or a name another room shares, the Mac relay opens each matching room and acts only in the one whose window shows the message it is answering.
- **Closing and retention.** A group request closes when it is booked, when the organizer cancels, or after `stop`. Members' answers are deleted 30 days after it closes.

## Decisions (proposed)

The session that wrote this change drafted these decisions on 2026-11-26 and simplified them the same day, following the user's answers listed below. A teammate has not reviewed them. The [design](design.md) records the reasoning. D1, D2, D3, D9 and D11 replace the code-based choices of the first draft.

| # | Decision | Proposed choice |
|---|---|---|
| D1 | Who the host is ([design 1](design.md#1-organizer)) | The **organizer** is the linked, set-up host whose call started the group request. A host is recognized only by their KakaoTalk user ID. The service stores that ID as a hash, learned from the host's own 1:1 room with the account on the Mac relay (`directChatMemberUserId`, the `senderUserId` of their 1:1 messages). A profile name never makes anyone a host. One organizer per group request. Other linked hosts in the room count as members |
| D2 | Starting ([design 2](design.md#2-starting-a-group-request)) | A message that calls the account and asks for a meeting. The group conversation's `start_group_request` tool takes the length, date range and mode from the message, and the organizer is the message's sender from the relay event. Values the message leaves out take the organizer's defaults. A caller who is not a linked, set-up host gets one fixed reply with the sign-up link and opens nothing. A room holds one open group request at a time. Group requests start only on the Mac relay |
| D3 | Authority ([design 3](design.md#3-authority)) | Only the organizer's user ID can confirm in the group, through the fixed command `<n>번으로 확정` or `<n>번 확정`, handled before the model. Other messages in the group cannot book, cancel or change settings, whoever wrote them, and the model has no tool that books. The organizer's 1:1 chat, `/app` and their agent with `host:decide` also book. This trusts the Mac relay's sender ID as far as 1:1 approvals already trust its room ID: a leaked relay secret could forge either |
| D4 | Gathering availability ([design 4](design.md#4-gathering-availability)) | One poll page link. A member signs in with Google there, and the read-only grant's busy times are collected for this group request with no further step. Candidates are the organizer's feasible times with every signed-in member's busy times removed, up to five. A member who does not connect ticks times on the page or answers with numbers in the group. All answers count the same, with no "unverified" label |
| D5 | Scheduling in the group conversation ([design 5](design.md#5-the-group-conversation)) | Built on `kakaotalk-group-conversations`. The service handles bare numbers, the organizer's confirmation, `stop`, `그만` and `/kickout` before the model, whether or not the message calls the account. A call gets `start_group_request` in any group. While the room has an open request, it also gets `group_poll_status`, `group_poll_link` and `record_group_answer`. Every tool takes its sender from the relay event and has no sender argument. The model's context holds only the group projection (D8). The introduction, the times, the confirmation and the goodbye are fixed templates |
| D6 | Consent and privacy ([design 6](design.md#6-consent-and-privacy)) | A fixed introduction when the request opens, a privacy link, `stop` open to every member, no answer stored until a member gives one, a display name the member chooses, no phone number read, KakaoTalk user IDs kept only as hashes, answers deleted 30 days after closure, and a delete action on the poll page |
| D7 | Booking ([design 7](design.md#7-confirmation-and-booking)) | Booking rechecks the organizer's calendars for the chosen time before dispatch. The event goes into the organizer's booking destination. Members who left an email on the poll page are invited as attendees; the others get the group confirmation and a calendar file. The group receives one confirmation |
| D8 | What the bot never says in a group ([design 8](design.md#8-what-the-group-never-sees)) | Calendar event titles, places, attendees or busy reasons of the organizer or any member; the organizer's rules, notes, exceptions or other requests; which member's calendar blocks a time; whether a member connected a calendar or used the product before; a member's email; any account-specific link |
| D9 | Returning members ([design 4](design.md#4-gathering-availability)) | Recognized by Google sign-in on the poll page, with no question in the group. An existing host's conflict calendars count, and a past member's remembered grant is reused, with no new consent screen. The page names the calendars that count and offers **Don't use my calendar** and **Forget me**. A remembered grant is deleted 180 days after the member's last group request closes |
| D10 | When the times are posted ([design 4](design.md#4-gathering-availability)) | The expected number of members defaults to the room's member count from the Mac relay, less the account and the organizer, and the organizer can name another number when starting. The times are posted as soon as that many members have signed in or ticked, when anyone asks the account for them, or 24 hours after the request opened, whichever comes first |
| D11 | Member identity ([design 9](design.md#9-member-identity)) | On the poll page, a member is their Google account, or the device that ticked. In the group, a member is their KakaoTalk user ID, kept as a hash while the request is open. The two are not tied together: there is no member code. The service keeps the room's member IDs as hashes for the headcount and private notes |
| D12 | Private notes ([design 10](design.md#10-private-notes)) | A member can tell the account in their 1:1 chat what they do not want to say in the group. The note is read back, then counts only as busy or less-preferred times for that group. It is never repeated in the group or shown to the organizer |
| D13 | Leaving the room ([design 11](design.md#11-leaving-the-room)) | `/kickout` from any member of any group makes the account post a fixed goodbye and leave. The account never leaves on its own. Leaving uses the Mac relay's `leave_room`, after the room check of D16 |
| D14 | No first messages ([design 9](design.md#9-member-identity)) | The account never starts a 1:1 chat with a member. The introduction says that anyone can write to it 1:1 |
| D15 | Transport ([design 12](design.md#12-the-mac-relay)) | The KakaoTalk for Mac relay, active. Starting, numbers in the group and confirmation in the group need it, because only it gives user IDs. While the phone is active, a call to start gets one fixed reply, and posts to the room wait |
| D16 | Opening the right room ([design 12](design.md#12-the-mac-relay)) | Before it posts in or leaves a group that the Mac relay's name rule cannot address, the helper opens each chat-list row with the room's label and acts only in the window that shows the message being answered, or else the room's three newest messages. No match, or more than one, sends nothing and leaves nothing |

## Answers from the user (2026-11-26)

The user who suggested the idea answered these questions. They are the user's choices, not team decisions.

| Question | Answer |
|---|---|
| How simple should it be? | As simple as possible: one link, each member signs in with Google, and the calendars connect and are collected on their own. This replaced the organizer code, the member code, the reuse question and the rule that nothing is decided in the group |
| What about members who do not connect Google? | They tick times by hand on the same page, or answer with numbers in the group |
| Do numbered answers in the group count, and are they labelled? | They count, with no "unverified" label. Only the organizer can book, so a forged answer can sway the count but cannot book anything |
| Who gets a Google invitation? | Members who left an email on the poll page |
| When are the numbered times posted? | As soon as the number of members the organizer expects have connected or ticked, or when asked, or after 24 hours at the latest |
| How many candidate times? | Five |
| Should an unbooked group close on its own? | No. It stays open until it is booked, the organizer cancels, or someone sends `stop` |
| Telegram groups too? | Later, in a change of its own |
| How long is a past member's connection remembered? | 180 days after their last group request closes, or until **Forget me** |
| Which relay? | The KakaoTalk for Mac relay on the always-on Mac (D15) |
| May the organizer see a private note, or that one exists? | No |
| When should the account leave a group on its own? | Never. It stays until a member sends `/kickout` |
| How does the bot post in or leave a group that has no name of its own? | It opens the room and checks that the message it is answering shows there, and acts only then (D16) |
| Does the team want group scheduling, and with the Mac relay active? (was Q1, Q2) | Yes |

## Unresolved decisions for the team

| # | Question | Why it matters |
|---|---|---|
| Q1 | Is confirming in the group by the organizer's KakaoTalk user ID acceptable (D3)? | It moves a booking decision into a room where the only proof of the sender is the relay's report. The same trust already backs 1:1 approvals, but a teammate should agree before it is built |

## Conflicts with current documents

None of these conflicts is resolved by this draft.

| Document | What it says now | What this change would need |
|---|---|---|
| [PRD §1 and §3](../../../documentations/02_product_requirements.md#outside-the-initial-release) | Group scheduling, internal team coordination and group meetings are outside the initial release | The team's decision recorded in the PRD and the [decision log](../../../documentations/technical_specification/08_decision_log.md) (task 1.1) |
| PRD FR-26, FR-37, FR-40, AC-17, AC-33 | Group conversations cannot retrieve host-only details or act as the host | A group still gets no host-only details. What changes is that a group can receive candidate times and confirmations, and that the organizer's own user ID can confirm in it (D3) |
| [`calendar-booking`](../../specs/calendar-booking/spec.md) "Attributable approval of the current proposal" | Approval comes from the host's own channel, `/app` or their agent | Adds a group message whose relay-reported sender is the organizer (D3) |
| [`calendar-booking`](../../specs/calendar-booking/spec.md) "Host-owned event with stable identity" | The requester is the only attendee | A group booking has zero or more member attendees: those who left an email |
| [`requester-calendar-access`](../../specs/requester-calendar-access/spec.md) "Request-bound grant lifetime" | A requester's Google grant is used for its own request only | A group member's grant is remembered across group requests until **Forget me** or 180 days after their last group request. It stays read-only and busy-only |
| [`kakaotalk-group-conversations`](../kakaotalk-group-conversations/proposal.md) D2 and design 8 | A group session has no tools, and the instructions say it never books | A call gets `start_group_request`, and an open request adds the poll tools (D5). Confirmation stays outside the model |
| [`kakaotalk-group-conversations`](../kakaotalk-group-conversations/proposal.md) D3 | Only a message that names the account runs anything; others are context | Bare numbers, the organizer's confirmation, `stop`, `그만` and `/kickout` are handled whether or not they call the account (D5) |
| [`kakaotalk-group-conversations`](../kakaotalk-group-conversations/design.md) design 4 and Q3 | A reply goes only to a titled group whose title no other room's name contains | Scheduling posts and the leave reach other groups through the room check (D16) |
| [`host-kakaotalk-mac-relay`](../host-kakaotalk-mac-relay/design.md) design 2 and 4 | The sender's user ID is checked but not stored, and membership events store nothing | A host's user ID is stored as a hash on their KakaoTalk binding (D1). An open request's member IDs are kept as hashes (D10, D11) |
| [`host-kakaotalk-mac-relay`](../host-kakaotalk-mac-relay/design.md) design 7 | The service decides when to leave a group | `/kickout` from any member of any group (D13) |
| [`host-imessage-channel`](../../specs/host-imessage-channel/spec.md) "No session for unlinked or group senders" | Group conversations get nothing | Unchanged for iMessage |
| `group-scheduling` ([#486](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/486), branch `feat/group-scheduling`, not merged) | A host shares one group link; participants connect Google Calendar, and the host books one option that invites everyone | The same poll page and group request model. The two changes need to agree on one before either is implemented |
| [`meeting-requests`](../../specs/meeting-requests/spec.md) | A request has one requester, one guest conversation and one agreement | A group request is a separate record type with many answering members |

## Rejected alternatives

| Alternative | Why it was rejected |
|---|---|
| **An `FMAT-G` code from `/app` or the 1:1 chat to activate the room.** | The first draft's choice. The organizer had to leave the group to fetch a code. The Mac relay's user IDs identify a linked host directly, so the call itself is enough (D1, D2) |
| **An `FMAT-M` code to tie a member's KakaoTalk ID to their poll page identity.** | An extra step that only served the reuse question. Google sign-in on the page recognizes a returning member by itself (D9, D11) |
| **Asking a returning member in the group whether to reuse their calendar.** | It told the room that the member had used the product before, and added a step. Sign-in on the page is the consent (D9) |
| **Any member can confirm or book from the group.** | A member could book an event in the organizer's calendar. Only the organizer's user ID confirms (D3) |
| **Recognize the organizer by profile name.** | Anyone can rename themselves to match the organizer |
| **Let the model book when the organizer asks.** | A call's input holds other members' messages, which can carry instructions. Confirmation is a fixed command handled before the model (D3, D5) |
| **Let the model record an answer for whoever a message names.** | One member could answer for another. Tools take the sender from the relay event (D5) |
| **Give the group conversation the organizer's context, so it can explain missing times.** | The model could be talked into repeating it. Its context holds only the group projection (D8) |
| **Every member signs up, or must connect Google Calendar.** | Most groups would stop at the first step, and members without Google would be left out |
| **Read a linked host's calendar because they sit in the room.** | That uses a calendar without its owner's say. A member's calendar counts only after they sign in on the page (D9) |
| **KakaoTalk's built-in poll (투표).** | The relay sends only text, and the results cannot be read without scraping the screen |
| **A group request as a normal meeting request with many requesters.** | Every requester rule assumes one requester |
| **Start 1:1 chats with members (선톡).** | Messages to people who never wrote to the account carry the highest risk of suspension (D14) |
| **Post in or leave a group found by its chat-list name alone.** | Two rooms can share a name, and leaving the wrong room cannot be undone (D16) |
| **Leave a group on its own after booking or after a quiet period.** | The user chose that the account stays until `/kickout` |
| **Answer groups through the Android phone.** | It gives no user IDs, so it can tell neither the organizer nor one member from another |

## Capabilities

### New Capabilities

- `group-chat-scheduling`: starting a group request by calling the account, the poll page with Google sign-in, candidate times, answers in the group and on the page, what the group may and may not see, confirmation by the organizer, the group booking, private notes, `stop`, `/kickout`, the room check and retention.

### Modified Capabilities

None are written yet. The conflicts table lists the requirements a later version would change: `calendar-booking` (attendees and the group confirmation), `requester-calendar-access` (remembered member grants), `kakaotalk-group-conversations` (tools and commands before the model), `host-kakaotalk-mac-relay` (host user IDs, member IDs, `/kickout` and the room check) and the PRD functional requirements. These deltas are task 1.4.

## Impact

This is an estimate for discussion. Nothing is built.

- **Depends on:** `host-kakaotalk-channel`, `host-kakaotalk-mac-relay` and `kakaotalk-group-conversations`, merged in #501, released with the Mac relay active.
- **New code:** the host user ID hash on KakaoTalk bindings, the commands before the group conversation and its scheduling tools, the group request records, the poll page `/g/<token>`, and the ranking in `/app` and the organizer's chat.
- **Changed code:** the Mac relay (`/kickout`, membership events for open requests, and the room check), the group conversation's tools and instructions, the booking job (several attendees), and the retention pass.
- **Schema:** new tables for group requests, members' answers and remembered member grants, and a host user ID hash on the KakaoTalk binding, generated through pg-delta, with RLS that denies all client roles.
- **Documents:** the PRD, the decision log, the implementation plan, the privacy policy (members who never signed up), and their Korean mirrors.

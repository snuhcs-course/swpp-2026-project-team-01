# Proposal

Tracking issue: [#502](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/502). Builds on `group-scheduling` ([#486](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/486), PR [#504](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/504), branch `feat/group-scheduling`, not merged).

**Status: draft, accepted in scope by the user on 2026-11-26, simplified and re-scoped onto `group-scheduling` the same day, not yet reviewed by a teammate.** The [PRD](../../../documentations/02_product_requirements.md#outside-the-initial-release) still puts group conversations outside the initial release, until task 1.1 updates it and the decision log.

## Why

On 2026-11-26 the user suggested that inviting the product's KakaoTalk account into a group chat could start group scheduling. In Korea, friends, clubs and study groups usually pick a meeting time in a KakaoTalk group chat, through a long thread of "I can't do Tuesday" messages or a link to an outside poll.

The user then asked for the simplest UX they could get: "그냥 최대한 ux가 간편하면 좋을것같은데" ("I'd like the UX as simple as possible"), and "링크로 들어가서 각자 구글로그인하면 알아서 연동되고 캘린더 수합되게" ("everyone opens the link and signs in with Google, and it connects and collects the calendars on its own").

That core already exists in a teammate's change. [`group-scheduling`](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/504) lets a set-up host create a group meeting in their linked messenger. It sends one shared link (`/g/<token>`), has each participant sign in with Google and confirm the times they cannot meet, and sends the host up to three options. The host then books one event with every participant as an attendee. Its D1 leaves "invitations to a Slack or KakaoTalk room" for later. This change is that KakaoTalk piece, and only that piece. It defines no poll page, search or booking of its own, and only shortens the participant flow for room meetings.

What it adds is the room. The KakaoTalk for Mac relay (`host-kakaotalk-mac-relay`, on `main` since #501) reports each group message's room and the author's KakaoTalk user ID. [`kakaotalk-group-conversations`](../kakaotalk-group-conversations/proposal.md), also from #501, answers a message that calls the account by name (`타임래빗`, `TimeRabbit`). With those, anyone in the group can start a `group-scheduling` meeting from the group itself, and a linked host's settings are used when the caller is one. The link, the options and the confirmation then go through the group chat, and the host never has to copy anything across.

## What Changes

All of this is proposed. A teammate has not reviewed it.

- **Start by calling the account in the group.** Anyone in the group can do it, linked or not (user, 2026-11-26). A member writes, for example, "타임래빗, 다음 주 금요일 저녁 2시간 잡아줘". The caller becomes the **organizer** of a new `group-scheduling` meeting, with this room attached. The number of people defaults to the room's member count, less the account and the organizer. The organizer's whole job is to invite the account and call it, then confirm a time; the service does the rest.
  - **A linked host** is recognized by their KakaoTalk user ID, learned from their own 1:1 KakaoTalk room with the account. Their settings and calendars are used as for any host.
  - **A caller with no account** does nothing more than any member: open the link, two taps, then "n번으로 확정" in the room. Their KakaoTalk user ID is the organizer, and the event is created in the product's own scheduling calendar with everyone who signed in as an attendee. No Find Me a Time account is made.
- **#504's link, as easy as when2meet.** The bot posts the meeting's shared link `/g/<token>` with a fixed introduction. The user's bar: "when2meet처럼 쓰기 엄청쉬워야햐" ("it has to be extremely easy to use, like when2meet"). So for room meetings the participant flow is two taps: **구글로 계속하기**, which reads the calendar, then **이대로 보내기** on a grid with the busy times already filled in. There is no account, profile or question first, and name and email come from Google. A member without Google can paint their free times on the same grid with no sign-in. The link keeps working: a member can come back and change their answer until the close. The room gets a short done count ("4/6명 완료") with no names.
- **Options in the room.** When the meeting closes, because it is full or the organizer closes it, the organizer gets `group-scheduling`'s notice as usual. The room gets the same options, numbered, with how many people can make each, but no names and no reasons.
- **Confirmation in the room by the organizer.** The organizer writes "2번으로 확정" in the room, or names the option in their own chat as `group-scheduling` already allows. A confirmation in the room counts only when the message's KakaoTalk user ID is the organizer's, and only through the Mac relay. Booking is `group-scheduling`'s: the organizer's calendars are rechecked, and one event is booked with every participant as an attendee. The room gets one confirmation.
- **Inside eve's group conversation.** The organizer's confirmation, `stop`, `그만` and `/kickout` are handled before the model. A call gets tools to start a meeting for the sender, give the link and progress, and close early for the organizer, never a tool to book.
- **`stop` and `/kickout`.** Anyone can detach the room with `stop` or `그만`. The meeting then goes on only in the organizer's chat. Anyone can make the account leave with `/kickout`. The account never leaves on its own.
- **Opening the right room.** For a group with no name of its own, or a name another room shares, the Mac relay opens each matching room and acts only in the one whose window shows the message it is answering.

## Decisions (proposed)

The session that wrote this change drafted these decisions on 2026-11-26, following the user's answers listed below. A teammate has not reviewed them. The [design](design.md) records the reasoning. They replace the earlier drafts' decisions; the earlier drafts are in the history of PR #503 and this one.

| # | Decision | Proposed choice |
|---|---|---|
| D1 | Scope ([design 1](design.md#1-a-layer-on-group-scheduling)) | A KakaoTalk room layer on `group-scheduling`. The meeting, its shared link, the participant flow, the close, the option search and the booking are `group-scheduling`'s, unchanged except where this table says. This change adds one room binding per meeting and no poll page, participant table or search |
| D2 | Recognizing the organizer ([design 2](design.md#2-recognizing-the-organizer)) | The organizer is the caller's KakaoTalk user ID, from the relay event, kept as a keyed hash on the meeting. A linked host is recognized by the same ID, stored as a hash on their KakaoTalk binding and learned from their own 1:1 room on the Mac relay (`directChatMemberUserId`, the `senderUserId` of their 1:1 messages). A profile name never makes anyone the organizer or a host |
| D3 | Starting ([design 3](design.md#3-starting-from-the-room)) | Any member's call can start a meeting, whether or not they have an account (user, 2026-11-26). The group conversation's `start_group_meeting` tool creates a `group-scheduling` meeting for the message's sender, taken from the relay event, and attaches the room. It fills `group-scheduling`'s terms (purpose, length, date range, number of people), and asks once in the room for a missing length or date range. The purpose defaults to the room's title, and the number defaults to the room's member count less the account and, for a linked host, the organizer. One meeting per room at a time, and at most three live meetings per caller. This is a second place to create a group meeting, beside the host's linked messenger |
| D4 | Participants ([design 4](design.md#4-participants)) | For meetings started from a room, `group-scheduling`'s participant flow is shortened to two taps: **구글로 계속하기** (identity and read-only Calendar on one consent screen; name and email from Google), then **이대로 보내기** on a grid of the range with the busy times filled in, where extra times can be painted out first. `group-scheduling`'s one question and messenger step are left out. The answer can be changed until the close. The page shows the done count and never who is done. Members answer nothing in the room |
| D5 | What the room sees ([design 5](design.md#5-what-the-room-sees)) | The organizer's display name, the meeting's terms, the link, the done count against the number when asked, the numbered options with their place or "online" and how many of the participants can make each, and the confirmation. Never who is done, who cannot make an option, any participant's events, places or usual place, the organizer's rules or other requests, an email, or an account-specific link. The organizer's own notice from `group-scheduling` still names who cannot make each option |
| D6 | Options in the room ([design 6](design.md#6-options-and-confirmation)) | When the meeting closes, the room gets the options that `group-scheduling` sends the organizer, as one fixed message with the same numbers. An organizer with no account has no linked conversation, so the room is the only place they go. When the organizer asks for more, in their chat or by calling the account, the new options go to both. The organizer can close early by calling the account; the tool checks the sender |
| D7 | Confirmation ([design 6](design.md#6-options-and-confirmation)) | The organizer books by the fixed command `<n>번으로 확정` or `<n>번 확정` in the room, handled before the model and accepted only from the organizer's user ID through the Mac relay, or, for a linked host, by naming the option in their own chat as `group-scheduling` allows. Booking is `group-scheduling`'s "Host's choice books one group event". The room gets one fixed confirmation. This trusts the Mac relay's sender ID as far as 1:1 approvals already trust its room ID (Q1) |
| D8 | The group conversation ([design 7](design.md#7-the-group-conversation)) | Built on `kakaotalk-group-conversations`. The service handles the confirmation, `stop`, `그만` and `/kickout` before the model, whether or not the message calls the account. A call gets `start_group_meeting` in any group. While a meeting is attached, it also gets `group_meeting_status`, `group_meeting_link` and `close_group_meeting`. Every tool takes its sender from the relay event and has no sender argument. The model's context holds only what D5 lets the room see. The introduction, the options, the confirmation and the goodbye are fixed templates |
| D9 | Consent ([design 8](design.md#8-consent-and-stop)) | A fixed introduction with the organizer's name, the link, what the link collects and how to stop. Nothing is collected about a member until they open the link, where `group-scheduling`'s own consent applies. `stop` or `그만` from anyone detaches the room: the bot posts nothing more about the meeting there, and a linked host is told in their chat, where the meeting goes on. A meeting whose organizer has no account has nowhere else to go, so detaching it cancels it |
| D10 | Leaving ([design 9](design.md#9-leaving-the-room)) | `/kickout` from any member of any group makes the account post a fixed goodbye and leave, through the Mac relay's `leave_room`, after the room check of D12. It detaches the room as `stop` does. The account never leaves on its own |
| D11 | Transport ([design 10](design.md#10-the-mac-relay)) | The KakaoTalk for Mac relay, active, because only it reports user IDs. While the phone is active, nothing starts from a room and posts to attached rooms wait |
| D12 | Opening the right room ([design 10](design.md#10-the-mac-relay)) | Before it posts in or leaves a group that the Mac relay's name rule cannot address, the helper opens each chat-list row with the room's label and acts only in the window that shows the message being answered, or else the room's three newest messages. No match, or more than one, sends nothing and leaves nothing |
| D13 | No first messages ([design 8](design.md#8-consent-and-stop)) | The account never starts a 1:1 chat with a member |
| D14 | An organizer with no account ([design 3a](design.md#3a-an-organizer-with-no-account)) | The caller's KakaoTalk user ID is the organizer, and no sign-in is tied to it. The caller answers on the link like any member and counts as one of the people. Meeting hours default to 09:00 to 22:00 every day of the range, with no host places. The event is created in the product's own scheduling calendar, with every member who signed in as an attendee. Options and the confirmation happen only in the room. No host account, workspace or write grant is created. A caller who is a linked, set-up host uses their own settings |
| D15 | Painting without Google ([design 4](design.md#4-participants)) | Proposed, against `group-scheduling` D4. A second choice on the link, **구글 없이 직접 칠하기**, opens the same grid empty. The member types a name, paints the times they can meet, and sends, with no sign-in. Unpainted times count as unavailable. A device-bound token lets them change it. They get no Google invitation, only the room's confirmation and calendar file. Without it, a member with no Google account, or one who will not connect a calendar, cannot take part, which fails the when2meet bar |
| D16 | Done count in the room ([design 4](design.md#4-participants)) | One short line when members finish, at most once every 30 minutes, with the count and the link and no names |

## Answers from the user (2026-11-26)

The user who suggested the idea answered these questions. They are the user's choices, not team decisions.

| Question | Answer |
|---|---|
| How simple should it be? | As simple as possible: one link, each member signs in with Google, and the calendars are collected on their own. `group-scheduling` already does this, so this change reuses it (D1) |
| Who gets the invitation? | `group-scheduling` invites every done participant by their Google email |
| How easy must the link be? | "when2meet처럼 쓰기 엄청쉬워야햐" ("it has to be extremely easy to use, like when2meet"): open the link and be done in one or two taps, with no account setup and no question first (D4, D15) |
| Who can call the account to start? | Anyone in the group, linked or not: "연동 안된 사람도 부를 수 있게 해줘" ("let people who haven't linked call it too"). The host's whole job is to invite the account and call it; the service does the rest. The fixed sign-up reply is dropped (D3, D14) |
| Should the service book on its own when the options are in? | No. The organizer still confirms with "n번으로 확정" (D7) |
| Which relay? | The KakaoTalk for Mac relay on the always-on Mac (D11) |
| When should the account leave a group on its own? | Never. It stays until a member sends `/kickout` |
| How does the bot post in or leave a group that has no name of its own? | It opens the room and checks that the message it is answering shows there, and acts only then (D12) |
| Does the team want group scheduling from KakaoTalk groups, with the Mac relay active? | Yes |

The user's earlier answers on member answers in the group, remembered member grants, private notes and when an unbooked poll closes no longer apply. `group-scheduling` decides those points: grants stay request-bound, the grid collects private commitments on the page, and a meeting stays open until it is full or the host closes it.

## Unresolved decisions for the team

| # | Question | Why it matters |
|---|---|---|
| Q1 | Is confirming in the room by the organizer's KakaoTalk user ID acceptable (D7)? | It books from a room where the only proof of the sender is the relay's report. The same trust already backs 1:1 approvals, but a teammate should agree before it is built |
| Q2 | Does enu3379 agree to the extensions of `group-scheduling` in the conflicts table: a second creation point, an organizer with no host account, the two-tap flow, painting without Google, changing an answer until the close, and the options and confirmation in the room? | `group-scheduling` is theirs, and its D4, D7, D13, D17, D18 and host model say otherwise today |
| Q3 | For an organizer with no account, is it acceptable to book into the product's own scheduling calendar, with 09:00 to 22:00 as meeting hours and no host places (D14)? | It adds a Google account that the service holds and sends invitations from, and it decides which times are offered when the organizer has no settings |

## Conflicts with current documents

None of these conflicts is resolved by this draft.

| Document | What it says now | What this change would need |
|---|---|---|
| `group-scheduling` (PR #504) D1 | Invitations to a Slack or KakaoTalk room come later and are out of scope | This change is the KakaoTalk room piece, as a change of its own on top |
| `group-scheduling` D7 and "Group link created in the host's chat" | A group meeting is created only by a set-up host in the host's linked messenger conversation; any other interface creates nothing | Also from a KakaoTalk group, by any member's call (D3). `/app` still creates nothing |
| `group-scheduling` design 1 and D3 (the host) | `group_meetings` belongs to a host account, whose conflict calendars, places and booking destination are used | A meeting may instead belong to an organizer known only by their KakaoTalk user ID, with defaults for hours and places, booked into the service's scheduling calendar (D14, Q3) |
| `group-scheduling` D4 and "Participant flow without picking a date" | Calendar is required, there is no manual availability, and participants never pick times | **Proposed to change, not silently picked:** members of a room meeting can paint their free times with no sign-in (D15). The reason is the user's when2meet bar: without it, anyone without Google is left out. The cost is answers with no verified identity (design risks) |
| `group-scheduling` "Participant flow without picking a date" (step order) and D17 | Google, one question about commitments, usual place and travel, a review, a messenger link, done | For room meetings: Google, then one tap on the pre-filled grid, done (D4). No usual place or travel mode is asked, so travel is checked only between known events |
| `group-scheduling` D13 | A participant cannot change answers after done | A room meeting's participant can change their answer until the close, as on when2meet (D4) |
| [`calendar-booking`](../../specs/calendar-booking/spec.md) "Host-owned event with stable identity" | The event is owned by the host, in their booking destination | For an organizer with no account, the event is owned by the service's scheduling calendar (D14, Q3) |
| [`host-admission`](../../specs/host-admission/spec.md) | Host accounts pass the sign-up limits | Unchanged: an organizer with no account is not a host and gets no workspace, so no admission is needed. A per-caller limit of three live meetings bounds abuse (D3) |
| `group-scheduling` D10 and "Host told when the group closes" | The options go to the host's linked conversation | They also go to the attached room, without the names of who cannot make each (D5, D6) |
| `group-scheduling` D18 and "Host follows the group's progress" | The host hears nothing until the close and can ask for the count and names | The room can ask for the count, never the names (D5). Nothing changes for the host |
| `group-scheduling` "Host's choice books one group event" | The host chooses in the linked conversation | The organizer can also choose in the room by the fixed command (D7) |
| [`calendar-booking`](../../specs/calendar-booking/spec.md) "Attributable approval of the current proposal" | Approval comes from the host's own channel, `/app` or their agent | Adds a room message whose relay-reported sender is the organizer (D7) |
| [`kakaotalk-group-conversations`](../kakaotalk-group-conversations/proposal.md) D2 and design 8 | A group session has no tools, and the instructions say it never books | A call gets `start_group_meeting`, and an attached meeting adds three more tools (D8). Booking stays outside the model |
| [`kakaotalk-group-conversations`](../kakaotalk-group-conversations/proposal.md) D3 | Only a message that names the account runs anything | The confirmation, `stop`, `그만` and `/kickout` are handled whether or not they call the account (D8) |
| [`kakaotalk-group-conversations`](../kakaotalk-group-conversations/design.md) design 4 and Q3 | A reply goes only to a titled group whose title no other room's name contains | Meeting posts and the leave reach other groups through the room check (D12) |
| [`host-kakaotalk-mac-relay`](../host-kakaotalk-mac-relay/design.md) design 2 | The sender's user ID is checked but not stored | A host's user ID is stored as a hash on their KakaoTalk binding (D2) |
| [`host-kakaotalk-mac-relay`](../host-kakaotalk-mac-relay/design.md) design 7 | The service decides when to leave a group | `/kickout` from any member of any group (D10) |
| PRD FR-26, FR-37, FR-40, AC-17, AC-33 | Group conversations cannot retrieve host-only details or act as the host | A room still gets no host-only details. It can now receive a meeting's options and confirmation, and the organizer's own user ID can confirm in it |

## Rejected alternatives

| Alternative | Why it was rejected |
|---|---|
| **A poll page, participant records and option search of this change's own.** | The earlier drafts had them. `group-scheduling` already builds the same link, sign-in and search, on the same `/g/<token>` path. Two would split one product in two (D1) |
| **Members answer in the room with numbers, or tick times by hand.** | `group-scheduling` D4 has participants confirm only their unavailable times, and requires Calendar. Answers in the room would be a second, weaker way to give availability (D4) |
| **Remembered member grants across groups, and private notes in a 1:1 chat.** | `group-scheduling` keeps grants request-bound, and the grid collects what a calendar does not show, privately on the page |
| **Only a linked host can start; others get a sign-up reply.** | The previous version's rule. The user chose on 2026-11-26 that anyone can call the account, so the organizer's whole job is to invite it and call it (D3, D14) |
| **Tie the caller's Google sign-in to their user ID with a number posted in the room.** | The previous version. It worked, but the caller had a step no member has, against the when2meet bar. The organizer's user ID is enough for the room commands, and the service's calendar removes the need for the caller's calendar to book (D14) |
| **An organizer link that the bot posts in the room, naming the caller.** | Whoever opens it first would hold the meeting and its attendees' emails |
| **Keep `group-scheduling`'s full participant flow in rooms.** | Its one question, review and messenger step are three more screens than when2meet. The grid does the review in one tap |
| **Book automatically when the options are in.** | The user chose to keep the organizer's "n번으로 확정" (D7) |
| **An `FMAT-G` code to attach a room.** | The organizer had to leave the group to fetch it. The Mac relay's user IDs identify a linked host directly (D2, D3) |
| **Any member can confirm, or the organizer is recognized by profile name.** | A member could book an event in the organizer's calendar, and anyone can copy a profile name (D2, D7) |
| **Let the model book when the organizer asks.** | A call's input holds other members' messages, which can carry instructions. Confirmation is a fixed command handled before the model (D7, D8) |
| **Show the room who cannot make each option.** | It tells the room something about a member's calendar. The organizer still sees it in their own notice (D5) |
| **`stop` cancels the meeting.** | Participants who are done would lose the meeting because one member objected to the bot. Detaching the room stops the bot there, and the organizer decides about the meeting (D9) |
| **Start 1:1 chats with members (선톡).** | Messages to people who never wrote to the account carry the highest risk of suspension (D13) |
| **Post in or leave a group found by its chat-list name alone.** | Two rooms can share a name, and leaving the wrong room cannot be undone (D12) |
| **Leave a group on its own after booking.** | The user chose that the account stays until `/kickout` |
| **Answer groups through the Android phone.** | It gives no user IDs, so it cannot tell the organizer from anyone else (D11) |

## Capabilities

### New Capabilities

- `group-chat-scheduling`: recognizing a linked host in a KakaoTalk group, starting a `group-scheduling` meeting from the room, what the room may and may not see, the options and the organizer's confirmation in the room, `stop`, `/kickout` and the room check.

### Modified Capabilities

None are written yet. `group-scheduling` is not archived, so its requirements are not in the main specs. The conflicts table lists the requirements a later version would change: `group-scheduling` (creation point, options and choice in the room), `calendar-booking` (the room confirmation), `kakaotalk-group-conversations` (tools and commands before the model), `host-kakaotalk-mac-relay` (host user ID hashes, `/kickout` and the room check) and the PRD functional requirements. These deltas are task 1.4, after `group-scheduling` is archived.

## Impact

This is an estimate for discussion. Nothing is built.

- **Depends on:** `group-scheduling` (PR #504) merged, and the KakaoTalk changes of #501 released with the Mac relay active.
- **New code:** the host user ID hash on KakaoTalk bindings, the room binding of a group meeting, the commands before the group conversation and its four tools, and the room's fixed messages.
- **Changed code:** `group-scheduling`'s creation, close notice and host choice, to accept a room and post to it; the Mac relay (`/kickout` and the room check); the group conversation's tools and instructions.
- **Schema:** a `kakaotalk_group_meetings` table (or a nullable column on `group_meetings`) that ties a meeting to a `kakaotalk_groups` row, and a host user ID hash on the KakaoTalk binding, generated through pg-delta, with RLS that denies all client roles.
- **Documents:** the PRD, the decision log, `documentations/user_experience/07_group_meeting_flow.md`, the privacy policy, and their Korean mirrors.

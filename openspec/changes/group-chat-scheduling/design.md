# Design

This design is a draft. The user accepted it in scope on 2026-11-26 and asked the same day for the simplest flow. It is re-scoped onto `group-scheduling` (PR #504), and no teammate has reviewed it yet. The [proposal](proposal.md#answers-from-the-user-2026-11-26) lists the answers.

## Context

`group-scheduling` (PR [#504](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/504), branch `feat/group-scheduling`) adds group meetings:

- A `group_meetings` row holds the host, the terms (purpose, length, date range, number of people), a shared link token and a state (`collecting`, `closed`, `booking`, `booked`, `cancelled`).
- Opening `/g/<token>` gives each person their own participant request in the group, which reuses the booking link, request-bound Google grants and guest thread.
- A participant connects Google with Calendar (required), answers one question about commitments their calendar does not show and where they usually are, confirms the times they cannot meet, and is done. Nobody picks a time.
- The group closes when the set number are done, or when the host closes it in words. The host then gets up to three time-and-place or online options in their linked messenger, with the names of who cannot make each when none fits everyone.
- The host names an option, the host's calendars are rechecked, and one event is booked with every done participant as an attendee.

Its D7 lets a host create a group meeting only in their linked messenger, and its D1 leaves KakaoTalk rooms for later.

The KakaoTalk for Mac relay (`host-kakaotalk-mac-relay`) reads KakaoTalk for Mac's database on an always-on Mac mini. For every message it reports the room's `chatId` and the author's user ID (`senderUserId`). For a group it also reports the member IDs and the active member count. It sends through `kakaocli` by chat-list name, with a check before and after each send, and it can leave a group (`leave_room`). A 1:1 room with a friend carries that friend's user ID as `directChatMemberUserId`.

`kakaotalk-group-conversations` gives every group a `kakaotalk_group` principal and one `group_chat` conversation owned by no host. A message that names the account (`KAKAOTALK_GROUP_NAMES`, by default `타임래빗` and `TimeRabbit`) calls it, with up to 30 earlier messages as context. The session has no tools, and replies reach only titled groups that the name rule can address.

## Goals / Non-Goals

**Goals**

- Anyone in a KakaoTalk group, with or without an account, starts a `group-scheduling` meeting with one message and confirms an option with another. The organizer's whole job is to invite the account, call it and confirm.
- Members get the link where they already talk, and see the options and the result there.
- The room learns nothing private about the organizer or any participant.
- Only the organizer can book.

**Non-Goals**

- A second poll page, participant table, search or booking: `group-scheduling` owns them. This change only shortens the participant flow for room meetings (§4).
- Answers in the room, remembered grants across groups and private notes, which the earlier drafts had.
- Open chats (오픈채팅): nothing in this change applies to them (§10). Telegram, iMessage and WhatsApp groups.
- The group conversation itself: its context, limits, cost and retention. `kakaotalk-group-conversations` owns them.

## Decisions

### 1. A layer on group-scheduling

Everything about the meeting is `group-scheduling`'s: its row, its link, its participant requests, its close, its option search, its notice to the host, and its booking. This change adds, and stores:

- A **room binding** that ties one `group_meetings` row to one `kakaotalk_groups` row, with the times it started and ended.
- An **organizer ID** on the meeting: a keyed hash of the caller's KakaoTalk user ID (§2).
- **Painted answers**, as participant requests of the meeting with no grant and no email (§4).
- The room's **last known member count** on its `kakaotalk_groups` row (§2).
- A **host user ID hash** on a linked host's KakaoTalk binding (§2).

It also adds what the room needs around these: the start, the posts and the commands.

A meeting has at most one room, and a room has at most one meeting that is not booked, cancelled or expired, whether its binding is live or detached. The binding is detached when someone stops the bot (§8) or the account leaves (§9), and ends when the meeting is booked, cancelled or expired. A detached meeting stays open on its link. For a linked host it goes on in their chat exactly as `group-scheduling` describes, and either organizer can re-attach the room by calling the account there.

### 2. Recognizing the organizer

A host binds KakaoTalk by sending their link code in a 1:1 chat with the account (`host-kakaotalk-channel`). On the Mac relay, that room's `directChatMemberUserId`, which is also the `senderUserId` of every message the host writes there, is the host's KakaoTalk user ID. The service stores a keyed hash of it on the host's KakaoTalk binding, in a `kakaotalk-user:` namespace. It does so when the code arrives through the Mac relay, or with the host's next 1:1 message through it. A host bound while the phone was active is recognized after they write once in their 1:1 chat while the Mac relay is active. The hash is deleted with the binding.

A group message's sender is a linked host exactly when the hash of its `senderUserId` matches a binding. A profile name never counts: two members can show the same name, and anyone can rename themselves.

Whoever calls, the meeting keeps a keyed hash of the caller's user ID as its **organizer ID**. It is the only thing that can fill missing terms, close early, cancel, re-attach or confirm in the room. No other member's user ID is stored by this change.

**The room's member count.** The Mac relay's membership event (`room_members`, with `activeMembersCount`) is off unless `FMAT_RELAY_GROUP_EVENTS=1`, fires only when a group's member list changes, and is stored nowhere today (`host-kakaotalk-mac-relay` design 4). This change asks for three things: the Mac relay adds `activeMembersCount` to each `group_message` event, as it already reads `NTChatRoom` for the room; the service keeps the latest count on the room's `kakaotalk_groups` row, from either event; and the membership event is turned on for the active Mac relay. When no count is known for a room, the number of people has no default and is asked for like a missing term (§3).

### 3. Starting from the room

A member calls the account and asks for a meeting:

> 타임래빗, 다음 주 금요일 저녁 2시간 잡아줘

The call reaches the group conversation, whose model has the `start_group_meeting(purpose?, length?, dateRange?, number?)` tool in every group (§7). The tool acts for the sender of the current message, taken from the relay event.

**The calling message must ask.** A call's context holds up to 30 earlier messages, and any of them can say "타임래빗한테 잡으라고 해". So before anything is created, the service reads the terms again from the calling message's text alone, with a separate structured extraction that sees no earlier messages and no room context. It goes on only when that extraction finds a request for a meeting and its terms agree with the tool's arguments. Otherwise the tool returns a refusal and the bot posts nothing about a meeting.

The service, not the model, then decides:

- **The sender is a linked, set-up host** and the room has no meeting. A `group-scheduling` meeting is created for that host with the given terms, exactly as their linked messenger would create it, and the room is bound to it. The bot posts the introduction (§8). The organizer is also told in their linked conversation that the meeting was created from the room, with the same link, so `group-scheduling`'s chat tools work there as usual. This one message at creation is an exception to `group-scheduling`'s rule that the host hears nothing before the close (proposal conflicts table).
- **The sender has no account, or their setup is unfinished** (user, 2026-11-26: "연동 안된 사람도 부를 수 있게 해줘"). A meeting is created at once, with the caller's user ID as organizer and the defaults of §3a, and the room is bound to it. The bot posts the introduction. The caller does nothing more than any member: open the link and answer, then confirm in the room.
- **The sender already organizes three live meetings.** Nothing is created, and the bot says so in one fixed line. This bounds what one person can open across groups.
- **The room already has a meeting** that is not booked, cancelled or expired, or a pending start. Nothing new is created. When the meeting is bound, the bot reposts its link and names its organizer. When it is detached, the bot says in one fixed line that a meeting is already open in this room; when the caller is its organizer, the call re-attaches it instead (§8).
- **The phone is the active relay, or the room is an open chat.** Nothing is created (§10).

In each case the model's own reply text for that call is dropped, and only the fixed message is posted. The earlier version refused callers with no account and posted a sign-up link; the user dropped that on 2026-11-26.

`group-scheduling` needs a purpose, a length, a date range and a number of people, and leaves mode and place open. Here:

- **Purpose** defaults to the room's title, or to "모임" for a room with no title.
- **Number of people** defaults to the room's last known member count (§2) less the account and, for a linked host, the organizer. An organizer with no account answers on the link like anyone else (§3a), so they count as one of the people. The organizer can give another number in the message ("5명이서"). With no known count, there is no default.
- **Length and date range** have no default.

**A pending start.** When the message leaves out the length, the date range, or a number with no default, nothing is created. The service keeps a **pending start** for the room: the caller's user ID hash, the terms given so far and the time. The tool returns what is missing, and the bot asks for it once in the room with a fixed line. Only the same caller's next call in the room fills it, and the meeting is created when every term is there. A pending start lapses after one hour. While it exists, another member's start in the room is refused, as for a room with a meeting. It holds no message text.

The terms cannot change after the link is sent, as `group-scheduling` requires.

### 3a. An organizer with no account

A `group-scheduling` meeting needs a host: conflict calendars, meeting hours, places and a booking destination. A caller with no account has none of these. The user's bar is that everyone, the caller included, is done in one or two taps, as on when2meet ("when2meet처럼 쓰기 엄청쉬워야햐", user, 2026-11-26). So the caller is asked for nothing beyond what any member does.

- **Identity.** The organizer is the caller's KakaoTalk user ID, kept as a hash on the meeting (§2). It is all the room commands need: filling missing terms, closing early and "n번으로 확정" are checked against it. No sign-in is tied to it.
- **The caller's own times.** The caller opens the link and answers like any member (§4), and is counted as one of the participants.
- **What stands in for a host's settings.** Meeting hours are 09:00 to 22:00 in the meeting's timezone, every day of the range. There are no host places, so `group-scheduling`'s place tiers start with the participants' known places, and online options fill in.
- **The event.** It is created in the product's own scheduling calendar, a Google account the service holds for this purpose, with every done participant who signed in with Google as an attendee, so Google sends the invitations, and with guests unable to see each other. Nobody is invited who did not sign in on the link themselves. The cases:
  - **The organizer signed in with Google:** they are an attendee like the others.
  - **The organizer painted, or never opened the link:** they have no email on the meeting, so they get the room's confirmation and its calendar file, not an invitation. When they never opened it, the search ran without their times, and they confirm knowing the counts.
  - **Painted members:** the same as a painted organizer.
  - **No done participant signed in with Google:** no calendar event is created. The room's confirmation and its calendar file are the record.
- **Expiry.** A meeting with no account that is neither booked nor cancelled expires when its date range has passed (§8).
- **Only in the room.** An organizer with no account has no linked conversation, so the options and the confirmation happen in the room, and so do requests for more options and an early close.

No host account, `/app` workspace, settings, admission check or write grant is involved. A caller who is a linked, set-up host is handled as in §3 instead, with their own settings and booking destination. The defaults and the service calendar are proposal Q3.

### 4. Participants

The link has to be as easy as when2meet (user, 2026-11-26): open it from the room and be done in one or two taps, with no account, profile, handle or onboarding, and no question before availability is in. For meetings started from a room, the participant flow on `group-scheduling`'s link is therefore shortened:

1. **Google.** One tap on **구글로 계속하기**. One consent screen gives identity and read-only Calendar access. Name and email come from the Google account.
2. **Check and send.** The page shows the date range as a grid, with the member's busy times already filled in, no titles, and the meeting's done count ("6명 중 4명 완료"). One tap on **이대로 보내기** makes them done. Before that tap they may paint extra times they cannot make, such as a class missing from the calendar. The painted grid is what `group-scheduling` stores as their confirmed unavailable times.

`group-scheduling`'s one question (fixed commitments, usual place, travel mode) and messenger step are left out of this flow. The grid covers commitments, and place comes from the places of a member's events, where there are any. A member with no known place is checked for travel only between their known events.

**Painting by hand.** Below the Google button, a second choice, **구글 없이 직접 칠하기**, opens the same grid empty. The member types a name and paints the times they can meet, as on when2meet. There is no sign-in. One tap on **보내기** makes them done. Unpainted times count as times they cannot meet.

- **Where it lives.** A painted answer is a participant request of the meeting, like any other, with no Google grant and no email. It holds the typed name, a hash of a device-bound edit token, and the unpainted times as confirmed unavailable intervals, so the option search reads it exactly as it reads a signed-in answer (`group-scheduling` D11 stores unavailable intervals).
- **One per device.** The edit token is set in a cookie on the first send. A device that already holds a token for the meeting changes its earlier answer instead of adding one. Only that device can change it.
- **It does not close the meeting.** A painted answer counts in the done count and in the options, but not toward the number that closes the meeting on its own. So answers with no sign-in cannot fill and close a meeting. When the done count reaches the number with painted answers among them, the room gets one fixed line ("모두 답했어요. {organizer}님이 '타임래빗 마감'을 보내면 후보를 올릴게요"), and the organizer closes it (§6).
- **No invitation.** A painted member gets no Google invitation, only the room's confirmation and its calendar file.

**Opening the link again.** The link keeps working. A member who comes back sees their own grid and the done count, and can change their stored answer until the meeting closes. A signed-in member's calendar is not read again (`group-scheduling` D11); the change edits only their stored intervals. After the close the page shows the options, and after booking the confirmation with its calendar file. The page never shows who else is done or what anyone answered.

**Done count in the room.** When members finish, the room gets one short line, at most once every 30 minutes: "4/6명 완료했어요. 아직이면 링크에서 해 주세요: {link}". It never names anyone.

A linked host in the room who would rather not open the page can send the link in their own messenger, as `group-scheduling`'s "A host joins another host's group from their own chat" already allows.

### 5. What the room sees

Every post to the room, and the group conversation's context, is built from the **room projection**. It holds only:

- The organizer's display name.
- The meeting's purpose, length and date range.
- The shared link.
- The number of done participants against the set number.
- The numbered options, each with its time, its place or "online", and, when at least three participants are done, how many of them can make it. Below three, a count such as "2명 중 1명 가능" would tell the room who cannot come, so the options show no counts.
- The confirmation: the time, the place or Meet link, and a calendar file link.

It never holds:

- Who is done, or who has opened the link.
- Who cannot make an option. The organizer's notice from `group-scheduling` names them, and the room does not.
- Any participant's events, confirmed unavailable times, usual place or travel mode.
- The organizer's rules, hours, notes, exceptions or other requests.
- Any email, booking link or account-specific `/app` link.

### 6. Options and confirmation

**Options.** When the meeting closes, because it is full or the organizer closed it, `group-scheduling` sends the organizer its notice. `group-scheduling` numbers the options in that notice, and the room gets the same options with the same numbers, as one fixed message. For an organizer with no account there is no notice, and the service numbers the options the same way for the room alone:

> {purpose} 후보예요. 1) 12월 5일(금) 19:00 신촌역 — 5명 중 5명 가능 2) … {organizer}님이 번호로 확정하면 초대장이 가요.

When the organizer asks for more options, in their chat or by calling the account, the new options go to both places and continue the numbering. A meeting that closes while detached posts its options to the room when the organizer re-attaches it.

**Closing early** is a fixed command, not a tool: the organizer sends `타임래빗 마감`. It is handled before the model (§7), and closes the meeting, as `group-scheduling`'s "Host closes the group early" does, only when the message's `senderUserId` hashes to the meeting's organizer ID. A call that only asks in words ("지금 있는 사람들로 정하자") gets a fixed line naming the command. A fixed command keeps an instruction planted in earlier room messages from closing a meeting through the model.

**Confirmation.** The organizer books in one of two ways:

- **In the room**, with a fixed command: `2번으로 확정` or `2번 확정`, with or without the account's name. The service handles it before the model (§7). It books only when the message's `senderUserId` hashes to the meeting's organizer ID and the meeting is closed with that option offered. From anyone else it is not a command, and it passes on as an ordinary message.
- **In their own chat**, for a linked host, by naming the option, as `group-scheduling` already allows.

Either way, booking is `group-scheduling`'s "Host's choice books one group event", except that an organizer with no account books into the service's scheduling calendar (§3a). A linked host's calendars are rechecked, and one event is booked with every done participant who signed in with Google as an attendee, so Google sends the invitations. Painted answers have no email and are not invited. When the recheck fails, nothing is booked, and the room is told that the option is no longer open, with no reason. A second confirmation books nothing more. The room gets one fixed confirmation, and the binding ends.

**The trust trade-off.** A confirmation in the room is believed because the relay reports its sender's user ID. A 1:1 approval is believed because the relay reports its room ID, and the room is bound to the host. Both rest on the relay secrets, and someone who held them could forge either. "Only from the Mac relay" is not a separate trust boundary: the Android and Mac relays sign with the same two secrets (`host-kakaotalk-mac-relay` design 1), and `"relay": "mac"` is a field inside the signed body, so a holder of the secrets can claim to be either. The Mac relay matters here only because it is the one that reports user IDs. A copy of the command from another user ID books nothing. The team has not yet agreed to this (proposal Q1).

### 7. The group conversation

**Commands before the model.** The service checks every group message from the Mac relay before the call rule runs, whether or not the message names the account:

| Message, after the account's name is taken off | When | What happens |
|---|---|---|
| `<n>번으로 확정` or `<n>번 확정` | The sender is the organizer of the room's closed meeting | Booking starts (§6) |
| `마감`, with the account's name | The sender is the organizer of the room's collecting meeting | The meeting closes (§6) |
| `취소`, with the account's name | The sender is the organizer of the room's meeting | The meeting is cancelled (§8) |
| `stop` or `그만`, with the account's name and nothing else | The room has a live binding | The room is detached (§8) |
| `/kickout`, as the whole message | Always | The account leaves (§9) |

A handled message is not passed on as a call. A bare `stop` or `그만` without the account's name is an ordinary message: it is a common word in a chat, and treating it as a command would let any stray "그만" detach the bot. From anyone but the organizer, `마감`, `취소` and the confirmation are ordinary calls.

**Tools.** A call gets `start_group_meeting` in every group (§3). While the room has a live binding, it also gets:

- `group_meeting_status`: the room projection of §5.
- `group_meeting_link`: the shared link.

Every tool takes its sender from the relay event and has no sender argument. The conversation has no tool that closes, books, cancels, or reads anyone's calendar, answers, rules or other requests. Only the start goes through the model, and the service checks it against the calling message alone (§3).

**What the model sees.** Only the room projection and the group's messages. It cannot repeat what it never had, however it is asked.

**Fixed messages stay fixed.** The introduction, the done-count line, the options, the confirmation and the goodbye are templates. Only replies to calls come from the model. The group instructions gain a short section on the tools.

### 8. Consent and stop

The introduction is fixed text, with the organizer's display name, the terms and the link filled in:

> 안녕하세요, 타임래빗(Find Me a Time)이에요. {organizer}님이 {range}에 {length} '{purpose}' 시간을 정해 달라고 하셨어요. 아래 링크를 열고 구글로 계속하기만 누르면 끝이에요. 캘린더에서 바쁜 시간만 읽어요. 구글이 없으면 같은 링크에서 직접 칠해도 돼요: {link} 모두 되는 시간을 찾아 이 방에 올릴게요. 일정 내용은 방에 공유하지 않아요. 누구든 '타임래빗 그만'을 보내면 이 방에서는 더 말하지 않아요. 개인정보 안내: findmeatime.com/privacy

It says nothing about what the account reads in a group in general. `kakaotalk-group-conversations` states that, and this introduction must not contradict it.

- Nothing is collected about a member until they open the link. On the link, `group-scheduling`'s own consent and storage rules apply, with the shorter flow of §4. A painted answer stores only the typed name and the painted times, and is deleted with the meeting's other answers.
- `타임래빗 stop` or `타임래빗 그만` from anyone detaches the room. The bot posts nothing more about the meeting in the room, and the tools of §7 other than `start_group_meeting` leave the conversation. **It never cancels the meeting.** The meeting stays open on its link, so a member's dislike of the bot does not cancel it for participants who are done, and nobody can clear the room for a new meeting of their own by stopping someone else's. For a linked host, the organizer is told in their linked conversation, and the meeting goes on there. Any organizer can re-attach the room by calling the account in it; the bot then posts the link again, or the options if the meeting closed meanwhile.
- **Only the organizer cancels**, with `타임래빗 취소` in the room, or, for a linked host, in their linked conversation as `group-scheduling` allows. A detached meeting of an organizer with no account that is never re-attached expires when its date range has passed, and is then cancelled through `group-scheduling`'s cancel. Until it is booked, cancelled or expired, no one can start another meeting in that room (§3).
- The account never starts a 1:1 chat with a member.
- The room binding is deleted 30 days after it ends. It holds only the two row IDs and the times it started and ended.

### 9. Leaving the room

Any member may type `/kickout` in a group. An exact `/kickout` is handled before the model, in any group. The account then leaves:

1. If the room has a live binding, it is detached as for `stop`, and the organizer is told. The meeting stays open on its link.
2. The bot posts a fixed goodbye: "타임래빗이 이 방에서 나갈게요. 다시 부르려면 초대한 뒤 이름을 불러 주세요."
3. The service queues a `leave_room` row for the room, and the Mac relay carries it out.

The goodbye and the leave go through the room check of §10. The account never leaves on its own, booked or not. When the leave fails or its retries run out, the organizer, if there is one, is told, and a later `/kickout` tries again.

### 10. The Mac relay

Group meetings start from a room only while `KAKAOTALK_ACTIVE_RELAY` is `mac`. While the phone is active, nothing starts, and posts to bound rooms wait.

This change asks five things of the Mac relay beyond its own change and the group conversation change:

- A keyed hash of the host's user ID on their binding (§2).
- The room's `activeMembersCount` on each `group_message` event, and the membership event turned on (§2).
- Whether the room is an open chat (`linkId` not 0) on each `group_message` event. The Mac relay treats open chats as groups (`host-kakaotalk-mac-relay` design 2), and nothing in this change applies to them: no start, no command, no post and no leave.
- `/kickout` from any group (§9).
- Posting in, and leaving, a group that the name rule cannot address.

**Confirming the room.** `kakaocli` opens a chat by the name the chat list shows. A titled group whose name no other room contains is addressed as the Mac change already does. Any other group either has no name of its own, so its chat-list label lists its members, or has a name another room contains. For such a group the helper:

1. Reads the room's newest messages from the database and computes its chat-list label.
2. Opens each chat-list row with that label, one at a time, after closing other chat windows.
3. Reads the newest messages in the opened window. It goes on only in the window that shows the message being answered, such as the call, the confirmation or the `/kickout`, with the same sender name and text. A post that answers no message, such as the options when the last participant finishes, needs the window to show the room's three newest messages from the database, in order.
4. Types the post, or runs the leave, in that window only.

When no window matches, or more than one does, nothing is sent or left, and the outcome is `failed`. The Mac change's landing check still runs after every send, and its leave check still requires that this room, and no other, disappears from the database.

## Risks / Trade-offs

- **Confirmation in the room.** A booking follows a group message, believed because of the relay's sender ID. Mitigation: only the organizer's hashed user ID confirms, the command is fixed and runs before the model, `group-scheduling` rechecks the organizer's calendars, and a forged ID needs the same relay secret a forged 1:1 approval would (proposal Q1).
- **A model in the room.** The model reads calls and their context and can be asked anything, and earlier messages can carry instructions. Mitigation: its context holds only the room projection, it has no tool that closes, books, cancels or reads private data, those are fixed commands run before it, the start is checked against the calling message alone, and tools act only for the sender.
- **Counts reveal a little.** "5명 중 4명 가능" tells the room that someone cannot make a time. Mitigation: no names and no reasons, no counts below three done participants, and the organizer alone sees who.
- **Two places for one decision.** The organizer can confirm in the room or in their chat. Mitigation: one booking per meeting, and a second confirmation books nothing.
- **Organizers without an account.** Anyone in a group can open a meeting. Mitigation: only the caller's user ID confirms, closes or cancels, each caller has at most three live meetings, the group conversation's own limits apply, and the service calendar invites only people who signed in on the link themselves.
- **A service-owned event.** For an organizer with no account, the invitation comes from the product's calendar, not from someone the members know, and the event lives in a calendar the service holds. Every attendee's email would be visible to every other attendee, so the event is created with guests unable to see each other (`guestsCanSeeOtherGuests: false`). Mitigation: the invitation names the organizer and the room, and the service deletes nothing from it after booking. Proposal Q3 asks the team to accept it.
- **Painted answers have no sign-in.** Anyone with the link can add a painted name, and a fake answer can sway the counts. Mitigation: painted answers never close a meeting on their own, one device holds one answer, the link is posted only in the room, the organizer closes and books, a linked host's notice lists names, and the room's counts are always "of the done". Clearing cookies or using several devices still adds answers; the organizer sees the done count against the room's size.
- **A shorter flow than `group-scheduling`'s.** Leaving out its one question means no usual place or travel mode for room meetings, so travel is checked only between known events. The user's when2meet bar outweighs it.
- **Posting and leaving through the screen.** Leaving cannot be undone, and an untitled group is found by its members' names. Mitigation: the room check acts only in the window that shows the message being answered, and the Mac change checks the database after every send and leave.
- **One Mac for every group.** A locked, asleep or signed-out Mac delays every post. Mitigation: posts wait in the outbox, and the Mac change's heartbeat reports a locked Mac.
- **Depending on an unmerged change.** If `group-scheduling` changes its terms, its close or its choice, this layer follows. Mitigation: this change reuses its records and adds only the records of §1, so it has little to redo.
- **Everything the KakaoTalk change risks.** The terms-of-service risk, the single relay Mac and app updates all apply, and a suspended account fails every room at once.

## Open Questions

- Proposal Q1, Q2 and Q3.
- Should a room whose only members are the organizer and the account be refused?
- Can a member's 1:1 chat with the account start before they add it as a friend, or do they need the friend-add link first?

# Design

This design is a draft. The user accepted it in scope on 2026-11-26 and asked the same day for the simplest flow; no teammate has reviewed it yet. The [proposal](proposal.md#answers-from-the-user-2026-11-26) lists the answers.

## Context

The KakaoTalk for Mac relay (`host-kakaotalk-mac-relay`) reads KakaoTalk for Mac's own database on an always-on Mac mini. For every message it knows the room's `chatId`, the author's user ID (`senderUserId`, from `NTChatMessage.authorId`) and, for a group, the member IDs. It sends through `kakaocli` by chat-list name, with a check before and after each send, and it can leave a group (`leave_room`). A 1:1 room with a friend carries that friend's user ID as `directChatMemberUserId`, so a host's bound 1:1 room tells the service the host's KakaoTalk user ID.

The `kakaotalk-group-conversations` change gives every group a `kakaotalk_group` principal and one `group_chat` conversation owned by no host. A message that names the account (`KAKAOTALK_GROUP_NAMES`, by default `타임래빗` and `TimeRabbit`) calls it. The call goes to the model with up to 30 earlier messages as context, and the reply goes back to the group. Messages that do not call it are kept for 24 hours as context only. The session has no tools, and replies reach only titled groups that the name rule can address.

Requests today have one host and one requester (`meeting-requests`). Bookings make the requester the only attendee (`calendar-booking`). The host's private context stays host-only (`meeting-requests` "Audience-specific projections"). A requester's Google Calendar grant is read-only and bound to its request (`requester-calendar-access`).

The user asked on 2026-11-26 for a flow that is as simple as possible: everyone opens one link and signs in with Google, and the calendars are collected on their own.

## Goals / Non-Goals

**Goals**

- A linked host can start group scheduling in a KakaoTalk group with one message, and confirm with another.
- A member's whole part is one link and one Google sign-in, with ticking by hand as the fallback.
- No one in the group learns anything private about the organizer or another member.
- Only the organizer can book.

**Non-Goals**

- Several hosts' calendars pooled together, round-robin, or team coordination inside a workspace.
- Recurring group meetings.
- Open chats (오픈채팅), iMessage groups and WhatsApp groups. Telegram groups come later, in a change of their own.
- The group conversation itself: its context, limits, cost and retention. `kakaotalk-group-conversations` owns them.

## Decisions

### 1. Organizer

The host of a group request is the **organizer**: the linked, set-up host whose call started it (§2). The organizer's conflict calendars, working hours, buffers, places and booking destination are used, exactly as for a request where they are the host. There is one organizer per group request. A second linked host in the room is a member like anyone else, and their calendar counts only if they sign in on the poll page (§4).

**Knowing a host's KakaoTalk user ID.** A host binds KakaoTalk by sending their link code in a 1:1 chat with the account (`host-kakaotalk-channel`). On the Mac relay, that 1:1 room's `directChatMemberUserId`, which is also the `senderUserId` of every message the host writes there, is the host's KakaoTalk user ID. The service stores a keyed hash of it on the host's KakaoTalk binding, in a `kakaotalk-user:` namespace, when the code arrives through the Mac relay or with the host's next 1:1 message through it. A host bound while the phone was active is recognized after they write once in their 1:1 chat while the Mac relay is active. The hash is deleted with the binding.

A group message's sender is then a linked host exactly when the hash of its `senderUserId` matches a binding. A profile name never counts: two members can show the same name, and anyone can rename themselves.

### 2. Starting a group request

A member calls the account in the group and asks for a meeting, for example:

> 타임래빗, 이번 주 금요일 저녁 2시간 잡아줘

The call reaches the group conversation, whose model has the `start_group_request(length, dateRange, mode, expectedMembers?)` tool in every group (§5). The tool's organizer is the sender of the current message, taken from the relay event. The model fills only what the message says. When the message leaves something out, the organizer's defaults apply: their usual meeting length, the next seven days, and their default mode. The introduction states what was used.

The service then decides, not the model:

- **The sender is a linked, set-up host** (§1), and the room has no open group request. A group request opens with that host as organizer, bound to the room, and the bot posts the introduction (§6). The organizer is told in their 1:1 chat as well, with a link to the request in `/app`.
- **The sender is not a linked host, or their setup is unfinished.** Nothing opens. The bot posts one fixed reply, at most once per sender per day: "일정을 잡으려면 먼저 findmeatime.com 에서 가입하고 카카오톡을 연결해 주세요. 연결한 뒤 다시 불러 주세요." The link is the public sign-up page, not one bound to anyone.
- **The room already has an open group request.** Nothing new opens. The bot reposts the poll link and says who organizes the open one.
- **The phone is the active relay.** Nothing opens, and the bot cannot answer in the group. The Mac relay is needed because only it gives user IDs (§12).

In each case the model's own reply text for that call is dropped, and only the fixed message is posted. The model cannot word a refusal that hints at more.

The expected number of members (§4) defaults to the room's member count from the Mac relay's membership event, less the account and the organizer. The organizer can name another number in the same message ("5명").

The organizer can change the length, the date range or the mode by calling the account again ("타임래빗, 3시간으로 바꿔줘"). The tool checks that the sender is the organizer. A change re-runs the candidates, and the next posted times say they changed.

### 3. Authority

Booking a time is the one decision that matters, and only the organizer makes it. The organizer can book in any of these ways:

- **In the group**, with a fixed command: `2번으로 확정`, `2번 확정`, or the same after the account's name. The service handles it before the model (§5). It books only when the message's `senderUserId` hashes to the organizer's binding and the message came through the Mac relay. A confirmation from anyone else is ignored as a command and passes on as an ordinary message.
- **In the organizer's 1:1 chat**, by number ("2번으로 잡아줘").
- **In `/app`**, with **Book this time**.
- **Through the organizer's connected agent** with `host:decide`.

No other message in the group books, cancels or changes settings, whoever wrote it. The model has no tool that books or cancels. A call's input holds other members' recent messages, which can carry instructions, so letting the model book even on the organizer's call would let any member steer it. A fixed command keeps the decision out of the model.

**The trust trade-off.** A confirmation in the group is believed because the Mac relay reports its sender's user ID. A 1:1 approval is believed because the relay reports its room ID, and the room is bound to the host. Both rest on the same relay secret. Someone who held that secret could forge either one. Confirming in the group therefore adds no new way to forge an approval, but it does move a booking into a room where other people can see the command and copy it. A copy from another user ID books nothing. The team has not yet agreed to this (proposal Q1).

### 4. Gathering availability

**One link, Google sign-in.** The introduction links to the poll page `/g/<token>` and asks every member to open it and sign in with Google. No account is needed. Signing in asks for a read-only calendar grant in the same Google screen, bound to the group request. Once it is granted, the page asks for nothing more. The page shows the member's display name from Google, which they can change, and offers an optional **Send me the invitation**, which uses the Google address as the attendee email. The grant follows `requester-calendar-access`: it reads the calendar list and busy times only, and no event title, place or attendee is stored, logged, shown or given to the model.

**Returning members.** The page recognizes a member by their Google account:

- **An existing host's** conflict calendars, as saved in their setup, count with no calendar step.
- **A member of a past group** who signed in before has a remembered grant, which counts with no new consent screen.

Nothing in the group says who has signed in, or who has used the product before. The page names the calendars that count, and offers **Don't use my calendar** for this group and **Forget me**, which deletes the remembered grant. A remembered grant is deleted 180 days after the member's last group request closes. A remembered member is not a host and gets no `/app` workspace.

**Finding candidates.** The service runs the organizer's feasibility over the date range. It treats every signed-in member's busy times as busy for the meeting. When that would leave no time, it keeps the times that the most signed-in members can attend instead, so that one very busy member does not empty the list. Up to five candidates are picked, spread across the range, as in "Offered times spread across the range". For an in-person meeting, each candidate is paired with one of the organizer's confirmed places, as in "Time and place pairs".

**Posting the times.** The numbered times go to the group as soon as the expected number of members have signed in or ticked times on the page. They also go out when anyone calls the account and asks for them, or 24 hours after the request opened, whichever comes first. Numbers in the chat cannot count toward this, because they only make sense once the times are posted. The Mac relay posts the times when they are ready, not after the next group message (§12). Until then the poll page shows the times as they stand, and they change as members sign in.

**Fallback answers.** A member who does not sign in, or presses **Don't use my calendar**, answers in one of two ways:

- **Ticking** the times that work on the same page. The page sets a device-bound edit token, so the member can change or delete their answer later.
- **Numbers in the group**, after the times are posted: "1 3", "1번 3번", "1,3" or "없음". These are handled before the model (§5). Words such as "목요일 저녁만 돼요" count too, when they call the account, through `record_group_answer`.

A group answer is keyed by the sender's user ID hash and shown under their profile name. A later answer from the same user ID replaces the earlier one, and a copied name cannot replace someone else's answer. All answers count the same, with no "unverified" label. A group answer and a page answer are not merged, because nothing ties a KakaoTalk user to a Google account (§9). A member who both signs in and sends numbers is counted twice; the organizer's ranking lists names, so the organizer can see it.

**After the times are posted.** A newly signed-in member, or a new busy event for the organizer, can make a posted candidate infeasible. That candidate is struck through for everyone, with no reason and no name. The other candidates keep their numbers.

### 5. The group conversation

Group scheduling is part of the group conversation of `kakaotalk-group-conversations`.

**Commands before the model.** The service checks every group message from the Mac relay before the call rule runs, whether or not the message names the account. These never depend on what the model decides:

| Message, after the account's name is taken off | When | What happens |
|---|---|---|
| Only numbers, separators and `번`, or `없음` / `none` | The room's times are posted | The sender's answer is recorded (§4), and the bot repeats it: "○○님: 1, 3번으로 적었어요" |
| `<n>번으로 확정` or `<n>번 확정` | The sender is the organizer | Booking starts (§3, §7) |
| `stop` or `그만`, as the whole message | The room has an open request | The request closes as stopped (§6) |
| `/kickout`, as the whole message | Always | The account leaves (§11) |

A handled message is not passed on as a call. It is still kept as context, as any other message is, except a confirmation.

**Scheduling tools.** A call gets `start_group_request` in every group (§2). While the room has an open group request, it also gets:

- `group_poll_status`: the group projection of §8, which holds the candidate times, their places, the counts and the names of members who said a time works.
- `group_poll_link`: the room's poll page link.
- `record_group_answer(times)`: records which candidate times work for the sender of the current message, for an answer in words.

Every tool takes its sender from the relay event and has no sender argument, so the model cannot act for anyone else. A receipt keeps the event ID of each recorded answer, so a replayed event is counted once. The conversation has no tool that books, cancels, reads anyone's calendar, rules or other requests, or says whether a member signed in. It has no tool for private notes (§10).

**What the model sees.** Only the group projection and the group's messages. The organizer's private context, members' calendars, private notes and emails never enter the group conversation's context, so it cannot repeat them however it is asked.

**Fixed messages stay fixed.** The introduction (§6), the sign-up reply (§2), the posted times, the repeated answers, the confirmation (§7) and the goodbye (§11) are templates, not model text. Only replies to calls come from the model, and the group instructions gain a short section on the scheduling tools.

### 6. Consent and privacy

The introduction is fixed text, with only the organizer's display name, the meeting's length and range, and the poll link filled in:

> 안녕하세요, 타임래빗(Find Me a Time)이에요. {organizer}님이 {range}에 {length} 모임 시간을 정해 달라고 하셨어요. 아래 링크에서 구글로 로그인하면 바쁜 시간만 자동으로 모아요: {link} 일정 내용은 보지 않아요. 구글 연결이 어렵다면 같은 링크에서 직접 체크하거나, 시간이 올라온 뒤 되는 번호를 보내 주세요(예: 1 3). 단톡에서 말하기 어려운 사정은 저에게 1:1로 알려 주세요. 단톡에는 전하지 않아요. 누구든 '그만'을 보내면 바로 멈춰요. 개인정보 안내: findmeatime.com/privacy

It says nothing about what the account reads in a group in general. The group conversation change states that, and this introduction must not contradict it.

These rules apply:

- No answer is stored for a member until they give one. An answer stores only the display name, the times, its source, whether a calendar counts and, from the page, an optional email. Busy times are read when needed and not stored. No phone number or profile photo is read. KakaoTalk user IDs are kept only as hashes (§9).
- `stop` from anyone closes the group request as stopped, removes the poll tools from the room's conversation, and tells the organizer in their 1:1 chat. The organizer can start again with a new call.
- The poll page states the same facts and links to the privacy policy. It has **Delete my answer**.
- Members' answers and emails are deleted 30 days after the group request closes. This is shorter than the 90 days for closed requests, because these members have no account and never asked to be recorded.
- The privacy policy gains a section for group members who have no account.

### 7. Confirmation and booking

The organizer sees the current ranking in `/app` and can ask for it in their 1:1 chat. The ranking orders the times by how many members said they work, then by the organizer's own candidate order, and names who answered what. The service also sends it to the organizer once, when the poll settles: when every member who answered has answered all times and no new answer has come in for 24 hours, or when the date range is about to begin.

Booking, from whichever place the organizer confirms (§3), follows `calendar-booking` with these changes:

- The recheck before dispatch reads the organizer's calendars again for the chosen time. A conflict books nothing, and the bot says in the group that the time is no longer open, with no reason. Members' calendars are not rechecked: the organizer chose the time knowing the counts.
- A time that is struck through, or a number that is not on the list, books nothing.
- The event goes into the organizer's booking destination. Its attendees are the members who ticked **Send me the invitation**, and Google sends the invitations. The description holds only the meeting details and any join link.
- A second confirmation for a request that is already booked books nothing more.
- The group receives one confirmation right after booking (§12). It gives the time, the place or join link, and a link to add the event to a calendar (an `.ics` download on the poll page).

The group request then closes, and the poll tools leave the room's conversation. The account stays in the room until a member sends `/kickout` (§11).

An unbooked group request never closes on its own. It stays open until it is booked, the organizer cancels, or someone sends `stop`. When every candidate has passed, the organizer is asked once in their 1:1 chat for a new date range, and the group is told nothing until new times are found.

### 8. What the group never sees

Group messages and the group conversation's context are built from the group projection. These are the only fields it holds:

- The organizer's display name.
- The meeting length, mode and date range.
- The candidate times and their places.
- Per-time counts and the display names of members who said a time works.
- The poll link.
- The confirmation, as described in §7.

No group message, fixed or from the model, contains any of these:

- Event titles, places, attendees or the reason a time is busy, for the organizer or any member.
- The organizer's rules, working hours, notes, exceptions, weekly load, places they did not offer, or other requests.
- Which member's calendar blocks which time, or who said "no time works".
- Members' emails, whether a member signed in, or whether they used the product before.
- Any link code, booking link or account-specific `/app` link. The public sign-up page (§2) is not account-specific.

The ranked list in the organizer's 1:1 chat and `/app` may name who answered what, because the organizer runs the poll. It still carries no member calendar detail.

### 9. Member identity

A member has two identities that are never tied together:

- **On the poll page**, the Google account they signed in with, or the device that ticked. This is what recognizes a returning member (§4).
- **In the group**, their KakaoTalk user ID from the Mac relay, kept as a keyed hash in a `kakaotalk-user:` namespace. It keys their group answers and lets the service find their groups for a private note (§10).

There is no member code, and no question in the group about a past connection. The first draft used both so that a member could be recognized in KakaoTalk. Google sign-in on the page does that by itself, so the extra step was dropped.

**Membership.** While a room has an open group request, the Mac relay's membership events give the room's member user IDs. The service keeps them as hashes for the request's lifetime. They give the default headcount (§2), and they map a 1:1 sender to the open groups they belong to (§10). They are deleted with the request's answers.

**No first messages.** The account never starts a 1:1 chat with a member: no 선톡, and no nudge to a member's chat. The introduction tells the group that anyone can write to the account 1:1. The Mac relay sends into a 1:1 room only after the other person has written in it, and then as often as needed.

### 10. Private notes

A member can tell the account privately what they do not want to say in the group. A note arrives in the member's 1:1 chat. The service matches the hash of the sender's user ID to the open groups whose member list holds it (§9). The model turns the note into structured limits only: unavailable intervals and less-preferred intervals inside the group's date range.

The bot reads the limits back in the 1:1 chat ("목요일 저녁은 빼고, 오전은 가능하면 피할게요. 맞나요?") and applies them only after the member agrees. When the member is in more than one open group, the bot asks which one, by organizer name and date range. The note's text is not stored after the limits are confirmed. The limits are kept with the member's group answer and deleted with it.

The limits count as that member's busy times when candidates are found (§4). A less-preferred interval only moves a time down the order. The group sees only the candidate times that result. Neither the group nor the organizer sees the note, the limits, or that a note exists. A posted candidate that a note removes is struck through like any other, with no reason and no name.

A 1:1 sender who is a linked host goes to their host conversation as usual. A sender who is in no open group and is not a host gets the existing fixed reply for unlinked senders.

### 11. Leaving the room

Any member may type `/kickout` in a group. An exact `/kickout` is handled before the model, in any group, with or without an open request. The account then leaves:

1. If the room has an open group request, the service closes it as stopped, as for `stop`, and tells the organizer in their 1:1 chat.
2. The bot posts a fixed goodbye in the room: "타임래빗이 이 방에서 나갈게요. 다시 부르려면 초대한 뒤 이름을 불러 주세요."
3. The service queues a `leave_room` row for the room, and the Mac relay carries it out.

The goodbye and the leave both go through the room check of §12, which acts only in the window that shows this `/kickout`.

The account never leaves on its own, booked or not. A booked room stays with no open request, and a linked host can start a new one there with another call.

When the Mac relay reports the leave as `failed`, or its retries run out, the group request stays closed and the organizer, if there is one, is told that the account could not leave. A later `/kickout` tries again.

### 12. The Mac relay

Group scheduling runs only while `KAKAOTALK_ACTIVE_RELAY` is `mac`. While the phone is active, posts to rooms with open requests wait, and nothing new starts.

This change asks four things of the Mac relay beyond its own change and the group conversation change:

- A keyed hash of the host's user ID on their binding (§1).
- Membership events, on for rooms with open requests (§9).
- `/kickout` from any group (§11).
- Posting in, and leaving, a group that the name rule cannot address.

**Confirming the room.** `kakaocli` opens a chat by the name the chat list shows. A titled group whose name no other room contains is addressed as the Mac change already does. Any other group either has no name of its own, so its chat-list label lists its members, or has a name another room contains. For such a group the helper:

1. Reads the room's newest messages from the database and computes its chat-list label.
2. Opens each chat-list row with that label, one at a time, after closing other chat windows.
3. Reads the newest messages in the opened window. It goes on only in the window that shows the message being answered, such as the call, the numbers, the confirmation or the `/kickout`, with the same sender name and text. A post that answers no message, such as the times after 24 hours, needs the window to show the room's three newest messages from the database, in order.
4. Types the post, or runs the leave, in that window only.

When no window matches, or more than one does, nothing is sent or left, and the outcome is `failed`. The Mac change's landing check still runs after every send, and its leave check still requires that this room, and no other, disappears from the database. The user reports that reading a chat window's messages through accessibility works (2026-11-26).

## Risks / Trade-offs

- **Confirmation in the group.** A booking now follows a group message, believed because of the relay's sender ID. Mitigation: only the organizer's hashed user ID confirms, the command is fixed and runs before the model, booking rechecks the organizer's calendars, and a forged ID needs the same relay secret that a forged 1:1 approval would (§3). Proposal Q1 asks the team to agree.
- **A model in the group.** The model reads calls and their context and can be asked anything, including about the organizer. Mitigation: its context holds only the group projection, it has no tool that books or reveals private data, commands run before it, and tools act only for the sender.
- **Copied names in the group.** Anyone can take another member's profile name and post "1 3". Mitigation: answers are keyed by user ID, so a copy adds an answer but replaces none, only the organizer books, and signed-in calendars remove times by real busy times.
- **Double counting.** A member who signs in and also sends numbers counts twice, because the two identities are not tied. Mitigation: the organizer's ranking lists names. The user preferred no extra step to a tie.
- **Misread answers.** The model may turn "목요일 빼고 다 돼" into the wrong numbers. Mitigation: the bot repeats each recorded answer, and the member can correct it or tick the page.
- **Asking everyone for Google Calendar.** Members who do not know the service may hesitate to connect a calendar to it. Mitigation: busy times only, nothing stored, and ticking by hand on the same page.
- **Remembered grants.** Recognizing a returning member keeps a Google grant across groups. Mitigation: read-only and busy-only, named on the page, deleted on **Forget me** or after 180 days.
- **Inference from struck-out times.** When a member leaves a private note and a time vanishes soon after, others may guess why. Mitigation: struck-out times carry no name or reason, and calendar changes strike times out the same way.
- **Posting and leaving through the screen.** Leaving cannot be undone, and an untitled group is found by its members' names. Mitigation: the room check acts only in the window that shows the message being answered, and the Mac change checks the database after every send and leave.
- **One Mac for every group.** A locked, asleep or signed-out Mac delays every post, and the phone cannot take groups over. Mitigation: posts wait in the outbox, and the Mac change's heartbeat reports a locked Mac.
- **Requests that stay open.** With no automatic close, a forgotten request keeps the poll tools in the room's conversation. Mitigation: anyone can send `stop`, and the organizer can cancel from `/app`.
- **Everything the KakaoTalk change risks.** The terms-of-service risk, the single relay Mac and app updates all apply here, and a suspended account fails every active group at once.
- **Scope pressure.** Group scheduling opens the door to pooled availability, recurring meetings and team coordination. This draft keeps them out.

## Open Questions

- Proposal Q1: is confirmation in the group by the organizer's user ID acceptable?
- Should a group whose only members are the organizer and the account be refused?
- How does a member who left the group get a group answer removed, if they never used the poll page?
- Can a member's 1:1 chat with the account start before they add it as a friend, or do they need the friend-add link first?

# Design

This design is a draft. The user accepted it in scope on 2026-11-26, and no teammate has reviewed it yet; the [proposal](proposal.md#answers-from-the-user-2026-11-26) lists the answers.

## Context

The `host-kakaotalk-channel` change (branch `feat/host-kakaotalk-channel`, not merged) puts a relay app on a team-owned Android phone between KakaoTalk and the agent service. Its §1 sends private content only through the **답장** action of a notification posted for a bound room. When no such notification is waiting, it sends a fixed nudge through an accessibility service that finds a chat by name. Its §3 identifies a 1:1 chat by the room ID in the notification tag, and keeps group and open-chat text on the phone.

Three facts from the 2026-11-26 device check limit what a group feature can do:

1. A group message notification carries a **답장** action and the room ID. The relay can answer a group, but only right after someone has written in it.
2. Joining a group raises no actionable notification. The relay does not learn that it joined, or who added it.
3. A sender is named by profile name only. Two members can show the same name, and a member can rename themselves to match someone else.

The `host-kakaotalk-mac-relay` change (branch `feat/host-kakaotalk-mac-relay`, not merged) adds a second relay behind the same routes: KakaoTalk for Mac on a Mac mini, which reads the app's own database. It gives each message's room `chatId`, which equals the phone's room ID, the author's user ID and each group's member IDs. It sends through `kakaocli` by chat-list name, with checks before and after, and it can leave a group. Facts 1 and 3 do not hold for it. The user chose on 2026-11-26 to run group scheduling on it (§12).

Requests today have one host and one requester (`meeting-requests`). Bookings make the requester the only attendee (`calendar-booking`). The host's private context stays host-only (`meeting-requests` "Audience-specific projections"). A requester's Google Calendar grant is read-only and bound to its request (`requester-calendar-access`).

## Goals / Non-Goals

**Goals**

- A linked host can let a KakaoTalk group pick one meeting time against the host's real calendar.
- Members can answer without an account, and can stop the scheduling.
- No one in the group learns anything private about the organizer or another member.
- Only the organizer can book, from a channel that proves who they are.

**Non-Goals**

- Several hosts' calendars pooled together, round-robin, or team coordination inside a workspace.
- Recurring group meetings.
- Open chats (오픈채팅), iMessage groups and WhatsApp groups. Telegram groups come later, in a change of their own (user, 2026-11-26).
- eve's group conversation itself: its transport, its consent text, what it stores and how members quiet it. The change in PR #501 owns it.

## Decisions

### 1. Organizer

The host of a group request is the **organizer**: the linked, set-up host whose group code activated the room. The organizer's conflict calendars, working hours, buffers, places and booking destination are used, exactly as for a request where they are the host. There is one organizer per group request. A second linked host in the same room is a member like anyone else.

The inviter cannot be the host, because the relay never sees the invitation. Taking "the first linked host who writes in the room" would pick whoever spoke first, not the person who wants to organize.

### 2. Activation

The organizer asks for a group code in one of two ways: **Schedule a group** in `/app`, or by saying so in their own 1:1 KakaoTalk chat. The service issues `FMAT-G` and eight characters. The code is single-use, valid for 15 minutes, bound to the organizer, and limited to five per hour, like the host link codes of `link-on-code`. With the code, the organizer gives the meeting length, the date range, the mode (in person, online or either) and the expected number of members, or accepts the defaults. The expected number excludes the organizer. When the organizer gives none, it is the room's member count from the Mac relay once the code binds the room, less the account and the organizer.

The organizer posts the code in the group. The Mac relay forwards every group's messages for eve's group conversation (§5), and the service takes a code out before the model sees the message. When the service accepts the code, it binds that message's room ID to the new group request and posts the introduction in the room (§6, §12).

The following codes bind nothing:

- A `FMAT-G` code in a 1:1 chat voids its attempt.
- A host `FMAT-` link code in a group also voids its attempt, as the KakaoTalk change already does.
- An expired or used code gets one fixed reply in the group: "This code has expired. Ask the organizer for a new one." The reply names no one.

A room with an open group request is called activated below. A room can hold one open group request at a time. A second valid code for the same room is refused, and the organizer is told in their 1:1 chat.

### 3. Authority

A group message never approves, books, cancels, reschedules or changes a setting. This holds even when the profile name matches the organizer's. Only these carry authority:

- The organizer's 1:1 KakaoTalk chat, or their other linked channel.
- `/app`.
- The organizer's connected agent with `host:decide`.

This is the same source rule as `calendar-booking` "Attributable approval of the current proposal". A group adds no new way to approve.

### 4. Gathering availability

The user chose on 2026-11-26 that everyone connects Google Calendar from one link, with manual answers as the fallback. The relay does not learn that the account joined a room, so the link goes out with the introduction, right after the organizer's code (§2).

**Collecting calendars.** The introduction asks every member to open the poll page `/g/<token>` and connect Google Calendar. No account is needed. On the page the member enters a display name, connects Google read-only, and may leave an email for the invitation. The grant follows `requester-calendar-access`. It reads calendar-list and busy times only, it is used for this group request only, and no event title, place or attendee is stored, logged, shown or given to the model. The Google-verified address is not used as the invitation email unless the member ticks **Send me the invitation**.

**Returning members (user, 2026-11-26).** The introduction goes to everyone, and nothing in the group says who has connected before. A member is recognized on the poll page, when they sign in with Google or on a device the page remembers, or by their KakaoTalk user ID as §9 describes:

- **An existing host's** conflict calendars, as saved in their setup, are used with no new calendar step.
- **A member of a past group** who connected Google is remembered. Their grant is reused with no new consent screen.

The page shows which calendars count, and offers **Don't use my calendar** for this group and **Forget me**, which deletes the remembered grant and identity. A remembered member grant is deleted 180 days after the member's last group request closes (user, 2026-11-26). A remembered member is not a host and gets no `/app` workspace.

**Finding candidates.** The service runs the organizer's feasibility over the date range. It treats every connected member's busy times as busy for the meeting. When every candidate would be removed, it keeps the times that the most connected members can attend instead. That way one very busy member does not empty the list. Up to five candidates are picked, spread across the range, as in "Offered times spread across the range". For an in-person meeting, each candidate is paired with one of the organizer's confirmed places, as in "Time and place pairs".

**Posting the times (user, 2026-11-26).** The numbered times go to the group as soon as the expected number of members have connected a calendar or ticked times on the page, when the organizer asks, or 24 hours after activation, whichever comes first. Numbers in the chat cannot count toward this, because they are only possible after the times are posted. They are posted at that moment (§12). Until then the poll page shows the times as they stand, and they change as calendars connect.

**Fallback answers.** A member without Google, or one who does not want to connect, answers in one of two ways:

- **Ticking** the times that work on the same page.
- **Telling the bot in the group**, after the times are posted: numbers such as "1 3" or "1번 3번", or words such as "목요일 저녁만 돼요", which the group conversation records through `record_group_answer` (§5). The answer is shown under the sender's profile name and keyed by their user ID, so a later message from the same user replaces the earlier one, and a copied name cannot replace someone else's answer. "없음" or "none" records "no time works".

All answers count the same, with no "unverified" label (user, 2026-11-26). A forged answer can sway the count, but only the organizer can book (§3). A group answer and a page answer are not merged by name. The page sets a device-bound edit token, so a member can change or delete their answer later.

**After the times are posted.** A newly connected calendar, or a new busy event for the organizer, can make a posted candidate infeasible. That candidate is struck through for everyone, with no reason and no name. The other candidates keep their numbers.

### 5. The group conversation

The user decided on 2026-11-26, in the `host-kakaotalk-mac-relay` session, that eve answers every member's message in every KakaoTalk group the account is in, through a group-only conversation owned by no host and with no host tools. A separate change in PR #501 owns that conversation: its transport, its own consent text, what it stores and how members quiet it. The user then asked on 2026-11-26 that this draft fit it. Group scheduling becomes part of that conversation.

**Commands before the model.** The service handles these before a message reaches the group conversation, and they never depend on what the model decides:

- A `FMAT-G` or `FMAT-` code (§2), or an `FMAT-M` member code (§9). The code is removed from the text the model sees.
- `stop` or `그만`, which closes the room's open group request (§6).
- `/kickout`, which makes the account leave the room (§11).

**Scheduling tools.** While the room has an open group request, the group conversation gets these tools, and no others from this change:

- `group_poll_status`: the group projection of §8, which holds the candidate times, their places, the counts and the names of members who said a time works.
- `group_poll_link`: the room's poll page link.
- `record_group_answer(times)`: records which candidate times work for the sender of the current message. The sender is the user ID on the relay event, and the tool has no sender argument, so the model cannot answer for anyone else. "1 3", "1번이랑 3번" and "목요일 저녁만 돼요" can all become an answer, after the times are posted. The bot repeats what it recorded ("○○님: 1, 3번으로 적었어요"), so a misread can be corrected.

The conversation has no tool that books, cancels, changes the date range or reads anyone's calendar, rules or other requests (§3). It has no tool for private notes (§10), and none that says whether a member connected a calendar.

**What the model sees.** Only the group projection and the group's messages. The organizer's private context, members' calendars, private notes and emails never enter the group conversation's context, so it cannot repeat them however it is asked.

**Fixed messages stay fixed.** The introduction (§6), the posted times, the confirmation (§7), the reuse question (§9) and the goodbye (§11) are templates, not model text. Only replies to members' messages come from the model.

A receipt keeps the event ID of each recorded answer, so the same message is not counted twice.

### 6. Consent and privacy

The introduction is fixed text, with only the organizer's display name and the poll link filled in:

> 안녕하세요, Find Me a Time입니다. {organizer}님이 이 방의 모임 시간을 정하려고 저를 불렀어요. 링크에서 구글 캘린더를 연결해 주세요: {link} 바쁜 시간만 확인하고 일정 내용은 보지 않아요. 연결이 어려우면 같은 링크에서 직접 체크하거나, 시간이 올라온 뒤 저에게 되는 번호를 말해 주세요. 단톡에서 말하기 어려운 사정이 있으면 저에게 1:1로 따로 말씀해 주세요. 단톡에는 전하지 않아요. 누구든 '그만'을 보내면 이 일정 잡기는 바로 멈춰요. 개인정보 안내: findmeatime.com/privacy

The introduction says nothing about what the account reads in the group in general. The group conversation change states that in its own text, and this introduction must not contradict it.

These rules apply:

- No answer is stored for a member until they give one. An answer stores only the display name they chose or showed, the times, its source, whether a calendar is connected and, from the page, an optional email. A connected calendar's busy times are read when needed and not stored. No phone number or profile photo is read. A KakaoTalk user ID is kept only as a hash, as §9 says.
- `stop` from anyone closes the group request as stopped, removes the scheduling tools from the room's conversation, and tells the organizer in their 1:1 chat. The organizer can start again with a new code. Whether eve then stays quiet in the room is the group conversation change's rule.
- The poll page states the same facts and links to the privacy policy. It has **Delete my answer**.
- Members' answers and emails are deleted 30 days after the group request closes. This is shorter than the 90 days for closed requests, because these members have no account and never asked to be recorded.
- The privacy policy gains a section for group members who have no account.

### 7. Confirmation and booking

The organizer sees the current ranking in `/app` and can ask for it in their 1:1 chat. The ranking orders the times by how many members said they work, then by the organizer's own candidate order. The service also sends it to the organizer once, when the poll settles. The poll settles when every member who answered has answered all times, and no new answer has come in for 24 hours, or when the date range is about to begin.

The organizer books by number: "2번으로 잡아줘" in their chat, or **Book this time** in `/app`. Booking follows `calendar-booking` with these changes:

- The recheck before dispatch reads the organizer's calendars again for the chosen time. A failure books nothing and tells the organizer, who can pick another time.
- The event goes into the organizer's booking destination. Its attendees are the members who left an email on the poll page (user, 2026-11-26), and Google sends the invitations. The description holds only the meeting details and any join link.
- The group receives one confirmation right after booking (§12). It gives the time, the place or join link, and a link to add the event to a calendar (an `.ics` download on the poll page).

The group request then closes, and the scheduling tools leave the room's conversation. The account stays in the room until a member sends `/kickout` (§11).

An unbooked group request never closes on its own (user, 2026-11-26). It stays open until it is booked, the organizer cancels, or someone sends `stop`. When every candidate has passed, the organizer is asked once in their 1:1 chat for a new date range, and the group is told nothing until new times are found.

### 8. What the group never sees

Messages to the group are built from fixed templates. These are the only fields they may hold:

- The organizer's display name.
- The meeting length and mode.
- The candidate times and their places.
- Per-time counts and the display names of members who said a time works.
- The poll link.
- The confirmation, as described in §7.

They never contain any of these:

- Event titles, places, attendees or the reason a time is busy, for the organizer or any member.
- The organizer's rules, working hours, notes, exceptions, weekly load, places they did not offer, or other requests.
- Which member's calendar blocks which time, or who said "no time works".
- Members' emails, and whether a member connected a calendar, except the reuse question that the user chose to ask in the group (§9).
- Any link code, booking link or `/app` link.

The ranked list in the organizer's 1:1 chat may name who answered what, because the organizer runs the poll. It still carries no member calendar detail.

### 9. Member identity

The user asked on 2026-11-26 that a member's KakaoTalk user ID be remembered, so that a member who connected Google before is not asked again, and chose the Mac relay to supply it (§12). Every group and 1:1 message from the Mac relay carries the author's user ID (`senderUserId`, from `NTChatMessage.authorId`). The service keys it under the existing hash key, in a `kakaotalk-member:` namespace, and keeps only the hash.

**Membership.** For an activated room, the Mac relay's membership events give the members' user IDs. The service keeps them as hashes while the group request is open. They give the default headcount (§2), and they map a 1:1 sender to the activated groups they belong to (§10).

**Tying a member to the poll page.** Everyone opens the same poll link, so the page does not know which KakaoTalk member opened it. A member who wants to be recognized ties the two once:

1. On the poll page, after Google sign-in, the page offers **Remember me in KakaoTalk** and shows a one-time `FMAT-M` code.
2. The member sends the code in the group or in a 1:1 chat with the account. The code is single-use, valid for 15 minutes and bound to that poll page identity. The bot says nothing about it in the group; the page shows that the tie is made.
3. The sender's user ID hash is tied to the member's poll page identity, and so to their Google connection.

**The reuse question (user, 2026-11-26).** When a recognized member writes in a newly activated room, and they connected Google in an earlier group, the bot asks them in the group, by name:

> {name}님, 예전에 연결한 구글 캘린더를 이 모임에도 쓸까요? (네 / 아니요 / 잊어주세요)

The user chose the group over a 1:1 chat. The trade-off is accepted on purpose: the others in the room learn that this member has used the product before. Only a message from the same user ID counts as the answer. "네" reuses the connection for this group, "아니요" leaves the member to the poll page like anyone else, and "잊어주세요" works as **Forget me**. The question is asked once per member per group. A member who never tied their identity is not recognized in the group, so the poll page asks instead, after they sign in.

**No first messages (user, 2026-11-26).** The account never starts a 1:1 chat with a member: no 선톡, and no nudge to a member's chat. The introduction tells the group that anyone can write to the account 1:1 for what they would rather not say there. The Mac relay sends into a 1:1 room only after the other person has written in it (its design 6), and then as often as needed. On the phone, a device check on 2026-11-26 sent three separate replies to one incoming message, and all were delivered. Starting a 1:1 chat from the group member list through the accessibility path is out of scope. It is unverified, and messages to people who never wrote to the account carry the highest risk of suspension.

A member's remembered user ID hash and its tie are deleted with their remembered grant: on **Forget me**, or 180 days after their last group request closes.

### 10. Private notes

The user asked on 2026-11-26 that a member be able to tell the account privately what they do not want to say in the group. A note arrives in the member's 1:1 chat. The service matches the sender's user ID to the activated groups whose member list holds it (§9), so a note needs no tie. This text, unlike group text, goes to the model, because the member wrote it to the bot. The model turns it into structured limits only: unavailable intervals and less-preferred intervals inside the group's date range.

The bot reads the limits back in the 1:1 chat ("목요일 저녁은 빼고, 오전은 가능하면 피할게요. 맞나요?") and applies them only after the member agrees. When the member is in more than one open group, the bot asks which one by organizer name and date range. The note's text is not stored after the limits are confirmed. The limits are kept with the member's answer and are deleted with it.

The limits count as that member's busy times when candidates are found (§4). A less-preferred interval only moves a time down the order. The group sees only the candidate times that result. Neither the group nor the organizer sees the note, the limits, or that a note exists (user, 2026-11-26). A posted candidate that a new note removes is struck through like any other, with no reason and no name.

A 1:1 sender who is in no activated group gets one fixed reply that names no group.

### 11. Leaving the room

Any member may type `/kickout` in a group (user, 2026-11-26). An exact `/kickout` is handled before the model, in any group, activated or not. The account then leaves:

1. If the room has an open group request, the service closes it as stopped, as for `stop`, and tells the organizer in their 1:1 chat.
2. The bot posts a fixed goodbye in the room: "Find Me a Time이 이 방에서 나갈게요. 다시 부르려면 주최자가 새 코드를 올려 주세요."
3. The service queues a `leave_room` row for the room, and the Mac relay carries it out (its design 7).

The goodbye and the leave both go through the room check of §12, which acts only in the window that shows this `/kickout`.

The account never leaves on its own, booked or not (user, 2026-11-26). A booked room stays with no open request. Its conversation goes on without the scheduling tools, and the organizer can start a new group request there with a new code.

When the Mac relay reports the leave as `failed`, or its retries run out, the group request stays closed and the organizer, if there is one, is told that the account could not leave. A later `/kickout` tries again. While the phone is the active relay, `/kickout` only closes the group request.

### 12. The Mac relay

The user chose on 2026-11-26 to run group scheduling on the KakaoTalk for Mac relay of `host-kakaotalk-mac-relay`, because an always-on Mac is available. Group scheduling runs only while `KAKAOTALK_ACTIVE_RELAY` is `mac`. While the phone is active, a group code gets one fixed reply and binds nothing, and posts to bound rooms wait.

This change asks three things of the Mac relay beyond that change:

- Every group's text, as the group conversation change provides, with codes, `stop` and `/kickout` handled before the model (§2, §5).
- Membership events, on for activated rooms (§9).
- Posting in, and leaving, a group that the Mac change's name rule cannot address.

**Confirming the room (user, 2026-11-26).** `kakaocli` opens a chat by the name the chat list shows. A titled group whose name no other room contains is addressed as the Mac change already does. Any other group has no name of its own, so its chat-list label lists its members, or it has a name another room contains. For such a group the helper:

1. Reads the room's newest messages from the database and computes its chat-list label.
2. Opens each chat-list row with that label, one at a time, after closing other chat windows.
3. Reads the newest messages in the opened window. It goes on only in the window that shows the message being answered, such as the code, the `/kickout` or the member's message, with the same sender name and text. A post that answers no message, such as the times after 24 hours, needs the window to show the room's three newest messages from the database, in order.
4. Types the post, or runs the leave, in that window only.

When no window matches, or more than one does, nothing is sent or left, and the outcome is `failed`. The Mac change's landing check still runs after every send. Its leave check still requires that this room, and no other, disappears from the database. The user reports that reading a chat window's messages through accessibility works (2026-11-26).

The Mac relay can send at any time to a room it can address. The times and the confirmation are therefore posted when they are ready, not after the next group message.

## Risks / Trade-offs

- **The reuse question in the group.** It tells the room that a member has used the product before. The user accepted this on 2026-11-26. Mitigation: it is asked once, names no calendar, and offers **잊어주세요**.
- **Remembering KakaoTalk identities.** Keeping a member's user ID hash ties together their chats across groups. Mitigation: only the hash is kept, it is deleted with **Forget me** or after 180 days, and nothing in a group reveals it.
- **Inference from struck-out times.** When one member leaves a private note and a time vanishes soon after, others may guess why. Mitigation: struck-out times carry no name or reason, and calendar changes strike times out the same way.
- **Posting and leaving through the screen.** Leaving is the first destructive action the relay takes, and a group with no name of its own is found by its members' names. Mitigation: the room check of §12 acts only in the window that shows the message being answered, and the Mac change checks the database after every send and leave.
- **Requests that stay open.** With no automatic close and no automatic leave (user, 2026-11-26), a forgotten request keeps the scheduling tools in the room's conversation. Mitigation: anyone can send `stop`, and the organizer can cancel from `/app`.
- **A model in the group.** The model reads every message and can be asked anything, including about the organizer. Mitigation: its context holds only the group projection, it has no tool that books or reveals private data, commands run before it, and answers are recorded only for their sender.
- **Misread answers.** The model may turn "목요일 빼고 다 돼" into the wrong numbers. Mitigation: the bot repeats each recorded answer, and the member can correct it or tick the page.

- **Copied names in the group.** Anyone can take another member's profile name and post "1 3". The user chose to count answers without a label. Mitigation: answers are keyed by user ID, so a copy adds an answer but replaces none, only the organizer books, and connected calendars remove times by real busy times, not by a claim.
- **One Mac for every group.** A Mac that is locked, asleep or signed out delays every post and leave, and the phone cannot take groups over. Mitigation: posts wait in the outbox, and the Mac change's heartbeat reports a locked Mac.
- **Asking everyone for Google Calendar.** Members who do not know the service may hesitate to connect a calendar to it. Mitigation: busy times only, nothing stored, and ticking by hand on the same page.
- **Everything the KakaoTalk change risks.** The terms-of-service risk, the single relay Mac and app updates all apply here as well, and a suspended account fails every active group at once.
- **Scope pressure.** Group scheduling opens the door to pooled availability, recurring meetings and team coordination. This draft keeps them out.

## Open Questions

- None of the proposal's questions is open; the ones below are smaller.
- Should a group whose only members are the organizer and the account be refused?
- Does the Mac database record who added the account to a group? This draft does not rely on it.
- How does a member who left the group get their answer removed if they never used the poll page?
- Can a member's 1:1 chat with the account start before they add it as a friend, or do they need the friend-add link first?

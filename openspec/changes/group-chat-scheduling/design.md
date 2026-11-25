# Design

This design is a draft for team discussion. Nothing in it is agreed, and the [proposal](proposal.md#unresolved-decisions-for-the-team) lists the open questions.

## Context

The `host-kakaotalk-channel` change (branch `feat/host-kakaotalk-channel`, not merged) puts a relay app on a team-owned Android phone between KakaoTalk and the agent service. Its §1 sends private content only through the **답장** action of a notification posted for a bound room. When no such notification is waiting, it sends a fixed nudge through an accessibility service that finds a chat by name. Its §3 identifies a 1:1 chat by the room ID in the notification tag, and keeps group and open-chat text on the phone.

Three facts from the 2026-11-26 device check limit what a group feature can do:

1. A group message notification carries a **답장** action and the room ID. The relay can answer a group, but only right after someone has written in it.
2. Joining a group raises no actionable notification. The relay does not learn that it joined, or who added it.
3. A sender is named by profile name only. Two members can show the same name, and a member can rename themselves to match someone else.

Requests today have one host and one requester (`meeting-requests`). Bookings make the requester the only attendee (`calendar-booking`). The host's private context stays host-only (`meeting-requests` "Audience-specific projections"). A requester's Google Calendar grant is read-only and bound to its request (`requester-calendar-access`).

## Goals / Non-Goals

**Goals**

- A linked host can let a KakaoTalk group pick one meeting time against the host's real calendar.
- Members can answer without an account, and can stop the bot.
- No one in the group learns anything private about the organizer or another member.
- Only the organizer can book, from a channel that proves who they are.

**Non-Goals**

- Several hosts' calendars pooled together, round-robin, or team coordination inside a workspace.
- Recurring group meetings.
- Open chats (오픈채팅), iMessage groups and WhatsApp groups. Telegram groups come later, in a change of their own (user, 2026-11-26).
- Following the group's conversation with the model.

## Decisions

### 1. Organizer

The host of a group request is the **organizer**: the linked, set-up host whose group code activated the room. The organizer's conflict calendars, working hours, buffers, places and booking destination are used, exactly as for a request where they are the host. There is one organizer per group request. A second linked host in the same room is a member like anyone else.

The inviter cannot be the host, because the relay never sees the invitation. Taking "the first linked host who writes in the room" would rest on a profile name, which can be forged.

### 2. Activation

The organizer asks for a group code in one of two ways: **Schedule a group** in `/app`, or by saying so in their own 1:1 KakaoTalk chat. The service issues `FMAT-G` and eight characters. The code is single-use, valid for 15 minutes, bound to the organizer, and limited to five per hour, like the host link codes of `link-on-code`. With the code, the organizer gives the meeting length, the date range, the mode (in person, online or either) and the expected number of members, or accepts their defaults for the first three. The expected number excludes the organizer.

The organizer posts the code in the group. The relay already sees every group notification, and it forwards a message that matches the `FMAT-G` pattern even from a room that is not activated. That is the only text it forwards from such a room. When the service accepts the code, it binds the room ID of that notification to the new group request. It then answers through that notification's **답장** action with the introduction (§6).

The following codes bind nothing:

- A `FMAT-G` code in a 1:1 chat voids its attempt.
- A host `FMAT-` link code in a group also voids its attempt, as the KakaoTalk change already does.
- An expired or used code gets one fixed reply in the group: "This code has expired. Ask the organizer for a new one." The reply names no one.

A room can hold one open group request at a time. A second valid code for the same room is refused, and the organizer is told in their 1:1 chat.

### 3. Authority

A group message never approves, books, cancels, reschedules or changes a setting. This holds even when the profile name matches the organizer's. Only these carry authority:

- The organizer's 1:1 KakaoTalk chat, or their other linked channel.
- `/app`.
- The organizer's connected agent with `host:decide`.

This is the same source rule as `calendar-booking` "Attributable approval of the current proposal". A group adds no new way to approve.

### 4. Gathering availability

The user chose on 2026-11-26 that everyone connects Google Calendar from one link, with manual answers as the fallback. KakaoTalk raises no notification when the account joins a room, so the link goes out with the introduction, right after the organizer's code (§2).

**Collecting calendars.** The introduction asks every member to open the poll page `/g/<token>` and connect Google Calendar. No account is needed. On the page the member enters a display name, connects Google read-only, and may leave an email for the invitation. The grant follows `requester-calendar-access`. It reads calendar-list and busy times only, it is used for this group request only, and no event title, place or attendee is stored, logged, shown or given to the model. The Google-verified address is not used as the invitation email unless the member ticks **Send me the invitation**.

**Returning members (user, 2026-11-26).** The introduction goes to everyone, and nothing in the group says who has connected before. A member is recognized on the poll page, when they sign in with Google or on a device the page remembers, or by their KakaoTalk user ID as §9 describes:

- **An existing host's** conflict calendars, as saved in their setup, are used with no new calendar step.
- **A member of a past group** who connected Google is remembered. Their grant is reused with no new consent screen.

The page shows which calendars count, and offers **Don't use my calendar** for this group and **Forget me**, which deletes the remembered grant and identity. A remembered member grant is deleted 180 days after the member's last group request closes (user, 2026-11-26). A remembered member is not a host and gets no `/app` workspace.

**Finding candidates.** The service runs the organizer's feasibility over the date range. It treats every connected member's busy times as busy for the meeting. When every candidate would be removed, it keeps the times that the most connected members can attend instead. That way one very busy member does not empty the list. Up to five candidates are picked, spread across the range, as in "Offered times spread across the range". For an in-person meeting, each candidate is paired with one of the organizer's confirmed places, as in "Time and place pairs".

**Posting the times (user, 2026-11-26).** The numbered times go to the group as soon as the expected number of members have connected a calendar or ticked times on the page, when the organizer asks, or 24 hours after activation, whichever comes first. Numbers in the chat cannot count toward this, because they are only possible after the times are posted. Because the bot can only answer a notification, they go out through the next group message after that moment. Until then the poll page shows the times as they stand, and they change as calendars connect.

**Fallback answers.** A member without Google, or one who does not want to connect, answers in one of two ways:

- **Ticking** the times that work on the same page.
- **Numbers in the group** ("1 3", "1,3", "1번 3번"), after the times are posted. The answer is attributed to the sender's profile name, and a later message from the same name replaces the earlier one. `없음` or `none` records "no time works".

All answers count the same, with no "unverified" label (user, 2026-11-26). A forged answer can sway the count, but only the organizer can book (§3). A group answer and a page answer are not merged by name. The page sets a device-bound edit token, so a member can change or delete their answer later.

**After the times are posted.** A newly connected calendar, or a new busy event for the organizer, can make a posted candidate infeasible. That candidate is struck through for everyone, with no reason and no name. The other candidates keep their numbers.

### 5. Reading group text

For an activated room, the relay forwards each group message as a `group_message` event with the room ID, the profile name, the text and the event ID. The service runs a fixed parser on it. The parser recognizes:

- A numbered answer, as in §4.
- `stop` or `그만`, which deactivates the room (§6).
- `/kickout`, which makes the account leave the room (§11).
- A `FMAT-G` or `FMAT-` code, as in §2.

The parser does not send any group message to the model. A message that matches nothing is dropped after parsing, and no receipt keeps its text. A receipt keeps only the event ID and the parse result, so the same message is not counted twice.

When the room deactivates, the relay stops forwarding its text. The service tells the relay through the heartbeat's list of active rooms.

### 6. Consent and privacy

The introduction is fixed text, with only the organizer's display name and the poll link filled in:

> 안녕하세요, Find Me a Time입니다. {organizer}님이 이 방의 모임 시간을 정하려고 저를 불렀어요. 링크에서 구글 캘린더를 연결해 주세요: {link} 바쁜 시간만 확인하고 일정 내용은 보지 않아요. 연결이 어려우면 같은 링크에서 직접 체크하거나, 시간이 올라온 뒤 번호로 답해 주세요. 단톡에서 말하기 어려운 사정이 있으면 저에게 1:1로 따로 말씀해 주세요. 단톡에는 전하지 않아요. 저는 단톡에서 번호 답장과 '그만'만 읽고, 다른 대화는 저장하지 않아요. 누구든 '그만'을 보내면 바로 멈춰요. 개인정보 안내: findmeatime.com/privacy

These rules apply:

- Nothing about a member is stored until they answer. An answer stores only the display name they chose or showed, the times, its source, whether a calendar is connected and, from the page, an optional email. A connected calendar's busy times are read when needed and not stored. No phone number, Kakao user ID or profile photo is read.
- `stop` from anyone deactivates the room, closes the group request as stopped, and tells the organizer in their 1:1 chat. The organizer can start again with a new code. Anyone can then send `stop` again.
- The poll page states the same facts and links to the privacy policy. It has **Delete my answer**.
- Members' answers and emails are deleted 30 days after the group request closes. This is shorter than the 90 days for closed requests, because these members have no account and never asked to be recorded.
- The privacy policy gains a section for group members who have no account.

### 7. Confirmation and booking

The organizer sees the current ranking in `/app` and can ask for it in their 1:1 chat. The ranking orders the times by how many members said they work, then by the organizer's own candidate order. The service also sends it to the organizer once, when the poll settles. The poll settles when every member who answered has answered all times, and no new answer has come in for 24 hours, or when the date range is about to begin.

The organizer books by number: "2번으로 잡아줘" in their chat, or **Book this time** in `/app`. Booking follows `calendar-booking` with these changes:

- The recheck before dispatch reads the organizer's calendars again for the chosen time. A failure books nothing and tells the organizer, who can pick another time.
- The event goes into the organizer's booking destination. Its attendees are the members who left an email on the poll page (user, 2026-11-26), and Google sends the invitations. The description holds only the meeting details and any join link.
- The group receives one confirmation through the **답장** action of the next group notification. The confirmation gives the time, the place or join link, and a link to add the event to a calendar (an `.ics` download on the poll page). If no one writes in the group within 24 hours, the organizer is asked in their 1:1 chat to post the poll link or say anything in the group.

The group request then closes. The relay stops forwarding the room's text.

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

The user asked on 2026-11-26 that a member's KakaoTalk user ID be remembered, so that a member who connected Google before is not asked again. The relay's notifications give the room ID in their tag (`<relay account user ID>_<chat ID>`), and the chat ID is global. The sender of a message is a `Person` whose key may or may not be a stable user ID; this is unverified (Q9). The KakaoTalk for Mac database carries exact `authorId` user IDs per message, but reading it needs a Mac path the KakaoTalk change rejected (Q10).

**When `Person.key` is a stable user ID.** The relay forwards it with every group message and every member 1:1 message. The service keys it under the existing hash key, in a `kakaotalk-member:` namespace, and keeps only the hash. The same hash links a member's group answers, their 1:1 chat and their poll page identity once any of them is tied to it.

**When it is not (the fallback).** A member who wants to be recognized ties their identity once:

1. On the poll page, after Google sign-in, the page offers **Remember me in KakaoTalk** and shows a one-time `FMAT-M` code with a friend-add link to the account.
2. The member sends the code in a 1:1 chat with the account. The code is single-use, valid for 15 minutes and bound to that poll page identity.
3. The 1:1 room ID is tied to the member. From then on, that 1:1 chat is the member's chat.

Without a stable user ID, a group message still cannot be mapped to a member. The group answer stays attributed to the profile name (§4).

**The reuse question (user, 2026-11-26).** When a recognized member writes in a newly activated room, and they connected Google in an earlier group, the bot asks them in the group, through the reply action of that message:

> {name}님, 예전에 연결한 구글 캘린더를 이 모임에도 쓸까요? (네 / 아니요 / 잊어주세요)

The user chose the group over a 1:1 chat. The trade-off is accepted on purpose: the others in the room learn that this member has used the product before. Only a message from the same user ID counts as the answer. "네" reuses the connection for this group, "아니요" leaves the member to the poll page like anyone else, and "잊어주세요" works as **Forget me**. The question is asked once per member per group. Without a stable user ID, the bot cannot tell that the member is in the room, so the poll page asks instead, after the member signs in.

**No first messages (user, 2026-11-26).** The account never starts a 1:1 chat with a member: no 선톡, and no nudge to a member's chat. The introduction tells the group that anyone can write to the account 1:1 for what they would rather not say there. Once a member writes, the relay can answer that 1:1 room as often as needed while its notification stays posted. A device check on 2026-11-26 sent three separate replies to one incoming message, and all were delivered. Starting a 1:1 chat from the group member list through the accessibility path is out of scope. It is unverified, and messages to people who never wrote to the account carry the highest risk of suspension.

A member's remembered user ID hash and 1:1 room tie are deleted with their remembered grant: on **Forget me**, or 180 days after their last group request closes.

### 10. Private notes

The user asked on 2026-11-26 that a member be able to tell the account privately what they do not want to say in the group. A note arrives in the member's 1:1 chat (§9). This text, unlike group text, goes to the model, because the member wrote it to the bot. The model turns it into structured limits only: unavailable intervals and less-preferred intervals inside the group's date range.

The bot reads the limits back in the 1:1 chat ("목요일 저녁은 빼고, 오전은 가능하면 피할게요. 맞나요?") and applies them only after the member agrees. When the member is in more than one open group, the bot asks which one by organizer name and date range. The note's text is not stored after the limits are confirmed. The limits are kept with the member's answer and are deleted with it.

The limits count as that member's busy times when candidates are found (§4). A less-preferred interval only moves a time down the order. The group sees only the candidate times that result. Neither the group nor the organizer sees the note, the limits, or that a note exists (Q11). A posted candidate that a new note removes is struck through like any other, with no reason and no name.

A member who is not tied to an identity cannot leave a note. The bot answers that they should first open the poll link, and gives nothing about any group.

### 11. Leaving the room

Any member may type `/kickout` in an activated room (user, 2026-11-26). The account then leaves the group:

1. The service closes the group request as stopped, as for `stop`, and tells the organizer in their 1:1 chat.
2. The bot sends a fixed goodbye through the reply action of the `/kickout` notification: "Find Me a Time이 이 방에서 나갈게요. 다시 부르려면 주최자가 새 코드를 올려 주세요."
3. The relay opens that room through the same notification's content intent, so it lands in exactly the room the command came from. The accessibility service then taps the room menu, **채팅방 나가기**, and the confirmation (Q13).

A booked group is left on its own the day after the meeting ends. The relay keeps a local list of rooms to leave. It waits for the next notification from such a room, opens the room through that notification and leaves. It never searches the chat list by name. Until it can leave, the room stays deactivated, and nothing from it is forwarded.

When the leave cannot be confirmed on screen, the relay reports `uncertain`, and the room stays deactivated. A later `/kickout` in that room tries again.

## Risks / Trade-offs

- **The reuse question in the group.** It tells the room that a member has used the product before. The user accepted this on 2026-11-26. Mitigation: it is asked once, names no calendar, and offers **잊어주세요**.
- **Remembering KakaoTalk identities.** Keeping a member's user ID hash ties together their chats across groups. Mitigation: only the hash is kept, it is deleted with **Forget me** or after 180 days, and nothing in a group reveals it.
- **Inference from struck-out times.** When one member leaves a private note and a time vanishes soon after, others may guess why. Mitigation: struck-out times carry no name or reason, and calendar changes strike times out the same way.
- **Leaving through the screen.** The accessibility leave is the first destructive action the relay takes. Mitigation: it starts only from the room's own notification, and an unconfirmed leave stays deactivated.
- **Rooms that stay active.** With no automatic close, a forgotten room keeps forwarding its messages to the parser for as long as the group exists. Mitigation: nothing is stored or sent to the model, anyone can send `stop`, and the organizer can cancel from `/app`.

- **Forged names in the group.** Anyone can post "1 3" under another person's name. The user chose to count them without a label. Mitigation: only the organizer books, and connected calendars remove times by real busy times, not by a claim.
- **The bot speaks only after someone writes.** The confirmation can wait for a message in the group. Mitigation: the 24-hour fallback asks the organizer to prompt the group.
- **Asking everyone for Google Calendar.** Members who do not know the service may hesitate to connect a calendar to it. Mitigation: busy times only, nothing stored, and ticking by hand on the same page.
- **Reading a group is more intrusive than reading a 1:1 chat.** Every member's messages reach the service while the room is active, even when they are only parsed and then dropped. Mitigation: a fixed parser, no model, no stored text, and `stop` for anyone.
- **Everything the KakaoTalk change risks.** The terms-of-service risk, the single relay phone and app updates all apply here as well, and a suspended account fails every active group at once.
- **Scope pressure.** Group scheduling opens the door to pooled availability, recurring meetings and team coordination. This draft keeps them out.

## Open Questions

- The open questions in the [proposal](proposal.md#unresolved-decisions-for-the-team).
- Does KakaoTalk deliver a separate notification for each group message when many arrive at once, or only a summary? The event ID scheme of the KakaoTalk change assumes the former.
- Does a group notification distinguish a 1:1 room from a two-person group? A room with only the organizer and the bot should probably be refused.
- How does a member who left the group get their answer removed if they never used the poll page?
- Can a member's 1:1 chat with the account start before they add it as a friend, or do they need the friend-add link first?

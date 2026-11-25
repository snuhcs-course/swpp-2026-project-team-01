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
- Open chats (오픈채팅), iMessage groups and WhatsApp groups. Telegram groups are an open question (Q7).
- Following the group's conversation with the model.

## Decisions

### 1. Organizer

The host of a group request is the **organizer**: the linked, set-up host whose group code activated the room. The organizer's conflict calendars, working hours, buffers, places and booking destination are used, exactly as for a request where they are the host. There is one organizer per group request. A second linked host in the same room is a member like anyone else.

The inviter cannot be the host, because the relay never sees the invitation. Taking "the first linked host who writes in the room" would rest on a profile name, which can be forged.

### 2. Activation

The organizer asks for a group code in one of two ways: **Schedule a group** in `/app`, or by saying so in their own 1:1 KakaoTalk chat. The service issues `FMAT-G` and eight characters. The code is single-use, valid for 15 minutes, bound to the organizer, and limited to five per hour, like the host link codes of `link-on-code`. With the code, the organizer gives the meeting length, the date range and the mode (in person, online or either), or accepts their defaults.

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

After activation, the service runs the organizer's feasibility over the date range and picks up to five candidates. They are spread across the range, as in "Offered times spread across the range". For an in-person meeting, each candidate is paired with one of the organizer's confirmed places, as in "Time and place pairs". The group sees them numbered, with a link to the poll page.

Members can answer in two ways:

- **In the group:** a message of numbers only ("1 3", "1,3", "1번 3번"). It sets that profile name's answer to those times. `없음` or `none` records "no time works". A later message from the same name replaces the earlier one.
- **On the poll page `/g/<token>`:** the member enters a display name and ticks the times that work. They may leave an email to receive the invitation (Q5). They may also connect Google Calendar read-only, which marks a time they did not tick as busy, so the organizer sees an accurate count. The grant follows `requester-calendar-access`: busy only, used for this group request only, no event detail stored. The page sets a device-bound edit token, so the member can change or delete their answer later.

An answer from the group and one from the page are never merged, even when the names match. The organizer sees which source each answer came from. A group answer is labelled **from the chat (name not verified)**.

When a new busy event makes a candidate infeasible for the organizer, the candidate is struck through for everyone, with no reason given. The other candidates keep their numbers.

### 5. Reading group text

For an activated room, the relay forwards each group message as a `group_message` event with the room ID, the profile name, the text and the event ID. The service runs a fixed parser on it. The parser recognizes:

- A numbered answer, as in §4.
- `stop` or `그만`, which deactivates the room (§6).
- A `FMAT-G` or `FMAT-` code, as in §2.

The parser does not send any group message to the model. A message that matches nothing is dropped after parsing, and no receipt keeps its text. A receipt keeps only the event ID and the parse result, so the same message is not counted twice.

When the room deactivates, the relay stops forwarding its text. The service tells the relay through the heartbeat's list of active rooms.

### 6. Consent and privacy

The introduction is fixed text, with only the organizer's display name, the meeting length and the times filled in:

> 안녕하세요, Find Me a Time입니다. {organizer}님이 이 방의 모임 시간을 정하려고 저를 불렀어요. 아래 시간 중 되는 번호를 보내 주시거나 링크에서 골라 주세요. 저는 번호 답장과 '그만'만 읽고, 다른 대화는 저장하지 않아요. 누구든 '그만'을 보내면 바로 멈춰요. 개인정보 안내: findmeatime.com/privacy

These rules apply:

- Nothing about a member is stored until they answer. An answer stores only the display name they chose or showed, the times, its source and, from the page, an optional email. No phone number, Kakao user ID or profile photo is read.
- `stop` from anyone deactivates the room, closes the group request as stopped, and tells the organizer in their 1:1 chat. The organizer can start again with a new code. Anyone can then send `stop` again.
- The poll page states the same facts and links to the privacy policy. It has **Delete my answer**.
- Members' answers and emails are deleted 30 days after the group request closes. This is shorter than the 90 days for closed requests, because these members have no account and never asked to be recorded.
- The privacy policy gains a section for group members who have no account.

### 7. Confirmation and booking

The organizer sees the current ranking in `/app` and can ask for it in their 1:1 chat. The ranking orders the times by how many members said they work, then by the organizer's own candidate order. The service also sends it to the organizer once, when the poll settles. The poll settles when every member who answered has answered all times, and no new answer has come in for 24 hours, or when the date range is about to begin.

The organizer books by number: "2번으로 잡아줘" in their chat, or **Book this time** in `/app`. Booking follows `calendar-booking` with these changes:

- The recheck before dispatch reads the organizer's calendars again for the chosen time. A failure books nothing and tells the organizer, who can pick another time.
- The event goes into the organizer's booking destination. Its attendees are the members who left an email on the poll page (Q5), and Google sends the invitations. The description holds only the meeting details and any join link.
- The group receives one confirmation through the **답장** action of the next group notification. The confirmation gives the time, the place or join link, and a link to add the event to a calendar (an `.ics` download on the poll page). If no one writes in the group within 24 hours, the organizer is asked in their 1:1 chat to post the poll link or say anything in the group.

The group request then closes. The relay stops forwarding the room's text.

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
- Members' emails, and whether a member connected a calendar.
- Any link code, booking link or `/app` link.

The ranked list in the organizer's 1:1 chat may name who answered what, because the organizer runs the poll. It still carries no member calendar detail.

## Risks / Trade-offs

- **Forged names in the group.** Anyone can post "1 3" under another person's name. Mitigation: group answers are labelled unverified, and only the organizer books. The poll page stays available (Q3).
- **The bot speaks only after someone writes.** The confirmation can wait for a message in the group. Mitigation: the 24-hour fallback asks the organizer to prompt the group.
- **Reading a group is more intrusive than reading a 1:1 chat.** Every member's messages reach the service while the room is active, even when they are only parsed and then dropped. Mitigation: a fixed parser, no model, no stored text, and `stop` for anyone.
- **Everything the KakaoTalk change risks.** The terms-of-service risk, the single relay phone and app updates all apply here as well, and a suspended account fails every active group at once.
- **Scope pressure.** Group scheduling opens the door to pooled availability, recurring meetings and team coordination. This draft keeps them out.

## Open Questions

- Q1 to Q7 in the [proposal](proposal.md#unresolved-decisions-for-the-team).
- Does KakaoTalk deliver a separate notification for each group message when many arrive at once, or only a summary? The event ID scheme of the KakaoTalk change assumes the former.
- Does a group notification distinguish a 1:1 room from a two-person group? A room with only the organizer and the bot should probably be refused.
- How does a member who left the group get their answer removed if they never used the poll page?

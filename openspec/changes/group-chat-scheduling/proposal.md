# Proposal

Tracking issue: none yet. This is a draft for the team to discuss. An issue is opened only if the team decides to take the idea forward (Q1).

**Status: draft, not agreed.** The [PRD](../../../documentations/02_product_requirements.md#outside-the-initial-release) puts group scheduling, internal team coordination and group conversations outside the initial release. Nothing in this change is settled scope. It records one way the idea could work, so the team can decide whether to take it on.

## Why

On 2026-11-26 the user suggested that inviting the product's KakaoTalk account into a group chat could start group scheduling. In Korea, friends, clubs and study groups usually pick a meeting time in a KakaoTalk group chat. They do it with a long thread of "I can't do Tuesday" messages, or with a link to an outside poll. A Find Me a Time account in the room could do that work for them, using a host's real calendar and rules.

The `host-kakaotalk-channel` change (branch `feat/host-kakaotalk-channel`, not merged) drops group chats on purpose. Its Q3 asks whether a host should be able to invite the account into a group. This change is one possible answer to Q3. It depends on that change. If the team rejects KakaoTalk, this change falls with it.

These device facts shape the design. They were checked on a Galaxy S22 with KakaoTalk 26.10.1 on 2026-11-26.

- A group message notification has a **답장** action, and `android.isGroupConversation` is `true`. Like every KakaoTalk notification, it is tagged with the room ID.
- The invitation itself raises no notification with actions. The account can only speak in a group after a member writes there, or through the accessibility path, which picks a chat by name.
- A notification names the sender by their KakaoTalk profile name only. It carries no user ID, so a member can change their profile name to match anyone else's.

The relay therefore cannot tell who invited the account. It cannot greet the group when it joins. And it cannot prove who wrote any group message.

## What Changes

All of this is proposed. None of it has been agreed.

- **Activation by a group code.** A linked host who wants to organize gets a one-time `FMAT-G` code, from **Schedule a group** in `/app` or by asking in their own 1:1 KakaoTalk chat. They post the code in the group. Its arrival binds that group room to the host as the **organizer**, and the bot replies in the group through the **답장** action of that message. Until a group is activated, its text never leaves the relay phone, as the KakaoTalk change already requires.
- **The group is a shared room, not an authority.** A message in the group cannot approve, book, cancel or change anything. The organizer decides only in their own 1:1 chat or in `/app`. Group messages are read only as answers that can be counted, attributed to the sender's profile name.
- **Everyone connects Google Calendar from one link.** Right after activation, the bot posts a poll page link (`/g/<token>`) and asks every member to connect Google Calendar there, read-only and for this group request only. Nobody has to sign up. The service reads only busy times, never event details.
- **Candidate times from everyone's calendars.** The organizer names the meeting length, date range and mode. Candidates come from the existing feasibility rules against the organizer's conflict calendars, working hours and buffers, and leave out any time when a connected member is busy. When calendars are collected, the group sees up to five numbered times.
- **A fallback for members who do not connect.** A member without Google, or who does not want to connect, ticks the times that work on the same page, or answers with numbers in the group ("1 3").
- **Consent before collection.** The first message after activation says what the bot is, who activated it (the organizer's display name), what it reads and keeps, and how to stop it. Anyone in the group can send `그만` or `stop` to deactivate it. Until a member answers, nothing about them is stored.
- **Counts, not reasons.** For each time, the group sees how many people said it works and the display names of those people. It never sees why a time was left out, or anything from anyone's calendar.
- **Confirmation by the organizer.** When answers settle, or the organizer asks, the bot sends the organizer a ranked list in their 1:1 chat. The organizer books one time by number. Booking rechecks the organizer's calendars before dispatch, as `calendar-booking` already does. The event goes into the organizer's booking destination. Members who left an email on the poll page are invited as attendees. The group gets one confirmation with the time, the place or join link, and how to add it to a calendar.
- **Deactivation and retention.** A group request closes when the event is booked, when the organizer cancels, after `stop`, or 14 days after activation with no booking. Members' answers are deleted 30 days after the request closes. The relay keeps no group text after the webhook acknowledges it.

## Decisions (proposed)

These were drafted by the session that wrote this change on 2026-11-26. Parts of D4 and D7 follow the user's answers of the same day, listed below. None has been reviewed by a teammate. The [design](design.md) records the reasoning.

| # | Decision | Proposed choice |
|---|---|---|
| D1 | Who the host is ([design 1](design.md#1-organizer)) | The **organizer**: the linked host whose group code activated the room. Not the inviter, whom the relay cannot see. One organizer per group request. Other linked hosts in the room count as members. Their calendars count once they open the link and sign in with Google (D9) |
| D2 | Activation ([design 2](design.md#2-activation)) | A single-use `FMAT-G` code, valid for 15 minutes, issued to the organizer in `/app` or their own 1:1 chat, five per hour. The code binds the room ID seen on the notification that carried it. A `FMAT-G` code seen in a 1:1 chat, or a host `FMAT-` code seen in a group, binds nothing and voids its attempt |
| D3 | Authority ([design 3](design.md#3-authority)) | Group messages never approve, book, cancel or change settings, whoever wrote them. Every decision comes from the organizer's 1:1 chat, `/app` or their connected agent with `host:decide`, as `calendar-booking` already requires |
| D4 | Gathering availability ([design 4](design.md#4-gathering-availability)) | Google Calendar first (user, 2026-11-26). Every member is asked to connect Google Calendar read-only on the poll page, for this group request only. Candidates are the organizer's feasible times with every connected member's busy times removed, up to five. A member who does not connect ticks times on the page or answers by numbers in the group. Chat answers count like page answers, with no "unverified" label (user, 2026-11-26) |
| D5 | Reading group text ([design 5](design.md#5-reading-group-text)) | For an activated room only, the relay forwards group messages. The service reads them with a fixed parser for numbered answers and `stop`. It does not send them to the model. Other text is dropped after parsing and never stored |
| D6 | Consent and privacy ([design 6](design.md#6-consent-and-privacy)) | A fixed introduction on activation, a privacy link, `stop` open to every member, an answer stored only after a member gives one, a display name the member chooses, no phone number or Kakao ID read, deletion of answers 30 days after closure, and a delete action on the poll page |
| D7 | Confirmation ([design 7](design.md#7-confirmation-and-booking)) | The organizer books by number from a ranked list in their 1:1 chat or `/app`. The event goes into the organizer's booking destination. Members who left an email on the poll page are invited as attendees (user, 2026-11-26); the others get the group confirmation and a calendar file. The group receives one confirmation |
| D8 | What the bot never says in a group ([design 8](design.md#8-what-the-group-never-sees)) | Calendar event titles, places, attendees or busy reasons of the organizer or any member; the organizer's rules, notes, exceptions or other requests; which member's calendar blocks a time; link or group codes; a member's email |
| D9 | Returning members ([design 4](design.md#4-gathering-availability)) | A member who signs in with Google on the poll page is recognized. An existing host's conflict calendars are used, and a past member's remembered grant is reused, with no new calendar step (user, 2026-11-26). The poll page says which calendars count and offers **Don't use my calendar** and **Forget me** |

## Answers from the user (2026-11-26)

The user who suggested the idea answered these questions. They are the user's choices, not team decisions.

| Question | Answer |
|---|---|
| How do members give their availability? | When the account is brought into a group, everyone goes to the link and connects Google Calendar. KakaoTalk raises no notification on an invitation, so the link goes out right after the organizer posts the code, which is the first moment the bot can speak |
| What about members who do not connect Google? | They tick times by hand on the same page, or answer with numbers in the group. Connected members' busy times remove candidates before anyone ticks |
| Do numbered answers in the group count, and are they labelled? | They count, with no "unverified" label. Only the organizer can book, so a forged answer can sway the count but cannot book anything |
| Who gets a Google invitation? (was Q5) | Members who left an email on the poll page |
| A member who has already connected: can they skip the question? (was Q4, so Q4 and Q5 are left unused below) | Yes, for existing hosts and for members of past groups. The bot cannot see members' KakaoTalk IDs, so it cannot skip anyone in the room itself. Once a member opens the link and signs in with Google, an existing host's conflict calendars, or a past member's remembered connection, are used with no new calendar step |

## Unresolved decisions for the team

| # | Question | Why it blocks |
|---|---|---|
| Q1 | Does the team want group scheduling at all? The PRD lists "group scheduling, internal team coordination" outside the initial release | Changing it is a product scope decision, and only the team can make it. Without a yes, this change stays a draft |
| Q2 | Does `host-kakaotalk-channel` land, and does its Q3 get the answer "yes, through an organizer's code"? | This change rests on the relay phone, its terms-of-service risk (that change's Q1) and its reply path |
| Q3 | How long does the bot wait for calendars before it posts numbered times? This draft says: when the organizer asks, or 24 hours after activation, whichever comes first | Too short leaves out members who connect late. Too long stalls the group |
| Q6 | Is 14 days the right lifetime for an unbooked group request, and five the right number of candidate times? | Both are guesses with no data behind them |
| Q7 | Should this come to Telegram groups too? There the bot can see a member's stable user ID and receive invitations. iMessage and WhatsApp groups are already refused | Telegram would make member identity verifiable. It could be the better first channel, or a later one |
| Q8 | How long is a past member's Google connection remembered when they stop using it? This draft says 180 days after their last group request closes | Remembering is what lets them skip the question, but it keeps a calendar grant for a person with no account |
| Q9 | Is the `Person.key` of a KakaoTalk group notification a stable per-member value? | If it is, the bot could tell members apart in the chat. It still could not link them to a Google sign-in without asking each member once |

## Conflicts with current documents

These conflicts are open on purpose. None of them is resolved by this draft.

| Document | What it says now | What this change would need |
|---|---|---|
| [PRD §1 and §3](../../../documentations/02_product_requirements.md#outside-the-initial-release) | Group scheduling, internal team coordination and group meetings are outside the initial release. KakaoTalk is out of scope | A team decision (Q1, Q2) recorded in the PRD and the [decision log](../../../documentations/technical_specification/08_decision_log.md) |
| PRD FR-26, FR-37, FR-40, AC-17, AC-33 | Group conversations cannot retrieve host-only details or act as the host | Still true here: a group gets no host-only details and cannot act. What changes is that a group can now *receive* candidate times and confirmations. The FR and AC text needs that distinction |
| [`host-imessage-channel`](../../specs/host-imessage-channel/spec.md) "No session for unlinked or group senders" | Group conversations get nothing | Unchanged for iMessage. Only an activated KakaoTalk room is handled, and only by the rules in this change |
| `host-kakaotalk-channel` (unmerged) D3 | Group and open-chat text never leaves the relay phone | Kept for every room that is not activated. An activated room's text is forwarded for parsing (D5) |
| [`requester-calendar-access`](../../specs/requester-calendar-access/spec.md) "Request-bound grant lifetime" | A requester's Google grant is used for its own request only and ends with it | A group member's grant is remembered across group requests until they press **Forget me** or stop using it (Q8). It is still read-only and busy-only |
| [`calendar-booking`](../../specs/calendar-booking/spec.md) "Host-owned event with stable identity" | The requester is the only attendee | A group booking has zero or more member attendees: those who left an email |
| [`meeting-requests`](../../specs/meeting-requests/spec.md) | A request has one requester, one guest conversation and one agreement | A group request has many answering members and no single agreement. This draft makes it a separate record type instead of stretching the request model |

## Rejected alternatives

| Alternative | Why it was rejected |
|---|---|
| **The inviter is the host, and the invitation starts everything.** | The relay sees no invitation, and no notification names the inviter. Any rule based on "who invited", or a greeting at the moment of the invitation, cannot be built. The organizer's code is the first moment the bot can speak |
| **Greet the group as soon as the account joins, through the accessibility path.** | That path picks a chat by name, so it can post into the wrong room. It would also speak to people who did not ask for it. The KakaoTalk change already limits that path to a fixed nudge in a host's own chat |
| **Any member can confirm or book from the group.** | Group sender identity is a profile name anyone can change, so a message could book an event in the organizer's calendar. Authority stays in the organizer's private channels (D3) |
| **Send all group text to the model so the bot can follow the conversation.** | It would read unrelated conversation between people who never agreed to it, and it would cost model calls for every message. A fixed parser for numbers and `stop` is enough to count answers (D5) |
| **Every member signs up, or must connect Google Calendar.** | Most groups would stop at the first step, and members without Google would be left out. Connecting is asked of everyone, but it needs no account and ticking by hand stays open |
| **Pooled availability from every linked host in the room, read without their knowledge.** | The relay cannot tell which room members are linked hosts. A calendar is reused only after that person opens the link and signs in with Google (D9) |
| **KakaoTalk's built-in poll (투표).** | The relay can only send text through the reply action. Creating a poll needs the accessibility path, and the results cannot be read without scraping the screen |
| **A group request as a normal meeting request with many requesters.** | Every requester rule (one agreement, one guest conversation, guest notices, the booking page) assumes one requester. Stretching them would change behavior for every existing request |

## Capabilities

### New Capabilities

- `group-chat-scheduling`: activation of a KakaoTalk group room by an organizer's code, the introduction and `stop`, candidate times from the organizer's feasibility, members' answers in the group and on the poll page, what the group may and may not see, confirmation by the organizer, the group booking, and retention.

### Modified Capabilities

None are written yet. The table in [Conflicts with current documents](#conflicts-with-current-documents) lists the requirements a later version would change: `calendar-booking` (attendees), `host-kakaotalk-channel` (group text for activated rooms), and the PRD functional requirements. Their deltas are written only after Q1 and Q2 are decided, so that no main spec is changed for a draft.

## Impact

This is an estimate for discussion. Nothing is built.

- **Depends on:** `host-kakaotalk-channel` merged and released.
- **New code:** the group code and room binding, the group parser, the group request records, the poll page `/g/<token>`, the organizer's **Schedule a group** card in `/app`, and ranked results in the organizer's chat.
- **Changed code:** the relay app (forward group messages for activated rooms only), the KakaoTalk webhook (a group event kind), the booking job (several attendees), and the retention pass.
- **Schema:** new tables for group requests, members' answers and group codes, generated through pg-delta, with RLS that denies all client roles.
- **Documents:** the PRD, the decision log, the implementation plan, the privacy policy (members who never signed up), and their Korean mirrors.

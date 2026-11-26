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

Later on 2026-11-26, KakaoTalk for Mac on a Mac mini signed in to the same account gave what notifications do not: each room's exact `chatId`, each message's `authorId`, and each group's member IDs. The `host-kakaotalk-mac-relay` change (branch `feat/host-kakaotalk-mac-relay`, not merged) makes that Mac the active relay, with the phone as a standby. The user chose on 2026-11-26 to build group scheduling on the Mac relay, because an always-on Mac is available. The Mac relay still sees messages, not invitations: whether its database records who added the account is unchecked, and this draft does not rely on it.

## What Changes

All of this is proposed. None of it has been agreed.

- **Activation by a group code.** A linked host who wants to organize gets a one-time `FMAT-G` code, from **Schedule a group** in `/app` or by asking in their own 1:1 KakaoTalk chat. They post the code in the group. Its arrival binds that group room to the host as the **organizer**, and the bot replies in the group through the **답장** action of that message. Until a group is activated, its text never leaves the relay, as the KakaoTalk change already requires.
- **The group is a shared room, not an authority.** A message in the group cannot approve, book, cancel or change anything. The organizer decides only in their own 1:1 chat or in `/app`. A member's message can record only that member's own answer.
- **Everyone connects Google Calendar from one link.** Right after activation, the bot posts a poll page link (`/g/<token>`) and asks every member to connect Google Calendar there, read-only and for this group request only. Nobody has to sign up. The service reads only busy times, never event details.
- **Candidate times from everyone's calendars.** The organizer names the meeting length, date range and mode. Candidates come from the existing feasibility rules against the organizer's conflict calendars, working hours and buffers, and leave out any time when a connected member is busy. When calendars are collected, the group sees up to five numbered times.
- **A fallback for members who do not connect.** A member without Google, or who does not want to connect, ticks the times that work on the same page, or answers with numbers in the group ("1 3").
- **Inside eve's group conversation.** eve answers every member's message in every group the account is in, through a group-only conversation owned by no host (user, 2026-11-26). A separate change in PR #501 owns that conversation. This change adds scheduling to it: codes, `stop` and `/kickout` are handled before the model, and while a group request is open the conversation gets tools to show the poll, give the link and record the sender's own answer. It has no tool that books, and its context holds only what the group may see.
- **Consent before collection.** The first message after activation says who activated scheduling (the organizer's display name), what scheduling keeps, and how to stop it. Anyone in the group can send `그만` or `stop` to end the group request. Until a member answers, no answer is stored for them.
- **Counts, not reasons.** For each time, the group sees how many people said it works and the display names of those people. It never sees why a time was left out, or anything from anyone's calendar.
- **Confirmation by the organizer.** When answers settle, or the organizer asks, the bot sends the organizer a ranked list in their 1:1 chat. The organizer books one time by number. Booking rechecks the organizer's calendars before dispatch, as `calendar-booking` already does. The event goes into the organizer's booking destination. Members who left an email on the poll page are invited as attendees. The group gets one confirmation with the time, the place or join link, and how to add it to a calendar.
- **Remembered KakaoTalk identity.** A member's KakaoTalk user ID, which the Mac relay sends with every message, is remembered as a hash (user, 2026-11-26). A member ties it once to their poll page sign-in with a one-time code. A member who connected Google before is asked in the group whether to reuse it (user, 2026-11-26).
- **Private notes.** A member can tell the account in their 1:1 chat a limit they do not want to say in the group. It shapes the candidate times and is never repeated in the group.
- **`/kickout`.** Any member can make the account leave the room. The account never leaves on its own, booked or not (user, 2026-11-26).
- **Opening the right room.** The Mac relay finds a room by its chat-list name. For a group with no name of its own, or a name that another room shares, it opens each matching room and acts only in the one whose window shows the message it is answering (user, 2026-11-26).
- **Closing and retention.** A group request closes when the event is booked, when the organizer cancels, or after `stop`. It never closes on its own (user, 2026-11-26). When every candidate has passed, the organizer is asked once for a new date range. Members' answers are deleted 30 days after the request closes. What happens to group text is the group conversation change's rule, not this one's.

## Decisions (proposed)

These were drafted by the session that wrote this change on 2026-11-26. Parts of D4 and D7 follow the user's answers of the same day, listed below. None has been reviewed by a teammate. The [design](design.md) records the reasoning.

| # | Decision | Proposed choice |
|---|---|---|
| D1 | Who the host is ([design 1](design.md#1-organizer)) | The **organizer**: the linked host whose group code activated the room. Not the inviter, whom the relay cannot see. One organizer per group request. Other linked hosts in the room count as members. Their calendars count once they open the link and sign in with Google (D9) |
| D2 | Activation ([design 2](design.md#2-activation)) | A single-use `FMAT-G` code, valid for 15 minutes, issued to the organizer in `/app` or their own 1:1 chat, five per hour. The code binds the room ID of the message that carried it. A `FMAT-G` code seen in a 1:1 chat, or a host `FMAT-` code seen in a group, binds nothing and voids its attempt |
| D3 | Authority ([design 3](design.md#3-authority)) | Group messages never approve, book, cancel or change settings, whoever wrote them. Every decision comes from the organizer's 1:1 chat, `/app` or their connected agent with `host:decide`, as `calendar-booking` already requires |
| D4 | Gathering availability ([design 4](design.md#4-gathering-availability)) | Google Calendar first (user, 2026-11-26). Every member is asked to connect Google Calendar read-only on the poll page, for this group request only. Candidates are the organizer's feasible times with every connected member's busy times removed, up to five. A member who does not connect ticks times on the page or answers by numbers in the group. Chat answers count like page answers, with no "unverified" label (user, 2026-11-26) |
| D5 | Scheduling in the group conversation ([design 5](design.md#5-the-group-conversation)) | eve's group conversation, from the change in PR #501, reads every group message (user, 2026-11-26). Codes, `stop` and `/kickout` are handled before the model. While the room has an open group request, the conversation gets three tools: the poll status, the poll link, and recording the current message's sender's own answer, with the sender taken from the relay event. The bot repeats each recorded answer. Its context holds only the group projection (D8), and it has no tool to book, cancel or read anyone's calendar. Fixed messages (introduction, times, confirmation, reuse question, goodbye) stay templates |
| D6 | Consent and privacy ([design 6](design.md#6-consent-and-privacy)) | A fixed introduction on activation, a privacy link, `stop` open to every member to end the group request, an answer stored only after a member gives one, a display name the member chooses, no phone number read, a KakaoTalk user ID kept only as D11 allows, deletion of answers 30 days after closure, and a delete action on the poll page |
| D7 | Confirmation ([design 7](design.md#7-confirmation-and-booking)) | The organizer books by number from a ranked list in their 1:1 chat or `/app`. The event goes into the organizer's booking destination. Members who left an email on the poll page are invited as attendees (user, 2026-11-26); the others get the group confirmation and a calendar file. The group receives one confirmation |
| D8 | What the bot never says in a group ([design 8](design.md#8-what-the-group-never-sees)) | Calendar event titles, places, attendees or busy reasons of the organizer or any member; the organizer's rules, notes, exceptions or other requests; which member's calendar blocks a time; link or group codes; a member's email |
| D9 | Returning members ([design 4](design.md#4-gathering-availability)) | A member who signs in with Google on the poll page is recognized. An existing host's conflict calendars are used, and a past member's remembered grant is reused, with no new calendar step (user, 2026-11-26). The poll page says which calendars count and offers **Don't use my calendar** and **Forget me** |
| D10 | When the times are posted ([design 4](design.md#4-gathering-availability)) | The expected number of members defaults to the group's member count from the Mac relay, less the account and the organizer, and the organizer can change it with the code request. The numbered times go to the group as soon as that many members have connected a calendar or ticked times on the page, when the organizer asks, or 24 hours after activation, whichever comes first (user, 2026-11-26) |
| D11 | Member identity ([design 9](design.md#9-member-identity)) | A member's KakaoTalk user ID is remembered as a hash, so a member is recognized across rooms (user, 2026-11-26). It is the `senderUserId` the Mac relay sends with every group and 1:1 message (user, 2026-11-26). A member ties it once to their poll page identity, by sending the one-time `FMAT-M` code shown on the page in the group or in a 1:1 chat with the account. A 1:1 sender is matched to the activated groups whose member list holds their user ID, so a private note needs no tie. A member known to have connected Google before is asked **in the group**, when they write there, whether to reuse that connection, with **잊어주세요** (Forget me) as a choice (user, 2026-11-26). This accepts that the others in the room learn the member has used the product before |
| D12 | Private notes ([design 10](design.md#10-private-notes)) | A member can tell the account in their 1:1 chat what they do not want to say in the group (user, 2026-11-26). The note is read back to them, then counts only as busy or less-preferred times for that group. It is never repeated in the group or shown to the organizer; the group sees only the resulting candidate times |
| D13 | Leaving the room ([design 11](design.md#11-leaving-the-room)) | `/kickout` from any member of any group makes the account leave it (user, 2026-11-26), after a fixed goodbye. The account never leaves on its own, booked or not (user, 2026-11-26). Leaving uses the Mac relay's `leave_room`, and the room is confirmed as in D16 first |
| D14 | No first messages ([design 9](design.md#9-member-identity)) | The account never starts a 1:1 chat with a member (user, 2026-11-26). The introduction tells the group that anyone can write to the account 1:1 for what they would rather not say in the group. Once a member writes, the relay can answer that 1:1 room as often as needed (checked on a device on 2026-11-26: one incoming message, three separate replies, all delivered) |
| D15 | Transport ([design 12](design.md#12-the-mac-relay)) | The KakaoTalk for Mac relay of `host-kakaotalk-mac-relay`, active, with the phone as a standby (user, 2026-11-26). Group scheduling runs only while the Mac relay is active; a group code that arrives through the phone gets one fixed reply and binds nothing. The Mac relay gives the sender's user ID, the group's member IDs, sending at any time to a room it can address, and leaving |
| D16 | Opening the right room ([design 12](design.md#12-the-mac-relay)) | Before it posts in or leaves a group, the Mac relay's helper opens the room and checks that the window shows the message being answered, such as the code or the `/kickout`, or else the room's newest messages from the database (user, 2026-11-26). For a group with no name of its own, or one whose name another room shares, it tries each chat-list row with that label in turn. No match, or more than one, sends nothing and leaves nothing |

## Answers from the user (2026-11-26)

The user who suggested the idea answered these questions. They are the user's choices, not team decisions.

| Question | Answer |
|---|---|
| How do members give their availability? | When the account is brought into a group, everyone goes to the link and connects Google Calendar. KakaoTalk raises no notification on an invitation, so the link goes out right after the organizer posts the code, which is the first moment the bot can speak |
| What about members who do not connect Google? | They tick times by hand on the same page, or answer with numbers in the group. Connected members' busy times remove candidates before anyone ticks |
| Do numbered answers in the group count, and are they labelled? | They count, with no "unverified" label. Only the organizer can book, so a forged answer can sway the count but cannot book anything |
| Who gets a Google invitation? (was Q5) | Members who left an email on the poll page |
| A member who has already connected: can they skip the question? (was Q4) | Yes, for existing hosts and for members of past groups. The bot cannot see members' KakaoTalk IDs, so it cannot skip anyone in the room itself. Once a member opens the link and signs in with Google, an existing host's conflict calendars, or a past member's remembered connection, are used with no new calendar step |
| When are the numbered times posted? (was Q3; Q3 to Q12 are now answered or dropped, so the table below keeps Q1, Q2 and Q13) | As soon as the number of members the organizer expects have connected or ticked, or when the organizer asks, or after 24 hours at the latest |
| How many candidate times? | Five, as drafted |
| Should an unbooked group close on its own? (was Q6) | No. It stays open until it is booked, the organizer cancels, or someone sends `stop` |
| Telegram groups too? (was Q7) | Later. This change covers KakaoTalk only; Telegram groups, where the bot sees invitations and stable member IDs, are left for a follow-up change |
| How long is a past member's connection remembered? (was Q8) | 180 days after their last group request closes, or until **Forget me** |
| Should KakaoTalk for Mac supply members' user IDs? (was Q10) | Yes. An always-on Mac is available, so the Mac relay is the transport (D15) and its `senderUserId` is the member identity (D11). This drops Q9, whether a phone notification's `Person.key` is a stable user ID |
| May the organizer see a private note, or that one exists? (was Q11) | No. Neither the note, its limits nor the fact that one exists |
| When should the account leave a booked group on its own? (was Q12) | Never. It stays until a member sends `/kickout` |
| Should a quiet, unbooked room be left? (was Q12) | No. It stays, as an unbooked request stays open |
| How does this change fit eve's group conversation? (was Q14) | The user chose on 2026-11-26, in the `host-kakaotalk-mac-relay` session, that eve answers every member's message in every group, owned by no host and with no host tools, and then asked here to rework this draft to fit it. Scheduling becomes commands before the model and tools inside that conversation (D5) |
| How does the bot post in or leave a group that has no name of its own? (asked on 2026-11-26) | It opens the room and checks that the message it is answering, such as the `/kickout`, shows there, and acts only then (D16) |

## Unresolved decisions for the team

| # | Question | Why it blocks |
|---|---|---|
| Q1 | Does the team want group scheduling at all? The PRD lists "group scheduling, internal team coordination" outside the initial release | Changing it is a product scope decision, and only the team can make it. Without a yes, this change stays a draft |
| Q2 | Do `host-kakaotalk-channel` and `host-kakaotalk-mac-relay` land with the Mac relay active, and does the first's Q3 get the answer "yes, through an organizer's code"? | This change rests on the Mac relay (D15), the terms-of-service risk (both changes' Q1) and a Mac mini kept signed in, awake and unlocked (the Mac change's Q2) |
| Q13 | Can the Mac relay's helper read the newest messages of an opened chat window, so that D16 can confirm the room, and does the window menu's **나가기** work? | Neither is checked on a device; the Mac change's task 5.3 covers the leave. If the window cannot be read, a group with no name of its own, or a shared name, can be neither answered nor left, and `/kickout` there only deactivates the room |

## Conflicts with current documents

These conflicts are open on purpose. None of them is resolved by this draft.

| Document | What it says now | What this change would need |
|---|---|---|
| [PRD §1 and §3](../../../documentations/02_product_requirements.md#outside-the-initial-release) | Group scheduling, internal team coordination and group meetings are outside the initial release. KakaoTalk is out of scope | A team decision (Q1, Q2) recorded in the PRD and the [decision log](../../../documentations/technical_specification/08_decision_log.md) |
| PRD FR-26, FR-37, FR-40, AC-17, AC-33 | Group conversations cannot retrieve host-only details or act as the host | Still true here: a group gets no host-only details and cannot act. What changes is that a group can now *receive* candidate times and confirmations. The FR and AC text needs that distinction |
| [`host-imessage-channel`](../../specs/host-imessage-channel/spec.md) "No session for unlinked or group senders" | Group conversations get nothing | Unchanged for iMessage. Only KakaoTalk groups are handled, through eve's group conversation (D5) |
| `host-kakaotalk-channel` (unmerged) D3 | Group and open-chat text never leaves the relay phone. No phone number or Kakao user ID is read | Already replaced by the group conversation change in PR #501, which forwards every group's text. This change adds a hash of a member's KakaoTalk user ID, read from the Mac relay and remembered (D11) |
| `host-kakaotalk-channel` (unmerged) "No session for unlinked senders" | A 1:1 sender who is not a linked host gets one fixed reply per day | A group member's 1:1 chat is handled as a member chat: codes, the reuse question and private notes (D11, D12). It still reaches no host session |
| `host-kakaotalk-channel` (unmerged) D1 | The accessibility path sends only a fixed nudge to a host's own chat | Unchanged. Group scheduling runs only on the Mac relay (D15), so the phone neither answers nor leaves groups. No relay starts a member's 1:1 chat (D14) |
| The group conversation change planned in PR #501 (not yet written when this row was added) | eve replies in every group the account is in, to every member's message, in a group-only conversation with no host tools | This change depends on it and adds the commands before the model, the scheduling tools and the group projection (D5). That change owns the group's own consent text, what group text is stored, and how members quiet eve itself |
| `host-kakaotalk-mac-relay` (unmerged) design 4 | A group message is sent with no text, apart from a link code as `void_code` | Every group's text is sent, as the group conversation change requires. This change needs codes, `stop` and an exact `/kickout` handled before the model (D5) |
| `host-kakaotalk-mac-relay` (unmerged) design 5 | A room is sendable only when no other room's name contains its name, and a group with no name of its own is never addressed | Such a group is addressed by opening each matching room and checking the message it shows (D16). The Mac change's landing check still runs after every send |
| `host-kakaotalk-mac-relay` (unmerged) design 2 and 4 | The sender's user ID is sent but not stored, and membership events are off and stored nowhere | A hash of the user ID is the member identity (D11). Membership events are on, and an activated room's member IDs are kept as hashes for the headcount and private notes (D10, D12) |
| [`requester-calendar-access`](../../specs/requester-calendar-access/spec.md) "Request-bound grant lifetime" | A requester's Google grant is used for its own request only and ends with it | A group member's grant is remembered across group requests until they press **Forget me** or 180 days after their last group request closes. It is still read-only and busy-only |
| [`calendar-booking`](../../specs/calendar-booking/spec.md) "Host-owned event with stable identity" | The requester is the only attendee | A group booking has zero or more member attendees: those who left an email |
| [`meeting-requests`](../../specs/meeting-requests/spec.md) | A request has one requester, one guest conversation and one agreement | A group request has many answering members and no single agreement. This draft makes it a separate record type instead of stretching the request model |

## Rejected alternatives

| Alternative | Why it was rejected |
|---|---|
| **The inviter is the host, and the invitation starts everything.** | The relay sees no invitation, and no notification names the inviter. Any rule based on "who invited", or a greeting at the moment of the invitation, cannot be built. The organizer's code is the first moment the bot can speak |
| **Greet the group as soon as the account joins, through the accessibility path.** | That path picks a chat by name, so it can post into the wrong room. It would also speak to people who did not ask for it. The KakaoTalk change already limits that path to a fixed nudge in a host's own chat |
| **Any member can confirm or book from the group.** | Group sender identity is a profile name anyone can change, so a message could book an event in the organizer's calendar. Authority stays in the organizer's private channels (D3) |
| **A fixed parser and no model, reading only code-activated rooms.** | This draft's first choice. The user chose on 2026-11-26 that eve answers every message in every group, so a parser would sit beside a model that reads the same text anyway. Commands stay deterministic, and answers go through a tool that records only the sender's own answer (D5) |
| **Let the model record an answer for whoever a message names.** | One member could answer for another ("민수는 2번 된대"). The tool takes the sender from the relay event and has no sender argument (D5) |
| **Give the group conversation the organizer's context, so it can explain missing times.** | The model could be talked into repeating it. Its context holds only the group projection (D8) |
| **Every member signs up, or must connect Google Calendar.** | Most groups would stop at the first step, and members without Google would be left out. Connecting is asked of everyone, but it needs no account and ticking by hand stays open |
| **Pooled availability from every linked host in the room, read without their knowledge.** | Even with the Mac relay's user IDs, reading a host's calendar because they sit in a room would use it without their say. A calendar is reused only after that person opens the link and signs in with Google (D9) |
| **KakaoTalk's built-in poll (투표).** | The relay sends only text. Creating a poll needs the accessibility path, and the results cannot be read without scraping the screen |
| **A group request as a normal meeting request with many requesters.** | Every requester rule (one agreement, one guest conversation, guest notices, the booking page) assumes one requester. Stretching them would change behavior for every existing request |
| **Ask the reuse question in the member's 1:1 chat.** | It hides from the room that the member used the product before, but the account would have to start the 1:1 chat. The user chose on 2026-11-26 to ask in the group instead and accept that disclosure |
| **Start 1:1 chats with members (선톡), from the group member list through the accessibility path.** | Unverified on a device, and messages to people who never wrote to the account carry the highest risk of account suspension. Out of scope; the account only answers 1:1 chats a member started (D14) |
| **Match a 1:1 sender to a group member by profile name.** | A profile name can be copied, so another person's private note could be applied to the wrong member, or a stranger's note could shape the group's times |
| **Post in or leave a group found by its chat-list name alone.** | Two rooms can share a name, and a group with no name of its own shows only its members' names. Leaving the wrong room cannot be undone. The room is confirmed by the message it shows (D16) |
| **Refuse groups with no name of their own, and ask the organizer to name the room.** | Many groups are never named. The user chose on 2026-11-26 to open the room and check the message instead |
| **Answer groups through the Android phone while the Mac relay handles 1:1 chats.** | The Mac change runs one relay at a time, so that two relays never act on the same account at once |
| **Leave a booked group on its own, such as the day after the meeting.** | The user chose on 2026-11-26 that the account stays until a member sends `/kickout`. It also spares the relay a destructive action that nobody asked for |
| **A phone notification's `Person.key` as the member identity.** | Unverified, and the Mac relay gives exact user IDs instead |
| **Only the organizer may `/kickout`.** | The user is fine with any member removing the account. Anyone can already stop it with `stop`, and a member who does not want the bot in the room should not need the organizer |

## Capabilities

### New Capabilities

- `group-chat-scheduling`: activation of a KakaoTalk group room by an organizer's code, the introduction and `stop`, the scheduling tools in eve's group conversation, candidate times from the organizer's feasibility, members' answers in the group and on the poll page, what the group may and may not see, confirmation by the organizer, the group booking, and retention.

### Modified Capabilities

None are written yet. The table in [Conflicts with current documents](#conflicts-with-current-documents) lists the requirements a later version would change: `calendar-booking` (attendees), `host-kakaotalk-channel` and `host-kakaotalk-mac-relay` (group text, `/kickout`, member IDs and opening a room by what it shows), and the PRD functional requirements. Their deltas are written only after Q1 and Q2 are decided, so that no main spec is changed for a draft.

## Impact

This is an estimate for discussion. Nothing is built.

- **Depends on:** `host-kakaotalk-channel`, `host-kakaotalk-mac-relay` and the group conversation change in PR #501 merged and released, with the Mac relay active.
- **New code:** the group code and room binding, the commands before the group conversation and its scheduling tools, the group request records, the poll page `/g/<token>`, the organizer's **Schedule a group** card in `/app`, and ranked results in the organizer's chat.
- **Changed code:** the Mac relay (`/kickout` from any group, membership events, and opening a room by what it shows), the KakaoTalk webhook (a group event kind), the booking job (several attendees), and the retention pass.
- **Schema:** new tables for group requests, members' answers and group codes, generated through pg-delta, with RLS that denies all client roles.
- **Documents:** the PRD, the decision log, the implementation plan, the privacy policy (members who never signed up), and their Korean mirrors.

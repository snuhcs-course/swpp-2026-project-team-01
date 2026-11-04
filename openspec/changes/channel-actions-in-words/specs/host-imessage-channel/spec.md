## ADDED Requirements

### Requirement: Host decisions in the host's own words
In the linked iMessage, WhatsApp or Telegram conversation, the assistant SHALL be able to decline a request, share or dismiss its pending suggested changes, and save the reviewed settings when the host clearly asks for it in their own words, through the same application commands as the web buttons. Each action SHALL name what the host was shown (the current proposal version, the pending suggestion, the current settings review) and SHALL act on nothing else. It SHALL NOT act for a message typed on the web, for a closed request, or when the host hesitates, adds a condition, asks a question or asks for a change. A repeated action SHALL change nothing more and SHALL say it was already done.

#### Scenario: Decline in words
- **WHEN** a linked host writes "I can't take this one, decline it" in a request's conversation
- **THEN** the request is declined once, the requester is told as from the web, and nothing is booked

#### Scenario: Share suggested changes in words
- **WHEN** the host writes "send them the new time" while a suggestion is pending
- **THEN** that suggestion is shared once and the requester gets a new version to agree to

#### Scenario: Save settings in words
- **WHEN** the host writes "looks right, save it" after the assistant went through the current settings review
- **THEN** the settings are saved as by **Confirm and save proposed settings** and the reply carries the booking links

#### Scenario: Same words on the web
- **WHEN** the host types "decline it" in `/app`
- **THEN** nothing is declined and the host is pointed to **Decline**

#### Scenario: Something changed meanwhile
- **WHEN** the assistant acts on a proposal version, suggestion or settings review that is no longer current
- **THEN** nothing changes and the assistant names the current one

### Requirement: Questions answered in words
In the linked conversation, the host SHALL be able to ask in words for the current proposal, the suggested changes, their settings and their requests, and the assistant SHALL answer from the application records. In setup, on the web and in the linked conversation, the host SHALL be able to ask about their requests and get each request's requester, purpose, status and reference.

#### Scenario: Requests from setup
- **WHEN** a host in the setup conversation asks "들어온 예약 있어?"
- **THEN** the assistant lists the host's requests instead of saying it cannot see them

### Requirement: Fixed replies in the conversation's language
Fixed replies in the linked conversation, host notices and button titles SHALL be written in English and Korean and SHALL follow the language of the host's message, or for a command word, a button tap or a notice, the host's latest message to the assistant. No fixed reply, help text, summary or settings review SHALL ask the host to type a command or a reference.

#### Scenario: Korean conversation
- **WHEN** a host who writes to the assistant in Korean taps **Approve** under a proposal
- **THEN** the reply confirming the approval is in Korean

## MODIFIED Requirements

### Requirement: Exact commands before any model turn
A linked host's whole-message commands SHALL be parsed and executed by the application before any model turn: listing and selecting requests, entering setup, reviewing, showing suggested changes, sharing or dismissing a suggestion, approving or declining a proposal, and confirming settings. They SHALL keep working for reply buttons and for hosts who type them, but no reply SHALL ask the host to type one. Decisions SHALL name the exact current reference and run through the application command pipeline as the linked host with a retry identity derived from the receipt. A stale or unknown reference SHALL change nothing and return the current reference or a web link. Free text SHALL decide only through the assistant, as the requirements on approval and on host decisions in the host's own words allow.

#### Scenario: Approve the current proposal
- **WHEN** the linked host sends `approve <ref>` naming the latest agreed proposal version
- **THEN** that version is approved once and the booking proceeds as from the web

#### Scenario: Reply to an outdated proposal
- **WHEN** the host sends `approve <ref>` naming a version that a newer proposal superseded
- **THEN** nothing is approved and the reply names the current reference

#### Scenario: Conditional yes
- **WHEN** the host replies "yes, but can we do 11?" to a summary
- **THEN** the text goes to the assistant as discussion and no decision is recorded

#### Scenario: Replay after restart during a web action
- **WHEN** the same approval receipt is processed again after a restart while the host also acts on the web
- **THEN** at most one approval and one booking exist and both channels show the same decision

### Requirement: Switching the conversation in words
In the linked iMessage, WhatsApp or Telegram conversation, the assistant SHALL be able to switch the conversation to a request the host names by reference or requester name, or back to setup, so the host's next plain message reaches that discussion, as `request <ref>` and `setup` do. A name that matches several requests or none SHALL switch nothing, and the assistant SHALL ask which request the host means. A message typed on the web SHALL switch nothing.

#### Scenario: Host names a request
- **WHEN** a linked host writes "let's talk about 박도현's request" and exactly one of their requests has that requester
- **THEN** the conversation switches to that request and the host's next message reaches its discussion

#### Scenario: Ambiguous name
- **WHEN** the host names a requester who matches two requests
- **THEN** nothing is switched and the assistant asks which one, naming each

### Requirement: Summaries and outcomes
A host with an active binding SHALL receive in the linked conversation one summary per event when a proposal awaits approval (saying the host may approve or decline in their own words, with decision buttons where the channel has them) and when a booking is confirmed, not confirmed or still pending. A request's arrival SHALL NOT be announced: the guest is offered times first, and the awaiting-approval summary, the host's first message about the request, SHALL name the requester, the purpose and any earlier request it follows. Each summary SHALL be recorded in the transaction of the change it reports and frozen from that event's own records; a summary for a proposal version that is no longer the latest SHALL NOT be sent.

#### Scenario: Guest starts a request
- **WHEN** a guest of a host with an active binding starts or revises a request
- **THEN** nothing is sent to the linked conversation until the guest agrees to a time

#### Scenario: Proposal awaits approval
- **WHEN** the requester agrees to a proposal of a host with an active binding
- **THEN** one summary with the time, mode and place, saying the host may approve or decline in their own words and naming no command, is queued for the linked conversation

### Requirement: Setup over iMessage
A linked host SHALL be able to enter the shared setup discussion with `setup` or in words and answer setup questions in plain text that update the same draft as the web workspace. Sign-in, Google consent and protected fields SHALL stay browser steps; Thyme SHALL send a link for connecting Google Calendar that returns the host to the conversation. Linking SHALL send a welcome by where the host stands: a ready host is told what Thyme can do, a host without a usable Calendar gets the Calendar link, and any other host gets the first setup question. Settings SHALL be saved only for the current settings review, by the host's clear words to the assistant or the exact `confirm <ref>` command, under the same checks as the web confirmation.

#### Scenario: Welcome into setup
- **WHEN** a host who is not ready confirms the received sender, after either entry
- **THEN** the welcome asks for Calendar or the first setup question, and a plain reply joins the shared setup discussion without `setup`

#### Scenario: Back from Google
- **WHEN** a linked host signs in with Google from Thyme's Calendar link
- **THEN** one message is queued to the linked conversation even if the sign-in is replayed, it does not claim Calendar was granted, and the browser returns to `/app`

#### Scenario: Stale settings review
- **WHEN** the host sends `confirm <ref>` after the draft changed
- **THEN** nothing is saved and the reply names the current review's reference

## ADDED Requirements

### Requirement: Durable signed receipt
The iMessage receiver SHALL accept a delivery only from the configured Photon webhook, after verifying its signature over the raw body with a timestamp no more than five minutes from the server's time, before parsing the payload. A received direct or group message SHALL be stored as one receipt with one processing job in a single transaction before the delivery is acknowledged. The receipt SHALL hold provider locators, keyed hashes of the sender and conversation, the payload's SHA-256, and the message text and reply locators only sealed and only until the receipt is processed. A repeated delivery with the same message identity and payload SHALL be acknowledged without new work; the same identity with a different payload SHALL be refused and change nothing.

#### Scenario: Restart after acknowledgment
- **WHEN** the service restarts right after acknowledging a verified message
- **THEN** the stored receipt's job processes the message once

#### Scenario: Stale or foreign delivery
- **WHEN** a delivery carries a signature older than five minutes or names another webhook
- **THEN** it is refused with no receipt or job

#### Scenario: Changed payload under the same message
- **WHEN** a second delivery reuses a stored message identity with different content
- **THEN** it is refused and the stored receipt is unchanged

### Requirement: Linking by a host-sent code
An authenticated active host SHALL be able to create a one-time link code that the service shows with its iMessage line number and the exact message to send. **Connect iMessage** SHALL create the code and then open the Messages app addressed to the line with that message in the input where the platform supports it (`sms:<number>&body=<text>` on iOS and iPadOS, `sms:<number>?body=<text>` on Android); elsewhere it SHALL show the number, the code, a copy action and a QR code that opens the same deep link on a phone. Opening Messages SHALL NOT change linking state. A message carrying a pending, unexpired code from a direct conversation SHALL only record the sender for confirmation and receive a reply in that conversation; the sender SHALL be bound to the host only after the host confirms the masked sender in the authenticated browser within the confirmation window. A linking message SHALL never reach the model or the transcript.

#### Scenario: Link by code
- **WHEN** the host taps **Connect iMessage**, sends the prefilled message and confirms the masked sender
- **THEN** that sender is bound to the host and the line's first message to the host is a reply in the conversation the host started

#### Scenario: Desktop without Messages
- **WHEN** the host taps **Connect iMessage** on a desktop browser
- **THEN** no navigation happens and the card shows the number, the code, **Copy** and a QR code of the deep link

#### Scenario: Code arrives but is not confirmed
- **WHEN** the code's message arrives and the host never confirms in the browser
- **THEN** no binding exists and the sender has no host authority

#### Scenario: Wrong, expired or replayed code
- **WHEN** a code that is unknown, expired, already used or sent from a group conversation arrives
- **THEN** nothing is bound, a pending attempt it names is voided, and the sender receives at most a fixed reply

#### Scenario: Sender bound to another host
- **WHEN** a sender already bound to one host sends another host's code
- **THEN** the attempt is voided and the existing binding is unchanged

### Requirement: Link step after sign-in
Right after Google sign-in, before the conversation, `/app` SHALL show the link step to an active host with an open link attempt, or with no binding who is not ready and has not chosen to set up in web chat in that browser. The step SHALL open with a link code already made, show the message, the line and how long the code works, open Messages from a tap on a phone, and on a computer show a QR code of the deep link, **Copy**, and on a Mac **Open Messages**. A code that ran out SHALL be replaced only when the host asks. Choosing **Set up here in web chat** SHALL open the conversation and be remembered in that browser.

#### Scenario: Link right after sign-in
- **WHEN** a new host signs in, sends the shown message from their iMessage and confirms the masked sender
- **THEN** the sender is bound and the host continues to the conversation

#### Scenario: Skip to the web chat
- **WHEN** the host chooses **Set up here in web chat**
- **THEN** the conversation opens, nothing is bound, and the step does not open again in that browser

### Requirement: iMessage start before sign-in
The landing's iMessage start SHALL create a link attempt owned only by the browser that started it, through an HttpOnly cookie whose secret the service stores only as a keyed hash; starts SHALL be bounded per source address and across the service. The attempt SHALL record an arriving sender like any attempt and SHALL bind nothing. Google sign-in in the same browser SHALL give the attempt to the signed-in active host, and the binding SHALL follow only that host's confirmation of the masked sender in `/app`. Thyme's reply to the arriving code SHALL carry a sign-in link bound to the attempt and the sender, usable in any browser only while the attempt awaits confirmation; Google sign-in from it SHALL give the attempt to that host unless another host holds it, and SHALL NOT bind anything by itself.

#### Scenario: Start, sign in, confirm
- **WHEN** a visitor starts from iMessage, sends the message, signs in with Google and confirms the masked sender
- **THEN** the sender is bound to that host

#### Scenario: Another browser
- **WHEN** a different browser reads the iMessage start or signs in without the reply's sign-in link
- **THEN** it sees and claims nothing of the first browser's attempt

#### Scenario: Sign in from Thyme's reply
- **WHEN** the sender opens the sign-in link from Thyme's reply, signs in with Google and confirms the masked sender
- **THEN** the sender is bound to that host, and the link no longer works
- **AND** a tampered, expired, cancelled or used link, or one another host holds, claims nothing and leads back to the iMessage start

### Requirement: Fallback code
The browser SHALL NOT offer the fallback while the line cannot open a conversation with a number that has not written first (D16); an attempt the service already holds SHALL stay usable. When offered, it SHALL be a six-digit code sent by the line to a number the host enters, typed back into a protected field in the same browser together with **Confirm and link**. The browser SHALL never receive a sent code. Codes SHALL expire, resends SHALL be spaced and limited per attempt, per host and per line, and repeated wrong entries SHALL void the code. Each fallback send SHALL be counted as a new outbound conversation.

#### Scenario: Fallback within limits
- **WHEN** the host requests a code, receives it and types it before it expires
- **THEN** the number is bound to the host after **Confirm and link**

#### Scenario: Too many wrong entries
- **WHEN** the host enters a wrong code five times
- **THEN** the code is void and a new code must be requested within the limits

### Requirement: One binding per host and sender
A host SHALL have at most one active iMessage binding and a sender SHALL be bound to at most one host. Linking a new sender SHALL end the host's earlier binding. **Unlink** SHALL end the binding immediately without contacting the provider, suppress undispatched host-private messages for it, and leave the sender with no host authority.

#### Scenario: Unlink during a provider outage
- **WHEN** the host unlinks while Photon is unreachable
- **THEN** the binding ends at once and later messages from that sender expose nothing private and act on nothing

### Requirement: No session for unlinked or group senders
Only a direct message from the sender of an active binding whose host may host SHALL reach a discussion or a command. A direct message from any other sender SHALL receive at most one fixed reply per sender per day that points to the authenticated web workspace and reveals no host state. Group conversations, outbound echoes, reactions and messages from any platform other than iMessage SHALL receive nothing.

#### Scenario: Unlinked sender asks for details
- **WHEN** an unlinked sender asks for a host's requests
- **THEN** no session is created, no private data is returned and at most one fixed reply is sent that day

#### Scenario: Group conversation
- **WHEN** a linked host's sender writes in a group conversation that includes the line
- **THEN** nothing is processed and nothing is sent

#### Scenario: Message from another platform
- **WHEN** a message arrives through another platform enabled on the same Photon project, such as WhatsApp Business, even from a linked host's number
- **THEN** it is acknowledged, nothing is stored or processed and nothing is sent

### Requirement: Ordered receipts under backpressure
Receipts from one conversation SHALL be processed in arrival order. A receipt refused by an admission budget SHALL stay unprocessed and retry no earlier than one minute later, and no later receipt in that conversation SHALL overtake it. A retried receipt whose binding ended or whose host was suspended meanwhile SHALL reach the unlinked outcome without model work.

#### Scenario: Admission limit reached
- **WHEN** a linked host's message exceeds the host's admission budget
- **THEN** it creates no runtime input now, is retried later, and the host's next message waits behind it

### Requirement: Exact commands before any model turn
A linked host's whole-message commands SHALL be parsed and executed by the application before any model turn: listing and selecting requests, entering setup, reviewing, showing suggested changes, sharing or dismissing a suggestion, approving or declining a proposal, and confirming settings. Decisions SHALL name the exact current reference and run through the application command pipeline as the linked host with a retry identity derived from the receipt. A stale or unknown reference SHALL change nothing and return the current reference or a web link. Free text SHALL NOT decline, share or confirm anything, and SHALL approve only as the requirement on approval in the host's own words allows.

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

### Requirement: Approval in the host's own words
In a host's review of one request, the assistant SHALL be able to approve the current agreed proposal when the host clearly approves it in their own words in the linked iMessage or WhatsApp conversation, through the same application command as the web button and with the exact current version. It SHALL NOT approve for a message typed on the web, for a version that is no longer current, for a closed request, or when the reply asks for a change, adds a condition or asks a question. The awaiting-approval summary SHALL select its request so the host's next plain reply reaches it, and SHALL say the host may approve in their own words.

#### Scenario: Clear approval from iMessage
- **WHEN** a linked host replies "Looks good, book it" after the awaiting-approval summary
- **THEN** the current version is approved once and the booking proceeds as from the web

#### Scenario: Same words on the web
- **WHEN** the host types "Looks good, book it" in the request's discussion in `/app`
- **THEN** nothing is approved and the host is pointed to **Approve this proposal**

#### Scenario: Outdated version
- **WHEN** the assistant tries to approve a version that a newer proposal superseded
- **THEN** nothing is approved and the assistant names the current version

### Requirement: Shared discussions and replies
A linked host's free text SHALL become an accepted input of the discussion the host selected (setup by default, or the private review discussion of a selected request), marked as coming from iMessage, under the same redaction, admission, session index and model limits as web input; a retried receipt SHALL resolve to the same input. When that input's turn ends, the assistant's final text SHALL be sent to the linked conversation, and a turn that fails or yields no text SHALL send a fixed fallback pointing to the web. In `/app`, a discussion that holds messages from iMessage SHALL show them, each with the assistant's reply to it, on their own read-only tab beside the web chat, and the web chat SHALL show only the rest; the discussion, its session and the assistant's context stay shared. Only forwarding SHALL mark a message as coming from a messaging channel or email: a message posted from the web, by a host or a requester, SHALL lose any such marker it starts with.

#### Scenario: Private question
- **WHEN** the linked host selects a request and asks a question in text
- **THEN** the question appears in that request's private discussion in `/app`, on the request's iMessage tab, and the assistant's answer arrives in iMessage

#### Scenario: Web chat without iMessage messages
- **WHEN** the linked host answers a setup question in iMessage and then opens `/app`
- **THEN** the setup conversation shows a Web chat tab without that exchange and an iMessage tab with it, without its `[iMessage]` marker, and a message written on the Web chat tab continues the same setup discussion

#### Scenario: A marker typed on the web
- **WHEN** a host sends `[iMessage] Thirty minutes` from the web composer
- **THEN** the discussion receives `Thirty minutes` as a web message, and it stays on the Web chat tab

### Requirement: Summaries and outcomes
A host with an active binding SHALL receive in the linked conversation one summary per event when a request arrives, when a proposal awaits approval (with the exact approve and decline commands for its reference) and when a booking is confirmed, not confirmed or still pending. Each summary SHALL be recorded in the transaction of the change it reports and frozen from that event's own records; a summary for a proposal version that is no longer the latest SHALL NOT be sent.

#### Scenario: Proposal awaits approval
- **WHEN** the requester agrees to a proposal of a host with an active binding
- **THEN** one summary with the time, mode, place and the exact `approve` and `decline` commands is queued for the linked conversation

### Requirement: Truthful outbound delivery
Every outbound iMessage SHALL be a frozen record dispatched by a job behind the messaging-environment gate. A send whose result is lost SHALL be recorded uncertain and never repeated automatically; a refusal before sending MAY be retried within a bound. A delivery result SHALL NOT change request, proposal or booking state, and a delivery retry SHALL NOT create a booking. The latest failed or uncertain delivery SHALL be visible in the web workspace, where the host can continue.

#### Scenario: Simulated delivery failure
- **WHEN** a summary's send is refused or its result is lost
- **THEN** `/app` shows the failed or uncertain message and the request's state is unchanged

### Requirement: Setup over iMessage
A linked host SHALL be able to enter the shared setup discussion with `setup` and answer setup questions in plain text that update the same draft as the web workspace. Sign-in, Google consent and protected fields SHALL stay browser steps; Thyme SHALL send a link for connecting Google Calendar that returns the host to the conversation. Linking SHALL send a welcome by where the host stands: a ready host is told what Thyme can do, a host without a usable Calendar gets the Calendar link, and any other host gets the first setup question. Settings SHALL be saved only by the exact `confirm <ref>` command naming the current settings review, under the same checks as the web confirmation.

#### Scenario: Welcome into setup
- **WHEN** a host who is not ready confirms the received sender, after either entry
- **THEN** the welcome asks for Calendar or the first setup question, and a plain reply joins the shared setup discussion without `setup`

#### Scenario: Back from Google
- **WHEN** a linked host signs in with Google from Thyme's Calendar link
- **THEN** one message is queued to the linked conversation even if the sign-in is replayed, it does not claim Calendar was granted, and the browser returns to `/app`

#### Scenario: Stale settings review
- **WHEN** the host sends `confirm <ref>` after the draft changed
- **THEN** nothing is saved and the reply names the current review's reference

### Requirement: Optional contact card
After **Confirm and link** on iMessage, the service SHALL queue one native contact-card share in the linked conversation after the welcome, and the host SHALL be able to request another. The web SHALL show queued, accepted, failed or uncertain status, SHALL NOT report the card as delivered or saved, and SHALL offer no resend while uncertain. Saving the card SHALL grant nothing.

#### Scenario: Card after linking
- **WHEN** the host taps **Confirm and link** for an iMessage conversation
- **THEN** one contact-card share is queued to arrive after the welcome

#### Scenario: Contact card accepted
- **WHEN** the provider accepts the contact-card share
- **THEN** the card says to check iMessage and choose whether to save it

### Requirement: Read marks, typing and a tapback for thanks
For a linked host's text message on iMessage, the service SHALL mark the conversation read, and SHALL show typing while a reply that waits for a turn is prepared, as a best-effort signal that is never retried, never reported as a delivery, and that changes neither conversation routing nor delivery status. A message that is only thanks SHALL get a tapback instead of a reply and SHALL NOT start a turn; any other message, including "ok", "yes" and 👍, SHALL reach the conversation.

#### Scenario: Host writes a question
- **WHEN** a linked host sends a text message on iMessage that starts a turn
- **THEN** the conversation is marked read and shows typing while Thyme prepares the reply

#### Scenario: Host sends a command
- **WHEN** a linked host sends an exact command whose reply is immediate
- **THEN** the conversation is marked read, with no typing bubble

#### Scenario: Host says thanks
- **WHEN** a linked host sends only "thanks"
- **THEN** the message gets a tapback, and no turn starts and no text reply is sent

#### Scenario: Signal fails
- **WHEN** Photon refuses or loses the read mark or typing signal
- **THEN** the signal is final without retry, and the host's reply is sent as usual

### Requirement: iMessage record retention
Receipt text SHALL be cleared when its receipt is processed and receipts deleted 30 days after receipt. Outbound text SHALL be cleared when its message reaches a final state. Link attempts and ended bindings SHALL be deleted 30 days after they end.

#### Scenario: Cleanup
- **WHEN** the cleanup runs
- **THEN** receipts, outbound rows, link attempts and ended bindings past their period are deleted and active bindings remain

## ADDED Requirements

### Requirement: Telegram webhook
The service SHALL accept Telegram updates at `POST /telegram/webhook` only when the request's `X-Telegram-Bot-Api-Secret-Token` header equals the configured webhook secret, compared in constant time, and SHALL answer any other request with `401` and store nothing. An accepted `message`, `callback_query` or blocking `my_chat_member` update SHALL be stored as a receipt with channel `telegram`, keyed by its update ID, with one processing job, before the service answers `200`. A duplicate update ID SHALL be answered `200` with no new receipt or job. Every other update type SHALL be answered `200` with nothing stored. A failure to store SHALL be answered with an error so Telegram retries.

#### Scenario: Update stored before acknowledgment
- **WHEN** Telegram delivers a private text message with the correct secret header
- **THEN** one receipt with channel `telegram` and one job exist before the `200` answer

#### Scenario: Wrong or missing secret
- **WHEN** a request reaches the webhook without the secret header or with a different value
- **THEN** it is answered `401` and nothing is stored

#### Scenario: Redelivered update
- **WHEN** Telegram delivers the same update ID twice
- **THEN** the second delivery is answered `200` and creates no second receipt or job

### Requirement: Telegram sender identity
The Telegram sender SHALL be the numeric user ID of the update's `from`. An update SHALL count only when its chat is private, the chat ID equals the sender and the sender is not a bot. The sender SHALL be stored only as a keyed hash in a namespace separate from iMessage and WhatsApp senders, and sealed for replies. The service SHALL NOT request or store a Telegram user's phone number. The display name shown for confirmation SHALL come from the update's `first_name` and `username`, never from message text.

#### Scenario: Group message
- **WHEN** a message reaches the bot from a group, supergroup or channel
- **THEN** it creates no receipt, no link and no reply

#### Scenario: Same person on two channels
- **WHEN** one person writes from iMessage and from Telegram
- **THEN** the two senders have different hashes and neither one's binding applies to the other

### Requirement: Linking Telegram by a start link
An authenticated active host SHALL be able to create a Telegram link attempt whose one-time code, expiry and limits are those of the iMessage channel. **Connect Telegram** SHALL create the code and then open `https://t.me/<bot username>?start=<code>`. On a computer it SHALL also show the link as a QR code and a copy action. Only a private Telegram message whose text is `/start <code>` or the code, for the pending unexpired code, SHALL record its sender for confirmation. The sender SHALL be bound only after the host confirms the shown Telegram name in the authenticated browser. A code arriving on another channel SHALL void the attempt. The bot SHALL NOT send the first message, and a linking message SHALL never reach the model or a transcript.

#### Scenario: Link from a phone
- **WHEN** the host taps **Connect Telegram**, taps **Start** in Telegram and confirms their Telegram name in the browser
- **THEN** that Telegram account is bound to the host and the bot's first message is the welcome in the chat the host started

#### Scenario: Start without a code
- **WHEN** someone opens the bot and taps **Start** with no code
- **THEN** they get the unlinked-sender reply pointing to `findmeatime.com/app` and nothing is bound

#### Scenario: Code sent from the wrong app
- **WHEN** the code of a Telegram attempt arrives in iMessage
- **THEN** nothing is bound and the attempt is voided

### Requirement: Channel offered by device with Telegram
The linking card, the link step after sign-in and the landing's start before sign-in SHALL offer the configured channels by device. Android SHALL get WhatsApp when configured, with a choice to use Telegram instead, and Telegram otherwise. iPhone, iPad and Mac SHALL get iMessage with a choice to use each other configured channel instead. Other devices SHALL first ask which app the host uses on their phone, among the configured channels. A channel that is not configured SHALL NOT be offered.

#### Scenario: Android without WhatsApp
- **WHEN** an Android host opens the link step while WhatsApp is not configured
- **THEN** it offers **Connect Telegram** and no WhatsApp or iMessage action

#### Scenario: iPhone host
- **WHEN** an iPhone host opens the linking card
- **THEN** it offers **Connect iMessage** with **Use Telegram instead**

### Requirement: One messaging channel across three
A host SHALL have at most one active messaging binding across iMessage, WhatsApp and Telegram. Before confirmation the browser SHALL name the link being replaced. Confirmation SHALL end the earlier binding in the same transaction and suppress messages queued for it that have not been dispatched. No summary SHALL go to two channels.

#### Scenario: iMessage host links Telegram
- **WHEN** a host linked on iMessage confirms a Telegram sender
- **THEN** the iMessage binding ends, later summaries go only to Telegram, and the iMessage sender gets the unlinked-sender reply if it writes again

### Requirement: Decision buttons bound to a proposal
A Telegram summary that asks the host to decide SHALL carry buttons whose callback data names one request and proposal version. A button tap SHALL be admitted only from the bound sender, SHALL be parsed into the exact command its data names and never from its label, and SHALL run through the same command path as the typed command. A tap naming a version that is not current SHALL decide nothing and SHALL show the current proposal. Every tap SHALL be answered so Telegram stops waiting. When a proposal is decided, withdrawn or superseded, the service SHALL remove the buttons from the messages that showed it, within Telegram's edit limit.

#### Scenario: Approve from a button
- **WHEN** the bound host taps **Approve** under the current agreed proposal
- **THEN** that version is approved once, exactly as `approve <ref>-<version>`, and the buttons are removed

#### Scenario: Stale button
- **WHEN** the host taps **Approve** under a proposal that has since been revised
- **THEN** nothing is approved and the bot answers that the proposal changed and shows the current one

#### Scenario: Forwarded button
- **WHEN** a message with buttons reaches another Telegram user and they tap **Approve**
- **THEN** nothing is decided and they get the unlinked-sender answer

### Requirement: Telegram conversation behavior
The bot SHALL accept every exact command with or without a leading `/` and a trailing bot mention, and SHALL register `requests`, `review`, `help` and `stop` in its command menu. It SHALL show a typing indicator while the assistant composes a reply. It SHALL send notices that need no decision without notification sound and every summary that asks for a decision with it. It SHALL send plain text with no formatting mode. Commands, references, approval in the host's own words, forwarding with a `[Telegram]` transcript prefix, summaries, setup over chat, admission, ordering, retention and production-only messaging SHALL behave as on iMessage. No messaging window or template SHALL apply.

#### Scenario: Command menu
- **WHEN** the host taps `/requests` in the bot menu
- **THEN** they get the same open-request list as typing `requests`

#### Scenario: Requester text with markup
- **WHEN** a requester's message containing HTML or Markdown is summarized to the host
- **THEN** it reaches Telegram as literal text with no rendered formatting or link

### Requirement: Telegram delivery outcomes
The outbox SHALL record Telegram sends with the iMessage channel's states and SHALL never resend an uncertain send. A refusal because the user blocked or deactivated the bot SHALL be final and SHALL end the binding as `stop` does. A rate limit SHALL be retried after the delay Telegram names. Consecutive sends to one chat SHALL be spaced at least one second apart, and text longer than Telegram's limit SHALL be split into ordered messages. A blocking update from Telegram SHALL end the binding the same way.

#### Scenario: Host blocks the bot
- **WHEN** a send to a linked host fails because they blocked the bot
- **THEN** the row is rejected, the binding ends, queued rows are suppressed and `/app` shows Telegram as not linked

#### Scenario: Rate limited
- **WHEN** Telegram answers a send with a rate limit and a retry delay
- **THEN** the row is retried after that delay and sent once

### Requirement: Telegram privacy notice
Before **Confirm and link**, the browser SHALL say that Telegram keeps bot chats on its servers and that request summaries will be sent there. The privacy policy SHALL name Telegram as a processor for hosts who link it. Unlinking, `stop` and blocking the bot SHALL each end the binding and every later message.

#### Scenario: Notice before linking
- **WHEN** the browser shows a Telegram sender for confirmation
- **THEN** the Telegram storage sentence is shown before **Confirm and link**

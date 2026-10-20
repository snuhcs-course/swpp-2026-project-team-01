## Purpose

Let a host prove they hold an iMessage number and bind it to their host account, so later iMessage features can trust the sender. Thyme texts the number, and the host replies with a short number shown only in their browser.

## ADDED Requirements

### Requirement: Phone check by reply
A signed-in host SHALL be able to submit a mobile number in E.164 form. The service SHALL accept the request without waiting for the provider, text that number on iMessage from its line, and show a 2-digit number in the browser once the text is out. The text SHALL NOT contain the number to send back. The number SHALL link to the host only when a reply arrives from that exact sender, in the direct conversation the service opened, whose trimmed body is a currently valid number. No further browser confirmation SHALL be required.

#### Scenario: Matching reply
- **WHEN** a signed-in host enters a number, Thyme's text arrives, and the host replies with the number shown on screen within 5 minutes
- **THEN** the connection becomes `connected` and the browser shows that the number is connected

#### Scenario: Reply from another number
- **WHEN** the correct number is sent to the line from a different phone or from a group conversation
- **THEN** nothing is linked and the check is unchanged

#### Scenario: Number in the text
- **WHEN** the outbound text is inspected
- **THEN** it does not contain the number shown in the browser

#### Scenario: Number linked to another host
- **WHEN** a host submits a number already linked to a different host
- **THEN** the request is refused as taken and no text is sent

### Requirement: Check limits
Each number SHALL stay valid for 5 minutes after its text goes out. A request for another text SHALL never be refused for being early: the service SHALL hold it and send no sooner than 1 minute after the previous text. Earlier numbers SHALL stay valid until they expire or a wrong reply arrives. After 5 texts within 5 minutes the service SHALL allow no more for now and report `retryEligibleAt` as null.

#### Scenario: Early resend
- **WHEN** the host asks for another text 20 seconds after the first
- **THEN** the request succeeds with status `pending`, and the second text goes out no sooner than 1 minute after the first

#### Scenario: Earlier number after resend
- **WHEN** a second text is out and the host replies with the number from the first, before it expires
- **THEN** the number is connected

#### Scenario: Expired number
- **WHEN** a reply with the right number arrives after 5 minutes
- **THEN** the check reports `expired` and nothing is linked

#### Scenario: Too many texts
- **WHEN** a sixth text is requested within 5 minutes of the first
- **THEN** no text is sent and `retryEligibleAt` is null

### Requirement: Wrong replies
A reply in the check's conversation that matches no valid number SHALL invalidate every number issued so far, issue a new one different from the last, keep `expiresAt` unchanged, and increase `wrongReplies`. The third wrong reply SHALL fail the check with `too_many_wrong_replies` and set `retryEligibleAt` 5 minutes ahead. A retry after that time SHALL send a new text with a new number and reset the count.

#### Scenario: One wrong reply
- **WHEN** the host replies with a number that is not valid
- **THEN** the browser shows a new number, says the reply did not match, and the previous number no longer connects

#### Scenario: Lockout
- **WHEN** a third wrong reply arrives
- **THEN** the check is `failed` with `too_many_wrong_replies`, the browser offers **Connect again** only after `retryEligibleAt`, and **Contact us**

### Requirement: Failures and putting the phone off
A failed send SHALL report a reason: `non_imessage_recipient` when the number cannot receive iMessage, otherwise the provider category. When no more texts are allowed, the browser SHALL put the phone off and continue without it. When sending kept failing, it SHALL also offer to notify the host when texting works again: by iMessage to the number, and by email when the host has a linked Google address. Web setup SHALL remain available in every failure.

#### Scenario: Number without iMessage
- **WHEN** the provider reports that the number does not use iMessage
- **THEN** the check is `failed` with `non_imessage_recipient`, no SMS or RCS is sent, and the host can enter another number or continue on the web

#### Scenario: Provider down
- **WHEN** sends fail until no more texts are allowed
- **THEN** the browser explains that texting is down, offers **Text me when it's back** and, to a host with a Google address, **Email me when it's back**, and continues to the web chat

### Requirement: Phone sign-up and sign-in
On the iMessage start, a visitor without a session SHALL be able to run the same check. A matching reply for a number that no host holds SHALL create exactly one active host account bound to that number and sign the browser in. A matching reply for a number a host already holds SHALL sign that host in. Entering a number SHALL NOT by itself create an account, sign anyone in, or reveal whether a host holds the number; only a matching reply SHALL. A phone host SHALL be able to link a Google identity later for Calendar access. Sign-up and sign-in by phone SHALL NOT publish a public booking profile.

#### Scenario: Number entered without a reply
- **WHEN** a visitor enters a number on `/?flow=imessage` and no matching reply arrives before the check expires or fails
- **THEN** no account is created, the browser stays signed out, and the response is the same whether or not a host holds the number

#### Scenario: First check on the iMessage start
- **WHEN** a visitor enters a number no host holds on `/?flow=imessage` and replies with the shown number
- **THEN** one active host account is created for that number, the browser is signed in, and onboarding continues in iMessage

#### Scenario: Returning phone host
- **WHEN** the same number completes the check again from another browser
- **THEN** that host is signed in and no second account is created

#### Scenario: Linking Google later
- **WHEN** a phone host completes Google sign-in from their session
- **THEN** the Google identity and its granted Calendar scopes attach to the same host account

### Requirement: Durable send and receipt
Submitting or retrying SHALL record the connection and the outbound text in one transaction. The service SHALL store the conversation and line identity before sending. A send whose result is unknown SHALL be `uncertain`, and a matching reply SHALL still connect it. Inbound events SHALL be verified and persisted before acknowledgment and applied at most once per provider message. The reply that links a number SHALL be consumed before any model turn and SHALL NOT appear in a transcript or model context.

#### Scenario: Restart after acknowledgment
- **WHEN** the service restarts after acknowledging a matching reply and before applying it
- **THEN** the reply is applied after restart and the number is connected once

#### Scenario: Duplicate webhook
- **WHEN** the provider delivers the same reply twice
- **THEN** it is applied once and `wrongReplies` is unchanged by the duplicate

#### Scenario: Lost send result
- **WHEN** the send times out after it began and the host replies with the shown number
- **THEN** the number is connected

### Requirement: Skipping and unlinking
Linking SHALL be optional. Before entering a number, the host SHALL be able to continue in the web chat. A linked host SHALL be able to unlink the number; after unlinking, that sender SHALL receive no private state and SHALL be able to start a new check.

#### Scenario: Skip
- **WHEN** a host chooses **Set up here in web chat** on the number step
- **THEN** the web chat opens and setup proceeds without a number

#### Scenario: Unlink
- **WHEN** a linked host unlinks the number and then texts the line
- **THEN** the sender is treated as unlinked

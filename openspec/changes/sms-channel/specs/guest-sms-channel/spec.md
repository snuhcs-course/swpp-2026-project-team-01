## Purpose

Let a guest follow a request by text message (SMS): link the request to their number from the booking page or their agent after explicit SMS consent, route their texts to that request's conversation, and stop cleanly when they opt out.

## ADDED Requirements

### Requirement: Guest SMS linking
Where SMS is configured, the booking page's waiting card SHALL offer **Get updates by text**. It SHALL show the SMS consent checkbox unticked, with the consent text, the privacy and terms links, the sentence that SMS is not end-to-end encrypted and may incur message and data rates, and **Get my code**, disabled until the box is ticked. **Get my code** SHALL create a request-owned one-time link code with the same validity, limits and replacement as a guest iMessage code, record the consent text version and the time the request was received, and refuse a request without the current version. It SHALL show the code with **Open Messages**, which opens Messages addressed to the SMS number with the code, or on a computer the number, the code, **Copy** and a QR code. It SHALL ask for no number. Only the code arriving by SMS SHALL complete the attempt, and it SHALL bind the sender to the request on arrival; a code for a guest SMS attempt arriving on another channel SHALL void it. A request SHALL have at most one active guest binding across iMessage, WhatsApp, Telegram and SMS. A bound guest SHALL get an SMS consent record as hosts do.

#### Scenario: Link by text from the booking page
- **WHEN** the guest presses **Get updates by text**, ticks the box, presses **Get my code** and sends the prefilled code
- **THEN** the request has one active SMS guest binding, the card shows the masked number with **Unlink**, and the welcome is queued on SMS

#### Scenario: No consent, no code
- **WHEN** the guest has not ticked the box
- **THEN** **Get my code** is disabled and no attempt exists

#### Scenario: Guest code on another channel
- **WHEN** a guest SMS attempt's code arrives on iMessage
- **THEN** the attempt is voided and nothing is bound

#### Scenario: Replaces another guest channel
- **WHEN** a guest linked on Telegram links the same request by SMS
- **THEN** the Telegram guest binding ends and later notices go only to SMS

### Requirement: Guest SMS link through the agent
The requester agent's `start_updates_link` SHALL accept the SMS channel without a number and return a connect link bound to the request and the SMS channel, with no attempt yet. That page SHALL show the consent checkbox and **Get my code**, create the attempt only when the box is ticked, and after the code arrives show that the number is linked.

#### Scenario: Agent starts an SMS link
- **WHEN** the requester agent calls `start_updates_link` with the SMS channel
- **THEN** the result carries a connect link and no attempt exists until the guest ticks the box on that page

### Requirement: Guest SMS routing
A text from a sender with an active SMS guest binding SHALL be routed as a guest iMessage is, and its text SHALL enter the request's requester discussion with the `[SMS] ` prefix. Replies and the request's notices, including the agreement notice, SHALL go out by SMS as plain text, under the SMS limits.

#### Scenario: Guest texts a reply
- **WHEN** a linked guest texts the SMS number
- **THEN** the requester discussion holds one input starting with `[SMS] ` and the reply is queued on SMS

### Requirement: Guest SMS opt-out
An opt-out keyword from a guest's number, `stop` or `unlink`, or a send that Photon refuses because the guest opted out, SHALL end every active SMS binding of that sender, guest and host alike, and suppress their unsent messages, with no reply from the service. `HELP`, `INFO` and `START` SHALL get no reply from the service.

#### Scenario: Guest texts STOP
- **WHEN** a linked guest texts `STOP`
- **THEN** the guest's SMS bindings end, unsent guest messages are suppressed, and the service sends nothing

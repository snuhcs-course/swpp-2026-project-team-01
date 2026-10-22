## ADDED Requirements

### Requirement: Requests started by email
An authenticated email that starts a new thread in the product inbox and names a ready host's handle in its subject SHALL create one request for that host, identified with the sender's display name and address as an unconfirmed contact, the host's timezone and the message's language, under the same creation bounds as a web start counted per sender address. Creation SHALL send the creation email with the booking link and the confirmation link to that address and SHALL bind the thread to the request. An email naming no ready host SHALL create nothing.

#### Scenario: Requester starts by email
- **WHEN** an authenticated sender writes a new email whose subject names a ready host
- **THEN** one request exists for that host with the sender's address as its unconfirmed contact, the creation email goes to that address, and the thread is bound to the request

#### Scenario: Unknown host
- **WHEN** a new email names no ready host
- **THEN** no request is created and the thread receives one fixed reply

### Requirement: Continue by email on the booking page
The booking page SHALL offer **Continue by email** once the contact address is confirmed. Creating a link SHALL show a one-time code, the product inbox and its expiry, recoverable after a reload while pending; **Check email link** SHALL refresh the status; **Unlink email** SHALL end the binding at once without a provider call. An uncertain command SHALL offer **Retry same linking action** with the same retry identity. Email SHALL never be required: the web conversation SHALL stay available.

#### Scenario: Link before confirmation
- **WHEN** a requester whose contact is not confirmed opens **Continue by email**
- **THEN** the card asks them to confirm their address first and creates no code

#### Scenario: Unlink during an outage
- **WHEN** the requester presses **Unlink email** while AgentMail is unreachable
- **THEN** the binding ends and a later message in that thread is not forwarded

### Requirement: Old options by email
An email in a bound thread SHALL reach the request's discussion as conversation text only. It SHALL NOT select a candidate, record agreement or approval, or create another request.

#### Scenario: Reply selects an old option
- **WHEN** a requester replies to an earlier thread message choosing an option of a superseded proposal
- **THEN** no agreement or booking is recorded, no second request exists, and the reply directs them to the current proposal at the booking link

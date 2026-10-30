## ADDED Requirements

### Requirement: Revised request after a decline or an expiry
When a request closed as declined or expired, the guest's next message in its bound email thread or iMessage conversation SHALL create one revised request to the same host instead of reopening the closed one, only while the host is active and ready, as the only revised request of that closed request, while the chain from the first request holds fewer than 10 requests, and within the request creation bounds counted per keyed contact hash. The revised request SHALL carry over purpose, duration, mode, place or link plan, travel mode, timezone, language, requester name and contact (with its confirmed state when the address is unchanged), and SHALL carry no windows, evaluations, proposals, agreements or approvals. It SHALL get a new booking link sent by the creation email, the channel binding SHALL move to it, and its discussion SHALL begin with an authored summary of the closed request that contains no host-private data, followed by the guest's message. Booked and withdrawn requests SHALL keep the closed notice.

#### Scenario: Reply after a decline
- **WHEN** the host declined and the guest replies in the bound email thread
- **THEN** one revised request exists, linked to the declined one, the thread reaches its discussion, and the declined request stays declined

#### Scenario: Second reply
- **WHEN** a revised request already exists for that closed request and the guest writes again in the old conversation
- **THEN** the message goes to the revised request's discussion and no further request is created

#### Scenario: Chain full
- **WHEN** the declined request is the tenth in its chain and the guest replies
- **THEN** the channel receives one fixed text and nothing is created

#### Scenario: Host unavailable
- **WHEN** the host was suspended or is no longer ready
- **THEN** the channel receives one fixed text and nothing is created

#### Scenario: Retried receipt
- **WHEN** the receipt that created a revised request is processed again
- **THEN** no second request, booking link or creation email is created

#### Scenario: Booked request
- **WHEN** the guest writes in the conversation of a booked request
- **THEN** the conversation receives at most one closed notice and no request is created

### Requirement: Requester changes until host approval
While a request awaits the host's approval and has no booking, the requester SHALL be able to withdraw their agreement with **Change**, which SHALL return the request to negotiating with a new revision, after which details and times SHALL be changeable and a new agreement SHALL need a new proposal version. A host approval and a change SHALL be serialized: whichever commits first SHALL stand, and the other SHALL be refused without creating a booking or a second agreement.

#### Scenario: Change before approval
- **WHEN** the requester presses **Change** on the agreed time while the host has not approved
- **THEN** the request is negotiating, the candidate times reopen, and an approval sent for the earlier version is refused as stale

#### Scenario: Approval first
- **WHEN** the host approves before the requester's change commits
- **THEN** the booking proceeds and the change is refused with the current status

### Requirement: Host sees the revised request's origin
The host's view and iMessage summary of a revised request SHALL state that it follows their earlier decline or the earlier request's expiry, with the earlier request's reference.

#### Scenario: New request summary
- **WHEN** a revised request is created for a linked host
- **THEN** the host's new-request summary names the earlier request's reference and its outcome

### Requirement: Booking page iMessage controls
The booking page SHALL offer **Get updates in iMessage** while the request is open, SHALL show the arrived masked sender with **Confirm and link**, and SHALL offer **Unlink iMessage** while a guest binding is active, each as one card in the thread, with keyboard access and at phone width.

#### Scenario: Keyboard linking
- **WHEN** a keyboard-only guest at 390 px links iMessage with the loopback stand-in
- **THEN** each step is reachable and the linked state is announced

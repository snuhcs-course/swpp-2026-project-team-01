## MODIFIED Requirements

### Requirement: Protected request continuation
The identifier in `/booking/[bookingId]` SHALL be a server-generated random UUID and SHALL be the requester's only credential for that request: holding the link authorizes exactly that request, with no separate token, cookie exchange or URL fragment. The service SHALL look the identifier up only by its hash, SHALL NOT derive it from any guessable value and SHALL keep it out of referrers, search indexes, shared calendar descriptions and full request logs. Any recoverable copy SHALL be kept only sealed with the application's encryption key and SHALL be opened only to resend the link to the request's verified contact or to return the requester's own browser to the request after Google consent. A link SHALL expire within thirty days of request creation and SHALL lose mutation and OAuth authority on request closure, after which it SHALL permit only a minimal terminal status and confirmed-booking receipt read, excluding private discussion and historical provider context. A lost link SHALL be resent only to the request's previously verified contact.

#### Scenario: Unknown or expired identifier
- **WHEN** a booking link with an unknown, malformed or expired identifier is opened
- **THEN** the destination shows the generic unavailable view without revealing whether a request exists

#### Scenario: Unverified resend contact
- **WHEN** a caller asks for a lost link using an unverified email claim
- **THEN** no booking link is sent

#### Scenario: Final receipt after asynchronous booking
- **WHEN** a valid unexpired booking link is opened after the request closes
- **THEN** only its final status and confirmed booking receipt are readable, and mutation and new OAuth actions are rejected

#### Scenario: Database read without the key
- **WHEN** someone reads the stored booking-link records without the application's encryption key
- **THEN** no usable booking link can be rebuilt from them

### Requirement: Bounded requester contact verification
A currently authorized requester SHALL explicitly request and enter a code sent to the request's current email before that address is trusted for attendee use, except that an address Google reports as verified for the requester's signed-in identity SHALL be filled in and trusted without a code. A code SHALL be six digits, SHALL expire 10 minutes after issue, SHALL permit at most five failed guesses, and SHALL be invalidated by a new code, contact change or closure. Sending SHALL wait at least 60 seconds after the previous code for the same request and SHALL allow at most 5 codes per request and 10 codes per recipient address in any rolling hour.

#### Scenario: Google-verified address
- **WHEN** the requester continued with Google and Google reports the address as verified
- **THEN** the address is filled in and treated as the verified contact without a code, and only a changed address requires one

#### Scenario: Correct current code
- **WHEN** the requester submits a current unexpired code for the same request and contact
- **THEN** only that contact becomes verified, with no login session, agreement, host approval or booking

#### Scenario: Attempts exhausted
- **WHEN** five distinct invalid confirmation commands are submitted for a code
- **THEN** further confirmation is denied, including a later correct guess, until an allowed new challenge is issued

#### Scenario: Changed contact or authority
- **WHEN** the contact or lifecycle changes after a code is issued
- **THEN** the old code cannot verify the new contact or regain authority

#### Scenario: Expired code
- **WHEN** a correct code is submitted more than 10 minutes after it was issued
- **THEN** verification is denied and the requester is offered **Request a new code**

#### Scenario: Cooldown and hourly limit
- **WHEN** a requester asks for another code within 60 seconds of the last one, or after 5 codes for the request or 10 for the address in the past hour
- **THEN** no code or email is created and the card says when a new code can be requested

## ADDED Requirements

### Requirement: Bounded request creation
Creating a request on a public host page SHALL require a ready host and SHALL be bounded to 5 requests per source address in any rolling hour and 20 in any rolling day, 30 new requests per host in any rolling day, and 500 across the service in any rolling day. Source addresses SHALL be stored only as keyed hashes. Past a bound, the service SHALL create nothing and SHALL return generic temporary-limit feedback that discloses neither the host's existing requests nor which bound applied. No model work SHALL run on a public host page before a request exists.

#### Scenario: Source over its bound
- **WHEN** a sixth request is attempted from one source address within an hour
- **THEN** no request, booking link or conversation is created and the page shows a temporary-limit message

#### Scenario: Unavailable host
- **WHEN** a requester attempts to create a request for an unknown, unready or suspended host
- **THEN** nothing is created and the response is the same neutral unavailable result as the public page

#### Scenario: Exact creation retry
- **WHEN** a creation command is retried with the same retry identity after its response was lost
- **THEN** the same request and booking link are returned and no bound is charged again

### Requirement: Online meeting link plan
A proposal for an online meeting SHALL record its link plan as either a Google Meet conference created with the event in the host's booking destination, offered only when that calendar supports Google Meet, or an `https:` link the requester supplied. Requester agreement and host approval SHALL cover the recorded plan, and a change of plan SHALL create a new proposal version. When neither plan is available, the request SHALL ask the requester for a meeting link instead of creating a proposal.

#### Scenario: Destination supports Meet
- **WHEN** an online request is evaluated and the host's booking destination allows Google Meet
- **THEN** the proposal shows that a Google Meet link will be created when the meeting is booked

#### Scenario: Requester supplies a link
- **WHEN** the requester applies a reviewed `https:` meeting link
- **THEN** the proposal shows that link, and agreement covers it

#### Scenario: No plan available
- **WHEN** the destination does not allow Google Meet and the requester has supplied no link
- **THEN** no proposal is created and the requester is asked for a meeting link

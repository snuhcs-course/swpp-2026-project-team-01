## MODIFIED Requirements

### Requirement: Protected request continuation
The identifier in `/booking/[bookingId]` SHALL be a server-generated random UUID and SHALL be the requester's only credential for that request: holding the link authorizes exactly that request, with no separate token, cookie exchange or URL fragment. The service SHALL look the identifier up only by its hash, SHALL NOT derive it from any guessable value and SHALL keep it out of referrers, search indexes, shared calendar descriptions and full request logs. Any recoverable copy SHALL be kept only sealed with the application's encryption key and SHALL be opened only to email the link to the request's contact on creation or contact change, to resend it to the request's verified contact, to recover an exact creation retry, or to return the requester's own browser to the request after Google consent. A link SHALL expire within thirty days of request creation and SHALL lose mutation and OAuth authority on request closure, after which it SHALL permit only a minimal terminal status and confirmed-booking receipt read, excluding private discussion and historical provider context, except that a booked request's link SHALL keep the requester's conversation with the assistant, so the requester can ask about, cancel or change the meeting on the web through the assistant's booking tools. A lost link SHALL be resent only to the request's previously verified contact.

#### Scenario: Unknown or expired identifier
- **WHEN** a booking link with an unknown, malformed or expired identifier is opened
- **THEN** the destination shows the generic unavailable view without revealing whether a request exists

#### Scenario: Unverified resend contact
- **WHEN** a caller asks for a lost link using an unverified email claim
- **THEN** no booking link is sent

#### Scenario: Final receipt after asynchronous booking
- **WHEN** a valid unexpired booking link is opened after the request was declined, withdrawn, expired or cancelled
- **THEN** only its final status is readable, and mutation and new OAuth actions are rejected

#### Scenario: Booked meeting keeps its conversation
- **WHEN** a valid unexpired booking link is opened after the meeting was booked
- **THEN** the page shows the confirmed receipt and the requester's conversation with an open composer, and the requester can ask the assistant to cancel or change the meeting there, while the request's other mutations and new OAuth actions are rejected

#### Scenario: Database read without the key
- **WHEN** someone reads the stored booking-link records without the application's encryption key
- **THEN** no usable booking link can be rebuilt from them

## ADDED Requirements

### Requirement: Guest composer availability
The booking page composer SHALL be locked, saying the step above must be finished first, only before the fixed steps first hand the guest over to the assistant and only while one of those steps is open. The guest SHALL count as handed over once the Calendar step was settled, the request has a purpose, or the guest has written in the request's conversation, and SHALL stay handed over when the Calendar step reopens. A Calendar step that reopens after the handover SHALL appear where the thread is now, with the assistant's line saying it is open again and what to do, while the composer stays usable. A request that has ended while its page is open SHALL close the composer with the reason.

#### Scenario: Before the handover
- **WHEN** an identified guest opens the booking page with the Calendar step not yet settled and has not written to the assistant
- **THEN** the composer is locked and says to finish the step above

#### Scenario: Calendar step reopens after the handover
- **WHEN** a guest who has been writing to the assistant signs in with Google again and grants Calendar, or turns off manual availability
- **THEN** the Calendar card opens at the end of the thread under the assistant's line about it, and the composer stays usable

#### Scenario: No step to finish
- **WHEN** no fixed step is open
- **THEN** the composer is not locked

#### Scenario: Request ended on an open page
- **WHEN** the request reaches its deadline while its booking page is open
- **THEN** the composer is closed and says the request expired

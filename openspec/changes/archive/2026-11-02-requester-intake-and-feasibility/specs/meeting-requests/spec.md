## MODIFIED Requirements

### Requirement: Protected request continuation
The identifier in `/booking/[bookingId]` SHALL be a server-generated random UUID and SHALL be the requester's only credential for that request: holding the link authorizes exactly that request, with no separate token, cookie exchange or URL fragment. The service SHALL look the identifier up only by its hash, SHALL NOT derive it from any guessable value and SHALL keep it out of referrers, search indexes, shared calendar descriptions and full request logs. Any recoverable copy SHALL be kept only sealed with the application's encryption key and SHALL be opened only to email the link to the request's contact on creation or contact change, to resend it to the request's verified contact, to recover an exact creation retry, or to return the requester's own browser to the request after Google consent. A link SHALL expire within thirty days of request creation and SHALL lose mutation and OAuth authority on request closure, after which it SHALL permit only a minimal terminal status and confirmed-booking receipt read, excluding private discussion and historical provider context. A lost link SHALL be resent only to the request's previously verified contact.

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

## REMOVED Requirements

### Requirement: Bounded requester contact verification
**Reason**: Replaced by optional contact confirmation (D3). A six-digit code before trusted attendee use added a step for little gain, since host approval already stops invitation spam.
**Migration**: No implementation exists. Contact trust comes from "Optional contact confirmation" and the Google-verified address.

### Requirement: Recoverable contact verification commands
**Reason**: There are no verification commands; the confirmation email's resend follows "Recoverable confirmation email".
**Migration**: None; nothing was implemented.

### Requirement: Honest verification delivery
**Reason**: Replaced by "Recoverable confirmation email", which keeps the same durable, frozen Cloudflare delivery and truthful states.
**Migration**: None; nothing was implemented.

## ADDED Requirements

### Requirement: Optional contact confirmation
Confirming the requester's contact address SHALL be optional, and no scheduling step SHALL wait on it: intake, candidates, agreement and later host approval, invitation and status emails SHALL proceed with an unconfirmed address. When a request is created, and whenever its contact address changes, the service SHALL email that address the booking link and a single-use confirmation link. Opening the confirmation link SHALL confirm nothing by itself and SHALL show a **Confirm this address** button; pressing it SHALL confirm that address only while it is still the request's contact and the request is open; a newer email, a contact change or closure SHALL void earlier confirmation links. An address Google reports as verified for the requester's identity SHALL count as confirmed without the email. A confirmed address is the request's verified contact wherever this contract names one, and the host SHALL see whether the contact is confirmed. Confirmation SHALL create no login session, agreement, approval or booking.

#### Scenario: Creation email
- **WHEN** a requester continues without Google and the request is created
- **THEN** one email goes to the typed address with the booking link and a confirmation link, and the requester can go on scheduling before opening it

#### Scenario: Confirmation link opened
- **WHEN** the recipient opens an unused confirmation link for the request's current contact and presses **Confirm this address**
- **THEN** that address becomes confirmed and nothing else about the request changes

#### Scenario: Link fetched without a press
- **WHEN** a mail scanner fetches the confirmation link
- **THEN** the address stays unconfirmed

#### Scenario: Link after a contact change
- **WHEN** the requester changes the contact address and the old confirmation link is opened
- **THEN** neither address is confirmed by it, and the new address receives its own email

#### Scenario: Google-verified address
- **WHEN** the requester continued with Google and Google reports the address as verified
- **THEN** the address counts as confirmed and the creation email carries no confirmation link

#### Scenario: Unconfirmed agreement
- **WHEN** a requester whose address is unconfirmed agrees to the current proposal
- **THEN** the agreement is recorded and the host sees that the contact is unconfirmed

### Requirement: Recoverable confirmation email
Sending the creation email again SHALL wait at least 60 seconds after the previous one for the same request and SHALL allow at most 5 per request and 10 per recipient address in any rolling hour, and 1,000 across the service in any rolling day. These bounds SHALL apply to every creation email, including the one request creation sends and those a contact change sends, and a contact change past a bound SHALL be rejected with nothing changed. Repeated send commands SHALL preserve their logical identity across lost responses, so a duplicate creates no second email. Delivery SHALL use durable Cloudflare messages with frozen sender and content and a recipient recheck; possible dispatch SHALL prevent automatic resending. The requester SHALL have labeled keyboard-operable controls and truthful queued, sent, rejected, uncertain and confirmed states, and browser reload SHALL recover the current status.

#### Scenario: Too soon or too many
- **WHEN** the requester asks to send the email again within 60 seconds, or past an hourly or daily bound
- **THEN** no email is created and the card says when it can be sent again

#### Scenario: Contact changed too often
- **WHEN** the requester changes the contact address again within 60 seconds of the last creation email
- **THEN** the change is rejected with a temporary-limit result, the contact stays as it was and no email is created

#### Scenario: Response lost after commit
- **WHEN** a send command commits but its response is lost
- **THEN** retrying the same command recovers its saved status without another email

#### Scenario: Uncertain email
- **WHEN** the send response is lost after possible provider acceptance
- **THEN** the email is not sent again automatically and the card shows that delivery is uncertain

### Requirement: Continuous guest conversation
A ready host's public page SHALL offer an assistant conversation from the guest's first message, and that conversation SHALL continue in the same thread and assistant session until the request closes. The first message SHALL create a draft request that is invisible to the host, bound to one browser tab by its booking link kept outside the address bar, limited to 30 messages and deleted 24 hours after creation unless the guest is identified. Drafts SHALL be bounded to 5 per source address in any rolling hour and 20 in any rolling day. A request whose contact is unconfirmed and that holds no live Google identity, drafts included, SHALL have at most USD 3 of model allowance per 24 hours, counted toward a USD 50 anonymous allowance across the service; once its contact is confirmed or a Google identity is held, the usual request allowance SHALL apply, counting what it already spent. Candidate evaluation, candidate selection and agreement SHALL require the guest to be identified. Identification SHALL keep the same thread and session, SHALL move the address bar to the booking link without reloading the page, and SHALL send the creation email.

#### Scenario: Visitor asks for the host's calendar
- **WHEN** a visitor on the public page asks the assistant for the host's free times or calendar
- **THEN** no tool can read them, nothing is read, and the assistant answers within the requester projection

#### Scenario: Times before identification
- **WHEN** a guest who has not given a name and email asks for available times
- **THEN** no evaluation runs and the identity card appears in the thread

#### Scenario: Identification keeps the thread
- **WHEN** a guest who described the meeting on the public page continues without Google
- **THEN** the request leaves draft, the address bar shows its booking link without a reload, the assistant still has the earlier messages, and the creation email is sent

#### Scenario: Abandoned draft
- **WHEN** a guest sends a message and leaves without identifying
- **THEN** the host never sees the draft and it is deleted after 24 hours

#### Scenario: Anonymous budget exhausted
- **WHEN** the anonymous service-wide allowance is used up
- **THEN** new draft messages get a temporary-limit response and **Continue without Google** still identifies the guest

#### Scenario: Unconfirmed request keeps the anonymous cap
- **WHEN** a request identified without Google has spent USD 3 of model allowance and its contact is still unconfirmed
- **THEN** further model work for it is refused until the requester confirms the address

### Requirement: Bounded request creation
Creating a request on a public host page SHALL require a ready host and SHALL be bounded to 5 requests per source address in any rolling hour and 20 in any rolling day and 500 across the service in any rolling day, with no per-host bound. Source addresses SHALL be stored only as keyed hashes. Past a bound, the service SHALL create nothing and SHALL return generic temporary-limit feedback that discloses neither the host's existing requests nor which bound applied.

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

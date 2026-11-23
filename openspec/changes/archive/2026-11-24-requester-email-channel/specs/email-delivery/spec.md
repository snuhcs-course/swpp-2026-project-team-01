## ADDED Requirements

### Requirement: Thread notices for email requesters
A request with an active email thread SHALL receive each requester status notice in that thread as a reply from the product inbox, in addition to the email to its contact address. A thread notice SHALL be generated from the same domain records and template, SHALL carry the booking link only in its sealed form until dispatch, and SHALL be suppressed at dispatch when its condition no longer holds or the thread is no longer bound.

#### Scenario: Decline reaches the thread
- **WHEN** the host declines a request whose thread is bound
- **THEN** the thread receives the decline notice and the contact address receives the decline email

#### Scenario: Thread unlinked before dispatch
- **WHEN** the requester unlinks the thread while a notice for it is queued
- **THEN** the thread notice is suppressed and the email to the contact address is unaffected

### Requirement: Conversational reply identity
Every AgentMail reply SHALL be frozen before dispatch and sent with an idempotency key equal to its reply identity. A reply whose dispatch outcome is unknown SHALL be retried only with the same key and payload, and only while its first dispatch is less than 23 hours old; after that it SHALL be recorded uncertain and never sent again.

#### Scenario: Reply response lost
- **WHEN** a thread reply was dispatched and its response was lost
- **THEN** the next attempt sends the same payload with the same key and records the provider's original message

#### Scenario: Retry horizon passed
- **WHEN** a reply found dispatching was first dispatched more than 23 hours earlier
- **THEN** it is recorded uncertain without another send

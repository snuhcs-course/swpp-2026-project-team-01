## ADDED Requirements

### Requirement: Host request discussion only in the messenger
The host-private discussion of a request SHALL be opened and continued only from the host's linked messenger, or from the local host-approval evaluation entry. The website's host chat routes SHALL serve only the host's setup discussion. A chat route request that names a request SHALL be refused before any discussion is read, created, sent to or recovered, and SHALL NOT be answered from the setup discussion.

#### Scenario: Browser names a request
- **WHEN** a signed-in host's browser sends a message, reads the state or history, or asks for recovery with a `request` scope, even for the host's own request
- **THEN** the route answers `400 request_scope_unsupported`, no request discussion is created or read, and nothing reaches the setup discussion

#### Scenario: Messenger message about a request
- **WHEN** a linked host writes about a request in their messenger
- **THEN** the message goes to that request's host-private discussion with only the host-review tools, as before

#### Scenario: Setup chat on the web
- **WHEN** a host sends a setup message on the web without a request
- **THEN** it goes to the host's setup discussion as before

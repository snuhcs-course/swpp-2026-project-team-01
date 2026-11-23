## ADDED Requirements

### Requirement: Host discussions only in the messenger
The host's setup discussion and the host-private discussion of a request SHALL be opened and continued only from the host's linked messenger, or, for a request, from the local host-approval evaluation entry. The website SHALL mount no route that sends a host message, reads a host discussion's state or history, or recovers a host discussion. The conversation functions and their HTTP adapter MAY remain as server code; a host request scope given to that adapter SHALL be refused before any discussion is read, created, sent to or recovered, and SHALL NOT be answered from the setup discussion.

#### Scenario: Browser calls a host chat route
- **WHEN** a signed-in host's browser posts a message to, or reads the state, history or recovery of, a host discussion on the website
- **THEN** no such route exists, so nothing is sent, read or recovered

#### Scenario: Adapter names a request
- **WHEN** a request to the host chat adapter names a request, even the host's own
- **THEN** it answers `400 request_scope_unsupported`, no request discussion is created or read, and nothing reaches the setup discussion

#### Scenario: Messenger message about setup or a request
- **WHEN** a linked host writes in their messenger about setup or about a request
- **THEN** the message goes to the setup discussion or to that request's host-private discussion with that audience's tools, as before

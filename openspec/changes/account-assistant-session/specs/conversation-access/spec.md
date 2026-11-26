## MODIFIED Requirements

### Requirement: Separate discussion audiences
The account assistant and each requester discussion for a guest without an account SHALL use separate authorized contexts. The account assistant SHALL access received requests as their host and account-associated sent requests through the requester projection only. A tool that an audience must not use SHALL NOT be registered in that audience's context, so that instructions are never the only barrier; a shared tool SHALL derive the actor from the verified session and return only that audience's projection. The requester discussion's history SHALL be readable only by that request's requester: no host route, view or tool SHALL read it. The account session SHALL NOT import requester discussion histories or another host's private memory. Separate authorized audiences SHALL NOT merge their histories or memory.

#### Scenario: Host asks for the requester conversation
- **WHEN** a host, or the assistant in an account assistant session, asks for the requester's conversation with the assistant
- **THEN** no route, view or tool returns it, and the host sees only the host projection of the request

#### Scenario: Requester asks for host data
- **WHEN** a requester session asks the assistant for the host's calendar contents, rules or exception reasons
- **THEN** no tool able to read them exists in that context, nothing is read, and the assistant answers within the requester projection

### Requirement: Host review audience
The host account SHALL have one assistant discussion and runtime session retained as its currently linked messenger changes among iMessage, WhatsApp and Telegram. The existing one-active-binding-per-host constraint SHALL remain. Requests SHALL be addressed as data by ref, without per-request host-review sessions. The tool set SHALL cover request listing/details, schedule/image, settings, decisions, suggestions, guest questions and exceptions; unfinished setup SHALL be handled in the same session. Every tool SHALL recheck actor, generation and target authority.

#### Scenario: Host asks the assistant to approve
- **WHEN** a turn not authorized as the host's linked messenger input asks to approve
- **THEN** no approval is recorded through messenger tools; the host can use the existing web decision card

#### Scenario: Host review session of another request
- **WHEN** the account assistant reads a received request by ref
- **THEN** it returns the host projection only if that account owns it, without disclosing another host's request existence

#### Scenario: Several linked channels
- **WHEN** the host asks about a received request in Telegram, changes the active binding to WhatsApp, and asks for their schedule
- **THEN** both inputs continue the same account session, turns are ordered at account scope, and each reply returns through its input's authorized channel

#### Scenario: Host settings or setup after a request notice
- **WHEN** a host asks to read or change settings, or continue unfinished setup, after any request notice
- **THEN** the same account tool set handles it using the existing settings and setup commands without switching discussion

### Requirement: Host discussions only in the messenger
The host account discussion SHALL be opened and continued only from its linked messengers or an explicitly authorized local evaluation entry. The website SHALL mount no route that sends a host message, reads a host discussion's state or history, or recovers a host discussion. The conversation functions and their HTTP adapter MAY remain as server code; a host request scope given to that adapter SHALL be refused before any discussion is read, created, sent to or recovered, and SHALL NOT be answered from the setup discussion.

#### Scenario: Browser calls a host chat route
- **WHEN** a signed-in host's browser posts a message to, or reads the state, history or recovery of, a host discussion on the website
- **THEN** no such route exists, so nothing is sent, read or recovered

#### Scenario: Adapter names a request
- **WHEN** a request to the host chat adapter names a request, even the host's own
- **THEN** it answers `400 request_scope_unsupported`, no request discussion is created or read, and nothing reaches the setup discussion

#### Scenario: Messenger message about setup or a request
- **WHEN** a linked host writes in their messenger about setup or about a request
- **THEN** the message continues the same account discussion with ref-addressed tools and no request selection

## ADDED Requirements

### Requirement: Sent requests within the account assistant
An account holder SHALL read and act on their verified account-associated sent requests in the same account conversation through the requester projection. This SHALL NOT expose the receiving host's private schedule, settings, ledger, memory or requester conversation history. A typed contact email SHALL NOT establish account ownership. Guests without an account SHALL retain per-request requester sessions on web, email and messenger.

#### Scenario: Host is also a guest
- **WHEN** an account holder asks for their sent request's current times and their own schedule
- **THEN** one account conversation reads that request as its requester and the account's own schedule as its owner

#### Scenario: Wrong direction
- **WHEN** the account tries to approve its sent request as the receiving host
- **THEN** the action is denied and no receiving-host private data is returned

#### Scenario: Anonymous requester
- **WHEN** a guest without an account continues by web, email or messenger
- **THEN** their existing per-request session and tools remain scoped to that request, with no host-private memory, ledger, schedule or cross-request access

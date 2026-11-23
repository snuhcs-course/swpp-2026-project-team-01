## ADDED Requirements

### Requirement: Request another host from the host's messenger
A set-up host who sends another host's booking link or @handle in their linked messenger conversation SHALL be able to start a request to that host as their account, using the account's name, Google-verified address, host timezone and host conflict calendars without asking for them, or continue the account's open request with that host unless they ask for another meeting. The host's own link SHALL start nothing, and an unknown, unready or paused host SHALL get a neutral reply. The request's guest conversation SHALL be the host's linked conversation, and the request's guest notices SHALL arrive there. Nothing about the host's settings, calendars or other requests SHALL reach the other host.

#### Scenario: Link starts a request
- **WHEN** a linked host sends `findmeatime.com/dodo` or "Book a meeting with @dodo"
- **THEN** a request to @dodo is created as the account, its host calendars count, and the host's next message reaches that request's discussion

#### Scenario: Own link
- **WHEN** a host sends their own booking link or handle
- **THEN** no request is created and they are told it is their own link

#### Scenario: Existing request continues
- **WHEN** the account already has an open request with that host and does not ask for another meeting
- **THEN** that request continues and no second request is created

### Requirement: One conversation routes by context
In a host conversation that also holds the host's sent requests, a message SHALL go to the discussion the host binding has selected, without a picker. `request <ref>` SHALL select a sent request bound to that conversation; a message saying the sender is the host SHALL select setup; another host's booking link or @handle SHALL reach the host role; a message naming another such request SHALL select it, and while a received request is selected only its reference SHALL. A host notice SHALL select its received request and a guest notice SHALL select its sent request, except during the host tutorial. A reference SHALL resolve only requests the account received or sent bound to that conversation.

#### Scenario: Notice moves the conversation
- **WHEN** a guest notice about a sent request arrives after the host was talking about setup
- **THEN** the host's next plain message goes to that sent request

#### Scenario: Another host's request
- **WHEN** the host sends `request <ref>` for a request that is neither theirs nor bound to their conversation
- **THEN** nothing is selected for it and nothing reaches that request

### Requirement: Received and sent requests listed apart
When the host asks about their requests in conversation, the service SHALL list the requests they received and the requests they sent to other hosts apart, each by person, purpose and status.

#### Scenario: Both kinds open
- **WHEN** a host with a received and a sent request asks what meetings they have
- **THEN** the list tool returns both, received and sent apart

### Requirement: A guest-host's updates in their host conversation
A guest whose request is linked to their host account SHALL be able to choose, with the host settings card, that the request's notices and replies use their linked host conversation, and to turn it off again. The choice SHALL be offered only while the account has a linked messenger.

#### Scenario: Opt in
- **WHEN** the guest-host chooses **Updates in your host conversation**
- **THEN** the request is bound to their host conversation, its notices arrive there, and `request <ref>` there resolves it

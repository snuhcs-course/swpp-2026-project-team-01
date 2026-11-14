## ADDED Requirements

### Requirement: Readable next steps for agents
Tool results SHALL tell the agent what to say or do next, in words the service writes. `get_setup` SHALL return a `nextStep` for every setup state, and while the calendar analysis runs it SHALL tell the agent to have the host wait and to read the setup again rather than confirm. `confirm_setup` SHALL tell the agent to give the host the booking link and to say that the agent is not notified of new requests, so the host should ask it to check. `agree_to_proposal` SHALL tell the agent to say that the host must still approve, that nothing is booked yet and that the outcome arrives by email. The host server instructions SHALL tell the agent to start with `get_host_status`.

#### Scenario: Analysis still running
- **WHEN** a host's agent reads the setup while the calendar analysis is still running
- **THEN** `nextStep` tells it to have the host wait and to read the setup again, and not to confirm

#### Scenario: Calendar steps in the browser
- **WHEN** the setup needs Google Calendar connected or calendars chosen
- **THEN** `nextStep` names the host workspace URL for that step

#### Scenario: Setup confirmed
- **WHEN** the host's agent confirms setup
- **THEN** the result carries the booking link and a next step that says to share it and to ask the agent to check for requests

#### Scenario: Requester agreed
- **WHEN** a requester's agent agrees to the current proposal
- **THEN** the result's next step says the host must still approve, nothing is booked yet, and the outcome arrives by email

### Requirement: Setup values the host agreed to
A host's agent SHALL be able to propose any setup value from the suggestions or from what it knows about the host. `update_setup_field` and `confirm_setup` SHALL require the host's own words agreeing to the value or the settings (`hostWords`, 1–500 characters after trimming), SHALL refuse a call without them before any command runs, and SHALL NOT store them. The tool descriptions and the host instructions SHALL tell the agent to set a value only after the host agrees, and to ask for meeting mode, place and travel mode when it does not know them.

#### Scenario: Host agrees to a proposed place
- **WHEN** the agent proposes "in person near Yeoksam Station", the host agrees, and the agent calls `update_setup_field` with the host's words
- **THEN** the value is recorded as the host's answer, as a card press records it on the web

#### Scenario: No host words
- **WHEN** the agent calls `update_setup_field` or `confirm_setup` without `hostWords`, or with only spaces
- **THEN** the call is refused as invalid input and the draft does not change

### Requirement: Chat linking started by an agent
A host's agent with `host:write` SHALL be able to start an iMessage, WhatsApp or Telegram link for the host, and a requester's agent with `request:write` SHALL be able to start an iMessage or WhatsApp updates link for its request. Each SHALL run the web's link create command as the grant's actor and SHALL return a one-time browser link, not a binding. Only the person SHALL confirm the link, on the link page, after the code has arrived from their own phone and the sender is shown in full, as on the web cards (#118). The agent SHALL NOT be able to confirm a link, and a requester's agent SHALL NOT receive the booking link. `get_host_status` and the requester's `get_request` SHALL report the chat link's state and the sender, as the web cards show it.

#### Scenario: Host links iMessage through the agent
- **WHEN** the host gives their agent their iPhone number, opens the returned link signed in, sends the code from that iPhone and presses **Confirm and link**
- **THEN** the host's iMessage chat is linked, and `get_host_status` reports it as linked with the sender

#### Scenario: Requester links updates through the agent
- **WHEN** a requester's agent starts an iMessage link with the person's number and the person sends the code and presses **Confirm and link** on the returned page
- **THEN** the request's updates go to that chat, `get_request` reports it as linked, and the page never showed the booking link or the request's details

#### Scenario: Nothing linked before confirmation
- **WHEN** the agent has started a link and the person has not confirmed it
- **THEN** no chat is bound, and the status reports the attempt as pending

#### Scenario: Link page for another host
- **WHEN** a host link page is opened in a session of a different host
- **THEN** it shows that the link is not open and binds nothing

#### Scenario: Attempt no longer open
- **WHEN** a link page is opened after its attempt was confirmed, replaced by a newer attempt, cancelled or expired
- **THEN** it shows that the link is no longer open and tells the person to ask their agent to start again

#### Scenario: Channel not configured
- **WHEN** an agent starts a link on a channel the deployment has not configured
- **THEN** the tool reports the channel as unavailable and no attempt is made

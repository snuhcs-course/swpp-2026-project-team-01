## ADDED Requirements

### Requirement: Host calendars for one request in words
A guest whose request is linked to their host account SHALL be able to say, in the request's conversation or through the account connection, whether their host conflict calendars count as their busy time for that request. The choice SHALL change that request only, never the host's settings or calendar roles, and SHALL apply only while times are being chosen. It SHALL use all of those calendars or none.

#### Scenario: Leave them out for one request
- **WHEN** the guest-host says "Don't check my calendars for this one" while choosing a time
- **THEN** their host calendars no longer count for that request, their host settings are unchanged, and times are found again

#### Scenario: Only some calendars
- **WHEN** the guest-host asks to skip only one of their host calendars for the request
- **THEN** nothing changes and they are told it can use all of them or none

## MODIFIED Requirements

### Requirement: One conversation routes by context
In a host conversation that also holds the host's sent requests, a message SHALL go to the discussion the host binding has selected, without a picker. `request <ref>` SHALL select a sent request bound to that conversation; a message saying the sender is the host SHALL select setup; while a sent request is selected, a message about the host's own meetings in general that does not name that meeting SHALL select setup; another host's booking link or @handle SHALL reach the host role; a message naming another such request SHALL select it, and while a received request is selected only its reference SHALL. A host notice SHALL select its received request and a guest notice SHALL select its sent request, except during the host tutorial. A reference SHALL resolve only requests the account received or sent bound to that conversation.

#### Scenario: Notice moves the conversation
- **WHEN** a guest notice about a sent request arrives after the host was talking about setup
- **THEN** the host's next plain message goes to that sent request

#### Scenario: Another host's request
- **WHEN** the host sends `request <ref>` for a request that is neither theirs nor bound to their conversation
- **THEN** nothing is selected for it and nothing reaches that request

#### Scenario: A change to the host's own meetings
- **WHEN** a sent request is selected and the host writes "Also, make my meetings 45 minutes"
- **THEN** setup is selected and receives the message, and the sent request keeps its length

#### Scenario: A change to this meeting
- **WHEN** a sent request is selected and the host writes "Make it 45 minutes"
- **THEN** the message stays with the sent request

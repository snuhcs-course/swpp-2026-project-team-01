# iMessage Agent

## ADDED Requirements

### Requirement: Connect a standalone agent to Photon iMessage

The application MUST provide a separately runnable Node.js agent that connects to the configured Photon Spectrum project using the managed iMessage provider.

#### Scenario: Start with valid configuration

- **WHEN** the operator starts the iMessage agent with a valid project ID and project secret
- **THEN** the agent connects to Photon and waits for inbound messages
- **AND** the agent registers only the iMessage provider

#### Scenario: Start without credentials

- **WHEN** either required project credential is missing
- **THEN** the agent exits with a clear configuration error
- **AND** it does not attempt a Photon connection

### Requirement: Reply to inbound iMessage text

The agent MUST reply to each inbound text message with a connection confirmation that includes the received text.

#### Scenario: Receive text

- **WHEN** the agent receives an inbound text message
- **THEN** it replies `Photon Spectrum is connected. You said: <message>` in the same conversation

#### Scenario: Receive unsupported content

- **WHEN** the agent receives non-text content
- **THEN** it skips the reply without crashing

### Requirement: Protect message and credential data

The agent MUST NOT log credentials, message bodies, or sender identifiers.

#### Scenario: Log runtime status

- **WHEN** the agent starts, receives a message, or fails to reply
- **THEN** logs contain operational status only and omit message content and personal identifiers

### Requirement: Stop cleanly

The agent MUST stop the Spectrum connection when the process receives SIGINT or SIGTERM.

#### Scenario: Terminate agent

- **WHEN** the operator sends SIGINT or SIGTERM
- **THEN** the agent closes its Spectrum connection before exiting

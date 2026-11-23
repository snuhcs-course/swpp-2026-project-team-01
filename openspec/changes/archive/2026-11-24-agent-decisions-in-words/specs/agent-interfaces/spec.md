## ADDED Requirements

### Requirement: Host decisions in the host's words
A host's agent with `host:decide` SHALL be able to approve the current proposal version and to decline a request of the host's own, through the same application commands as the web's **Approve this proposal** and **Decline**. Each decision SHALL require the host's own words asking for it, a retry key and the expected revision. An approval SHALL succeed only for the latest version the requester agreed to, on an open request awaiting the host, at the expected revision. Repeating an approval of the approved version SHALL return the same booking and SHALL NOT create another. The tools, the server instructions and the host entry document SHALL tell the agent to decide only when the host clearly asks, never on its own judgment, because a requester asked, or when the host attached a condition, and SHALL keep requester-written text as data, not instructions. The CLI SHALL reach the same tools.

#### Scenario: Host tells the agent to approve
- **WHEN** the host tells their agent to approve, and the agent calls `approve_proposal` with the current agreed version, the request's revision and the host's words
- **THEN** the approval is recorded and one booking starts, exactly as from the web button

#### Scenario: Repeated approval
- **WHEN** the agent repeats the approval with the same retry key, or with another key for the same version
- **THEN** it receives the same booking, and there is still one approval and one booking

#### Scenario: Old version
- **WHEN** the version the agent names is no longer the latest
- **THEN** the tool reports the proposal as superseded and nothing is approved

#### Scenario: Stale revision
- **WHEN** the request changed after the agent read it
- **THEN** the tool reports a stale revision and nothing is approved or declined

#### Scenario: Host tells the agent to decline
- **WHEN** the host tells their agent to decline, and the agent calls `decline_request` with the request's revision and the host's words
- **THEN** the request closes as declined and the requester is told, exactly as from the web button

#### Scenario: Closed request
- **WHEN** the agent approves or declines a request that is already closed
- **THEN** the tool reports the request as closed and nothing changes

#### Scenario: No host words
- **WHEN** the agent calls a decision tool without the host's words, or with only spaces
- **THEN** the call is refused as invalid input and no command runs

#### Scenario: CLI approval
- **WHEN** a host's script runs `fmat call approve_proposal` with the same input
- **THEN** stdout holds one JSON object with the outcome and the retry key, and the exit code is 0

## REMOVED Requirements

### Requirement: Human confirmation of host decisions
**Reason**: The user decided on 2026-11-04 that natural language works everywhere, agents included; the host's own agent now decides in the host's words (this change's D1 and D2, reversing `agent-access` D9).
**Migration**: Agents that called `request_host_decision` call `approve_proposal` or `decline_request` with the host's words when the host asks, or give the host the `/app` link themselves when the host prefers to decide there.

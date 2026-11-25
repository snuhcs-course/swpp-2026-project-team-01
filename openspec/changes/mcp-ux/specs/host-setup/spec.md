## ADDED Requirements

### Requirement: Agent setup recovery and intake control
MCP setup reads and field updates SHALL guide a host with pending draft changes to review missing values or call confirm_setup with the latest revision and proposal hash. MCP host status SHALL expose intake preference separately from readiness. A host SHALL pause or resume new intake in linked iMessage, Telegram and MCP under the existing actor, revision and retry guards; existing requests and messenger bindings SHALL remain available.

#### Scenario: Ready host changes duration in MCP
- **WHEN** an already configured host drafts a new duration
- **THEN** the response directs the agent to review and confirm the pending settings, and guests retain the old settings until confirmation

#### Scenario: Pause from a linked messenger
- **WHEN** the host asks to stop accepting new requests
- **THEN** new requests are refused, existing requests continue and the messenger remains linked

### Requirement: Explicit week schedule overrides
Setup SHALL accept optional alternate-week windows anchored to an explicit Monday and whole-week replacements keyed by Monday date in the host timezone. A replacement with no windows SHALL close that week. Duplicate or invalid Monday dates SHALL be rejected. Old settings SHALL behave as before. A host SHALL be able to request this week's open-time preview as well as next week's; this week's preview SHALL exclude past times and SHALL NOT confirm initial setup.

#### Scenario: One week only
- **WHEN** the host confirms a replacement for next week
- **THEN** only that week's windows change and later weeks use the recurring rules

#### Scenario: Preview this week
- **WHEN** the host asks for this week's open times
- **THEN** a dated image shows remaining open times using the current rules without confirming initial setup

### Requirement: Existing web settings remains unchanged
This change SHALL expose onboarding through iMessage, Telegram and MCP, SHALL preserve the existing web Settings UI and interactions, and SHALL NOT add a web onboarding review screen.

#### Scenario: Host opens web Settings
- **WHEN** a configured host opens Settings after this change
- **THEN** the same controls and save behavior are shown, and no new onboarding review is presented

# Spec Delta

## Purpose

Let an admitted host continue the same private meeting request through a verified iMessage identity while preserving explicit selection and proposal-specific authority.

## ADDED Requirements

### Requirement: Authorized private request discovery
The application assistant SHALL list bounded, paginated request summaries only for the current admitted host in a private setup or request conversation. It SHALL omit saved requester contact fields and private transcripts from navigation results. Listing or searching SHALL NOT select a request or authorize a decision.

#### Scenario: Private host searches requests
- **WHEN** a current host grant searches or continues a request page
- **THEN** it receives only that host's matching bounded summaries and a continuation cursor when needed, without saved requester names, addresses or transcripts

#### Scenario: Shared or revoked context requests navigation
- **WHEN** a shared discussion, guest, revoked host or revoked private link requests the host's list
- **THEN** navigation is denied without exposing request summaries

### Requirement: Explicit link-local selection
The service SHALL change a linked private conversation's selected request only from an explicit host selection of a request-bound reference. Ambiguity SHALL produce choices or clarification. Setup SHALL remain explicitly selectable. Selection SHALL NOT alter another link or merge request histories.

#### Scenario: Several requests are pending
- **WHEN** the host asks about a meeting without a selected request
- **THEN** the assistant presents choices without assuming the newest request or exposing a request transcript

#### Scenario: Unknown or foreign selection
- **WHEN** a host supplies an invalid selection reference or another host's request
- **THEN** the existing selection remains unchanged and no foreign request context is exposed

### Requirement: Durable private request continuity
Each accepted message SHALL retain the private request context selected for that receipt across retries, restart and later selection changes. Tool access and outbound delivery SHALL revalidate the captured link, receiver and host authority. Request replies SHALL identify their request context.

#### Scenario: Selection changes before earlier work finishes
- **WHEN** the host selects another request after an input is accepted
- **THEN** the earlier input and reply retain their original request and later input uses the new selection without shared-history contamination

#### Scenario: Link is replaced or revoked
- **WHEN** the original link loses authority before execution or send
- **THEN** its pending private work cannot use a replacement link or deliver private content

### Requirement: Attributable current-proposal decisions
The service SHALL display authored current-proposal context before accepting an explicit iMessage approval or decline. Decisions SHALL bind the exact proposal, request revision and verified route. Bare assent, model output, notification delivery and stale context SHALL NOT count as approval. Revisions SHALL require renewed agreement and approval.

#### Scenario: Explicit current approval
- **WHEN** the linked host explicitly approves the displayed current proposal with valid decision context and current requester agreement
- **THEN** the existing booking workflow records attributable approval once and reports the actual booking state

#### Scenario: Stale or ambiguous response
- **WHEN** a host replies ambiguously or uses context for an older proposal
- **THEN** the service asks for clarification or renewed review without approving a different proposal

#### Scenario: Host proposes a revision
- **WHEN** the host requests changed shared meeting details in private discussion
- **THEN** the change is reviewed and returned for requester agreement, with any previous proposal approval invalidated

### Requirement: Controlled provider acceptance
Completion SHALL include real linked iMessage request selection, question, revision, approval, separate decline and revocation on an authorized private recipient route. Fixture results and provider acknowledgements SHALL NOT establish this acceptance.

#### Scenario: Only synthetic routing passes
- **WHEN** deterministic request-continuity tests pass without a controlled real recipient journey
- **THEN** live acceptance remains incomplete

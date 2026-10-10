# Spec Delta

## Purpose

Remove expired temporary Calendar analysis evidence without requiring host activity, while preserving adopted settings and scheduling authority.

## ADDED Requirements

### Requirement: Scheduled temporary evidence cleanup
The system SHALL schedule bounded cleanup of Calendar analysis rows older than 24 hours without requiring the host to return. Recent rows SHALL remain. Locked rows SHALL be deferred for a later pass rather than blocking active work indefinitely; maintenance backlog and disablement SHALL NOT be described as guaranteed immediate deletion.

#### Scenario: Inactive host with expired analysis
- **WHEN** an inactive host has analysis rows older than 24 hours and scheduled maintenance succeeds
- **THEN** eligible rows are removed within bounded passes without a host request or provider call

#### Scenario: Concurrent or recent evidence
- **WHEN** cleanup encounters locked expired rows or rows inside the retention window
- **THEN** recent rows remain, locked rows can be retried later, and each pass remains bounded

### Requirement: Maintenance preserves durable decisions
Cleanup SHALL remove only temporary scan records. It SHALL preserve dismissal choices, host setup progress, adopted draft values, confirmed settings, requests, approvals and booking outcomes. Only the database maintenance operator SHALL be able to invoke global cleanup; browser, anonymous and agent credentials SHALL NOT grant this authority.

#### Scenario: Previously adopted analysis
- **WHEN** an old analysis that contributed to a draft or saved setting is cleaned up
- **THEN** the adopted values and explicit decision provenance remain unchanged and no new approval or provider action occurs

#### Scenario: Unprivileged maintenance attempt
- **WHEN** an ordinary application caller tries to invoke global cleanup
- **THEN** the attempt is denied without revealing or deleting another host's evidence

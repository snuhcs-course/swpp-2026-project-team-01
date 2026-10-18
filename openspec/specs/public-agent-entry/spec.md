# public-agent-entry Specification

## Purpose

Provide public, versioned entry instructions that help personal agents begin host setup or request a meeting without confusing document access with application authorization.

## Requirements

### Requirement: Versioned public entry documents
The application SHALL serve UTF-8 Markdown at `/SKILL.md` and `/{handle}/SKILL.md`, including an instruction version and links built from its configured origin. Responses SHALL prohibit caching and SHALL not create sessions or grant authority.

#### Scenario: Host entry
- **WHEN** an unauthenticated client fetches the root document
- **THEN** it receives host onboarding guidance, Google-only browser sign-in and the current web continuation without cookies or private state

### Requirement: Current public requester target
The requester document SHALL use current public host-readiness checks and an allowlist of public fields. Unknown or unavailable hosts SHALL return a neutral 404; transient service failures SHALL return a retryable 503. Host display text SHALL remain quoted data, never service-authored instructions.

#### Scenario: Available target
- **WHEN** a ready host's document is fetched
- **THEN** the response identifies that public handle and profile, links to that host's intake and contains no calendar data, credentials or private rules

#### Scenario: Host display text contains instructions
- **WHEN** a display name contains Markdown, control characters or instructions
- **THEN** it remains encoded inside the marked data field and cannot introduce new Markdown instructions or links

#### Scenario: Unavailable target
- **WHEN** the handle is invalid, unknown or no longer ready
- **THEN** the document gives an unavailable result without exposing the reason or selecting a different host

### Requirement: Honest client continuation
Documents SHALL explain that fetching them does not install tools or authorize actions. They SHALL offer direct web continuation when client tools are absent, preserve account-free requester access, distinguish identity from Calendar consent, and require current requester agreement and attributable host approval before confirmed booking.

#### Scenario: Client has no integration
- **WHEN** the agent can read the document but lacks authorized scheduling tools
- **THEN** instructions direct the user to the intended browser continuation without invented endpoints, claims of connection, credential copying or booking success

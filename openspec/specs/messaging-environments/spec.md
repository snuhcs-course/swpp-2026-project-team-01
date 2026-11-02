# messaging-environments Specification

## Purpose

Prevent non-production deployments from consuming delivery work or sending application email and iMessage traffic with accidentally inherited credentials.

## Requirements

### Requirement: Non-production messaging denial
Application messaging SHALL reject Vercel preview, development and custom non-production environments even when provider credentials are present. Standalone local execution SHALL be rejected unless the transport's configured endpoint is a loopback address, so local runs reach only a stand-in provider. An identified Vercel deployment with missing or contradictory environment metadata SHALL fail closed. Denial SHALL use a sanitized configuration error before provider network access.

#### Scenario: Preview with copied provider credentials
- **WHEN** a preview attempts transactional email, conversational email or iMessage delivery
- **THEN** no provider request or message is sent and the caller receives configuration unavailability

#### Scenario: Missing or contradictory deployment metadata
- **WHEN** deployment metadata identifies Vercel without an unambiguous production environment
- **THEN** messaging remains unavailable without reflecting metadata or credentials in errors

#### Scenario: Local run with a real provider token
- **WHEN** a local process with a real provider token and the provider's own endpoint attempts transactional email
- **THEN** no provider request is sent and the caller receives configuration unavailability

#### Scenario: Local run against a stand-in
- **WHEN** a local process sends through a transport whose configured endpoint is `127.0.0.1`, `localhost` or `::1`
- **THEN** the message reaches the stand-in and the transport's own checks still apply

### Requirement: Preserve delivery state on environment denial
Messaging workers SHALL check deployment admission before claiming or processing persisted delivery work. Environment denial SHALL NOT consume leases, mark messages sent or failed, alter uncertainty or manufacture provider evidence. Direct transport calls SHALL independently enforce the same environment restriction.

#### Scenario: Preview wakeup against a configured database
- **WHEN** a preview delivery worker is invoked with otherwise valid configuration
- **THEN** it rejects before accessing delivery state, even if a provider adapter was injected

#### Scenario: Direct provider adapter invocation
- **WHEN** a caller bypasses the worker and invokes a messaging transport in a denied environment
- **THEN** the transport still rejects before network access

### Requirement: Preserve admitted environment authority
Production execution, and local execution toward a loopback stand-in, SHALL retain existing authorization, credential, dispatch identity and outcome checks. Deployment admission SHALL NOT itself grant permission to send or prove recipient delivery.

#### Scenario: Production dispatch
- **WHEN** environment metadata identifies production consistently
- **THEN** the existing provider and current-authority checks still determine whether a message can be sent

# messaging-environments Specification

## Purpose

Prevent non-production deployments from consuming delivery work or sending application email and iMessage traffic with accidentally inherited credentials.

## Requirements

### Requirement: Non-production messaging denial
Application messaging SHALL reject Vercel preview, development and custom non-production environments even when provider credentials are present. An identified Vercel deployment with missing or contradictory environment metadata SHALL fail closed. Denial SHALL use a sanitized configuration error before provider network access.

#### Scenario: Preview with copied provider credentials
- **WHEN** a preview attempts transactional email, conversational email or iMessage delivery
- **THEN** no provider request or message is sent and the caller receives configuration unavailability

#### Scenario: Missing or contradictory deployment metadata
- **WHEN** deployment metadata identifies Vercel without an unambiguous production environment
- **THEN** messaging remains unavailable without reflecting metadata or credentials in errors

### Requirement: Preserve delivery state on environment denial
Messaging workers SHALL check deployment admission before claiming or processing persisted delivery work. Environment denial SHALL NOT consume leases, mark messages sent or failed, alter uncertainty or manufacture provider evidence. Direct transport calls SHALL independently enforce the same environment restriction.

#### Scenario: Preview wakeup against a configured database
- **WHEN** a preview delivery worker is invoked with otherwise valid configuration
- **THEN** it rejects before accessing delivery state, even if a provider adapter was injected

#### Scenario: Direct provider adapter invocation
- **WHEN** a caller bypasses the worker and invokes a messaging transport in a denied environment
- **THEN** the transport still rejects before network access

### Requirement: Preserve admitted environment authority
Production and standalone local execution SHALL retain existing authorization, credential, dispatch identity and outcome checks. Deployment admission SHALL NOT itself grant permission to send or prove recipient delivery.

#### Scenario: Production dispatch
- **WHEN** environment metadata identifies production consistently
- **THEN** the existing provider and current-authority checks still determine whether a message can be sent

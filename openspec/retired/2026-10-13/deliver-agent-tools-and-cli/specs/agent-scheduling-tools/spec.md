# Spec Delta

## Purpose

Let personal agents perform authorized scheduling work through discoverable tools and a terminal client while preserving one domain workflow and explicit human decisions.

## ADDED Requirements

### Requirement: Protected MCP transport
The service SHALL expose Streamable HTTP at `/mcp`, authenticate every protected request with its application resource token, and advertise protected-resource metadata on authentication failure. Browser cookies, query credentials and provider tokens SHALL NOT substitute for bearer authorization. Invalid origins, oversized bodies and unsupported protocol messages SHALL fail without private data or effects.

#### Scenario: Unauthenticated discovery
- **WHEN** a client initializes without an application access token
- **THEN** it receives a 401 Bearer challenge with the configured protected-resource metadata URL

#### Scenario: Authority changes between calls
- **WHEN** a grant is revoked or its underlying request authority rotates after initialization
- **THEN** subsequent discovery and tool calls fail even if the connection previously succeeded

### Requirement: Shared discoverable tool contract
MCP and CLI SHALL expose the same named, schema-validated operations and stable structured results. Tool descriptions SHALL state required permissions, effects, retry keys and human handoffs. Mutating retries SHALL preserve domain idempotency. Caller-supplied actor identities, arbitrary operation names and confirmation claims SHALL confer no authority.

#### Scenario: Retry after uncertain response
- **WHEN** a client repeats a mutation with the original key and input
- **THEN** the same authorized result is returned without duplicating effects, while changed input conflicts

#### Scenario: Unauthorized tool
- **WHEN** a requester attempts host setup or a host attempts another host's request
- **THEN** no private state is returned or changed regardless of tool annotations or supplied identifiers

### Requirement: Scheduling workflow coverage
Authorized tools SHALL support host setup drafts and analysis, bounded host request discovery, request details and conversation, requester availability and negotiation, candidate and current-proposal review, and booking status. Private host context SHALL remain host-only. Required human confirmation and provider consent SHALL return protected browser continuation without fabricating completion.

#### Scenario: Requester negotiates
- **WHEN** an account-free requester grants access for one request
- **THEN** the agent can read and propose changes within that request and obtain current decision review, without accessing another request or private host context

#### Scenario: Host approval is required
- **WHEN** an agent requests booking without separately attributable approval of the current proposal
- **THEN** the service returns human review guidance and creates no approval or booking job

### Requirement: CLI authorization lifecycle
The CLI SHALL use browser authorization with S256 PKCE and exact loopback callback/state/resource validation. Credentials SHALL be isolated by configured origin and actor grant, stored with private filesystem permissions, and excluded from normal output and command arguments. Refresh SHALL rotate safely; uncertain refresh SHALL require reauthorization. Logout SHALL revoke the grant and remove local credentials.

#### Scenario: Foreign callback
- **WHEN** a callback has a wrong state, path or advertised issuer
- **THEN** the CLI does not exchange its code or replace stored credentials

#### Scenario: Parallel terminal invocations
- **WHEN** two processes need to refresh the same connection
- **THEN** local coordination prevents replaying a consumed refresh credential

### Requirement: Truthful entry and recovery
Both public skill entry journeys SHALL describe the actual endpoint, supported CLI invocation, browser authorization and missing-client recovery. Results SHALL distinguish drafts, pending human decisions and confirmed bookings. Compatibility evidence SHALL identify the actual tested client/version and cannot be inferred from another client or SDK fixture.

#### Scenario: Missing client support
- **WHEN** a personal agent cannot connect or run the CLI
- **THEN** the instructions preserve the host or requester browser journey and disclose the missing integration without asking for login or provider secrets

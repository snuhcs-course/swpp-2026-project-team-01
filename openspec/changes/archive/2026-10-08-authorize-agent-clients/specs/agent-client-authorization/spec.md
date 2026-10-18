# Spec Delta

## Purpose

Let hosts and account-free requesters explicitly grant bounded personal-agent access without sharing their login, request-continuation or provider credentials.

## ADDED Requirements

### Requirement: Resource-bound authorization protocol
Authorization, code exchange and refresh SHALL require the exact configured resource. The service SHALL support authorization codes with S256 PKCE and registered exact callbacks, rejecting duplicate parameters, malformed input, unsupported grants and missing or unknown scopes. Registration SHALL grant no application authority.

#### Scenario: Changed resource
- **WHEN** code exchange or refresh requests a different or omitted resource
- **THEN** no usable token is issued even with otherwise valid credentials

#### Scenario: Wrong verifier or callback
- **WHEN** a caller changes the registered callback or lacks the S256 verifier
- **THEN** code redemption fails without authorizing that caller

### Requirement: Explicit scoped client consent
The initiating protected browser SHALL display client identity and permissions and require explicit grant or deny. A grant SHALL bind one current admitted host or one currently authorized request. Read, write and decision permissions SHALL remain distinct. Account-free requester consent SHALL require no product login.

#### Scenario: Requester grants access
- **WHEN** a requester consents from a valid private request continuation
- **THEN** only that request and the chosen requester permissions are granted, with no host/private history access

#### Scenario: Client claims human approval
- **WHEN** a client presents a decision permission or model-generated approval statement
- **THEN** the service still requires separately attributable current human confirmation for the meeting decision

### Requirement: Signed bounded access tokens
Access tokens SHALL have a verified asymmetric signature, configured issuer, exact resource audience, access-token type, bounded expiry and client/grant/actor/permission binding. Tokens SHALL exclude login, continuation and provider secrets. Token-supplied keys, generic Auth tokens and Google credentials SHALL NOT establish agent authority.

#### Scenario: Foreign or altered token
- **WHEN** an access token has a wrong key, issuer, audience, type, expiry or modified claims
- **THEN** protected access is denied without returning private state

### Requirement: Durable single-use token lifecycle
Code consumption and refresh rotation SHALL be atomic. Reuse SHALL NOT issue another token family. Refresh SHALL preserve or narrow the existing resource, client, actor, permission and expiry boundary. Consumed refresh reuse SHALL revoke its family; lost responses SHALL require safe reauthorization rather than a new implicit grant.

#### Scenario: Concurrent code redemption
- **WHEN** two callers redeem the same code concurrently
- **THEN** at most one receives a usable token family

#### Scenario: Refresh replay
- **WHEN** an already-consumed refresh credential is reused
- **THEN** no new access is issued and the affected family loses authority

### Requirement: Current grant enforcement and revocation
Every protected operation and refresh SHALL check active client/grant state and current underlying host or request authority. Grant revocation, client disablement, host authority loss, requester rotation, closure or expiry SHALL deny further access even if a signed token has not expired.

#### Scenario: Closed requester grant
- **WHEN** a request closes after an agent token was issued
- **THEN** that token cannot read the conversation, mutate the request or refresh access

### Requirement: Bounded private protocol operation
Protocol endpoints SHALL enforce documented input/rate limits and return sanitized no-store errors. Only public verification keys SHALL be published. Private keys, codes, refresh credentials and underlying browser/provider credentials SHALL remain outside client metadata, logs and model context.

#### Scenario: Missing signing configuration
- **WHEN** signing material is absent or malformed
- **THEN** token issuance is unavailable without generating an ad hoc key or substituting provider credentials

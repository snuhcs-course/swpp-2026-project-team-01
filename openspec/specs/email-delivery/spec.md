# email-delivery Specification

## Purpose

Deliver authentication and transactional messages using the selected sender while preserving conversational email and safe handling of uncertain outcomes.

## Requirements

### Requirement: Separate transactional sending from conversations
New transactional emails SHALL use Cloudflare Email Service. Supabase Auth SHALL retain authentication authority with Google-only login for the MVP; email/password, email OTP and magic-link login SHALL NOT be offered. Cloudflare custom SMTP SHALL remain configured for applicable Auth notifications. AgentMail SHALL remain the conversational email provider. Missing Cloudflare configuration SHALL NOT fall back to another sender.

#### Scenario: Transactional email requested
- **WHEN** an enabled verification, recovery, or booking notification is dispatched
- **THEN** its sender is Cloudflare and its existing audience and authority restrictions remain enforced

#### Scenario: Cloudflare configuration unavailable
- **WHEN** an enabled new delivery lacks required Cloudflare configuration
- **THEN** no message is sent through AgentMail or a default sender as fallback

#### Scenario: MVP host login
- **WHEN** a host signs in to the MVP
- **THEN** authentication uses Google through Supabase Auth, with email login disabled and no emailed login link

#### Scenario: Authentication notification
- **WHEN** an applicable non-login Auth notification is sent in production
- **THEN** it uses Cloudflare SMTP without enabling email login or changing identity or session validation

### Requirement: Evidence-based delivery outcomes
The system SHALL record successful submission only with a provider message identity and affirmative acceptance for the intended recipients. Suppressed or bounced recipients SHALL NOT be marked successfully sent. Email submission SHALL NOT establish contact verification or change booking state.

#### Scenario: Successful HTTP response without recipient acceptance
- **WHEN** the provider response omits acceptance evidence or lists a recipient as suppressed
- **THEN** the application does not record successful submission

### Requirement: Preserve uncertain dispatch identities
The system SHALL freeze sender identity and content before dispatch. Previously dispatched Cloudflare messages SHALL NOT be automatically sent again after an uncertain outcome or process interruption. Previously dispatched AgentMail messages SHALL retain their original provider identity and bounded idempotent retry behavior.

#### Scenario: Cloudflare response lost
- **WHEN** a Cloudflare send may have succeeded but its response is lost
- **THEN** a later job records uncertainty without issuing another send

#### Scenario: Conversational delivery retry
- **WHEN** an uncertain AgentMail delivery is retried within its supported horizon
- **THEN** its original inbox, payload, and idempotency identity are retained

### Requirement: Operator invitation delivery
Successful remote operator invitation issuance SHALL deliver the issued credential through Cloudflare unless manual delivery was explicitly selected. The email SHALL target the bound recipient and include the setup URL, token, expiry, and same-email sign-in instructions. Local issuance and revocation SHALL NOT send email. Provider failure SHALL NOT claim redemption, automatically reissue, or retry an uncertain send.

#### Scenario: Remote invitation issued
- **WHEN** the operator issues a valid invitation with configured Cloudflare delivery
- **THEN** the confirmed invitation is submitted once to its bound email and its private dispatch evidence is saved before sending

#### Scenario: Missing sender configuration
- **WHEN** remote issue requests default email delivery without required Cloudflare configuration
- **THEN** issuance fails before creating an invitation or sending a message

#### Scenario: Invitation outcome uncertain
- **WHEN** the invitation send response is lost
- **THEN** the invitation and private recovery evidence are retained, its outcome is uncertain, and no automatic retry or reissue occurs

#### Scenario: Send-free operator operation
- **WHEN** the operator uses local issuance, revocation, or explicitly selects manual delivery
- **THEN** no email provider is called

### Requirement: Selected product sender domain
New production authentication, invitation, and transactional messages SHALL use `no-reply@findmeatime.com`. Existing dispatched messages SHALL retain their original immutable sender identity. AgentMail conversational inboxes SHALL remain available.

#### Scenario: Production message prepared
- **WHEN** a new production authentication, invitation, or transactional email is prepared
- **THEN** the configured sender is `no-reply@findmeatime.com`

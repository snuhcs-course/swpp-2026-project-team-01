# Spec Delta

## Purpose

Deliver authentication and transactional messages using the selected sender while preserving conversational email and safe handling of uncertain outcomes.

## ADDED Requirements

### Requirement: Separate transactional sending from conversations
New transactional emails SHALL use Cloudflare Email Service. Supabase Auth SHALL retain authentication authority and use Cloudflare custom SMTP in production. AgentMail SHALL remain the conversational email provider. Missing Cloudflare configuration SHALL NOT fall back to another sender.

#### Scenario: Transactional email requested
- **WHEN** an enabled verification, recovery, or booking notification is dispatched
- **THEN** its sender is Cloudflare and its existing audience and authority restrictions remain enforced

#### Scenario: Cloudflare configuration unavailable
- **WHEN** an enabled new delivery lacks required Cloudflare configuration
- **THEN** no message is sent through AgentMail, Resend, or a default sender as fallback

#### Scenario: Authentication email
- **WHEN** the production Auth sender is activated
- **THEN** Supabase login links are delivered through Cloudflare SMTP without changing identity or session validation

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

#### Scenario: Legacy delivery survives provider switch
- **WHEN** an uncertain AgentMail delivery is retried within its supported horizon
- **THEN** its original inbox, payload, and idempotency identity are retained

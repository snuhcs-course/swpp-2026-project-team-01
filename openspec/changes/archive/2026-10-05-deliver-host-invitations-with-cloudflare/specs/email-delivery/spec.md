# Spec Delta

## ADDED Requirements

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

#### Scenario: New message after domain change
- **WHEN** a new production authentication, invitation, or transactional email is prepared
- **THEN** the configured sender is `no-reply@findmeatime.com`

# Spec Delta

## ADDED Requirements

### Requirement: Explicit operator environment and retry identity
Invitation administration SHALL require server-only operator credentials, an explicit matching project and an audit identity. Issuance retries SHALL retain one invitation, recipient, delivery mode and expiry. Changed input under the same retry identity SHALL conflict. An operator label alone SHALL grant no authority.

#### Scenario: Wrong environment
- **WHEN** a command's selected project differs from its configured service endpoint
- **THEN** the operation fails before creating, revoking or delivering an invitation

#### Scenario: Lost issuance reply
- **WHEN** an operator retries an issued invitation with the same identity and input
- **THEN** the existing invitation and original expiry are returned without another invitation or email dispatch

#### Scenario: Changed retry
- **WHEN** a retry changes the bound recipient or delivery mode
- **THEN** it fails without replacing the invitation or consuming another send

### Requirement: Private invitation recovery and status
Operator tooling SHALL report invitation and delivery status without printing readable codes in normal output or placing codes in URLs. Explicit manual delivery SHALL provide private recovery of the same valid code. Status SHALL distinguish issuance, provider acceptance, uncertainty, revocation, expiry and redemption; none SHALL imply host admission before verified redemption.

#### Scenario: Manual recovery
- **WHEN** an authorized operator explicitly requests manual delivery for a valid invitation
- **THEN** the same readable code is written only to a new private operator artifact, separately from the setup URL, without calling an email provider

#### Scenario: Revoked or expired recovery
- **WHEN** recovery targets an invitation that is revoked, expired or already redeemed
- **THEN** no usable invitation code is disclosed or sent

#### Scenario: Concurrent dispatch
- **WHEN** multiple workers process the same invitation delivery
- **THEN** at most one crosses the send boundary, and an interrupted dispatched attempt remains uncertain rather than sending again

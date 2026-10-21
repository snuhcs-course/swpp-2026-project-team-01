## MODIFIED Requirements

### Requirement: Evidence-based delivery outcomes
The system SHALL record successful submission only with affirmative provider acceptance for every intended recipient and with a dispatch identity: the provider's message identity when the provider returns one, otherwise an application dispatch identity frozen before dispatch and sent with the message. Suppressed or bounced recipients SHALL NOT be marked successfully sent. Email submission SHALL NOT establish contact verification or change booking state.

#### Scenario: Successful HTTP response without recipient acceptance
- **WHEN** the provider response omits acceptance evidence or lists a recipient as suppressed
- **THEN** the application does not record successful submission

#### Scenario: Accepted without a provider message identity
- **WHEN** Cloudflare lists every intended recipient as delivered or queued and returns no message identity
- **THEN** the submission is recorded as accepted with the application dispatch identity that the message carried

#### Scenario: Permanent bounce
- **WHEN** Cloudflare lists an intended recipient as a permanent bounce
- **THEN** the delivery is recorded as rejected for that recipient and no contact or request state changes

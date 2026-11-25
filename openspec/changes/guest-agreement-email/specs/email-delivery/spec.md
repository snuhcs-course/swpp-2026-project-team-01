## ADDED Requirements

### Requirement: Guest agreement receipt

When a guest agrees to the current proposal and the request enters awaiting host approval, the system SHALL record one email to the current contact address for that agreed version. A retry or duplicate agreement SHALL NOT record another delivery for the same version; agreement to a later version SHALL record its own delivery. The email SHALL be English HTML with a matching plain-text alternative and SHALL use the existing transactional email style. It SHALL name the guest and host, purpose, proposed date and time in the guest's named timezone, duration, online or in-person mode and place when in person. For an initial request it SHALL say the request was sent to the host, awaits approval and is not yet booked, and that the guest will be emailed after approval and booking confirmation. For a change to a confirmed booking it SHALL say the existing booking remains confirmed while the change awaits approval. Its **View request** action SHALL open the private booking page. It SHALL contain no address-confirmation action or host-private information.

#### Scenario: First agreement
- **WHEN** the guest agrees to a proposal that is still current
- **THEN** one email for that version is queued with its frozen summary and booking link

#### Scenario: Retry and new version
- **WHEN** the agreement command is retried or the guest later agrees to another proposal version
- **THEN** a retry makes no duplicate delivery and each newly agreed version has its own delivery

#### Scenario: Delivery is not confirmed
- **WHEN** the agreement email remains queued, fails, is uncertain or is suppressed
- **THEN** the guest page does not claim that a copy was sent

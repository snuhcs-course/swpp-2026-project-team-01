## MODIFIED Requirements

### Requirement: Optional sample request after host onboarding

The service SHALL offer a newly onboarded host one optional request-review tutorial after the first successful setup save. The offer SHALL say in one line, before asking, that a pretend guest sends a sample request for the host to approve or change and that no real person is messaged, with the same meaning in English and Korean. The host SHALL be able to accept or skip it on the web or in their linked Telegram, iMessage, or WhatsApp chat.

#### Scenario: The offer explains the tutorial
- **WHEN** the first setup save offers the tutorial
- **THEN** the offer says that a pretend guest sends a sample request, that the host tries approving or changing it, and that nobody real gets a message, then asks whether to try it

#### Scenario: Practice reviewing a request

- **WHEN** the host accepts the tutorial
- **THEN** a marked sample request appears with the usual approval, decline and details experience
- **AND** the host can ask Thyme about its requester, details or example times

#### Scenario: Finish practice

- **WHEN** the host approves, declines, asks to change the sample, or asks to end the tutorial
- **THEN** the tutorial ends and the sample disappears from the inbox
- **AND** it creates no booking, sends no guest notification, and uses no request creation or meeting quota

## ADDED Requirements

### Requirement: Weekly note check on WhatsApp
When the weekly note check records a review for a host linked on WhatsApp and the messaging window is open, the service SHALL send the same numbered list and link as on iMessage, and the host SHALL be able to answer by number under the same read-back rule. When the window is closed, the service SHALL send a pre-approved utility template that carries no event title, time or other event content and links to the review page, within the existing template limits, and SHALL send the numbered list once the host's next message opens the window. When the template cannot be sent, nothing SHALL be sent on WhatsApp, the review SHALL be shown in `/app`, and the candidates SHALL stay busy until the next weekly check.

#### Scenario: Window open
- **WHEN** the weekly check runs two hours after the host last wrote on WhatsApp
- **THEN** the host gets the numbered list with the review link as free-form text

#### Scenario: Window closed
- **WHEN** the weekly check runs three days after the host last wrote on WhatsApp
- **THEN** the host gets one template saying there are new entries to check, with the link and no event content, and after the host replies the numbered list follows

#### Scenario: Template not available
- **WHEN** the window is closed and the provider refuses the template as missing or not approved
- **THEN** nothing is sent again, `/app` shows the review, and the candidates stay busy until the next weekly check

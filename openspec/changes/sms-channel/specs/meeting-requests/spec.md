## MODIFIED Requirements

### Requirement: Agreement notice in the guest's linked chat
When a guest with an active iMessage, WhatsApp, Telegram or SMS binding agrees to a proposal, and when a guest links such a chat while their agreement waits for the host's approval, the service SHALL send that chat one English message of what the guest sent: the people, the purpose, the date and time with the guest's timezone named, the duration, and online or the place. It SHALL say the request waits for the host's approval and is not booked, or, for a change to a booked meeting, that the booked meeting stands until then, and SHALL NOT contain the booking link. Each agreed version SHALL send at most one such message per binding, and a version the guest reopened or the host decided before it was sent SHALL send none. WhatsApp's 24-hour window rule and the SMS limits SHALL apply as for every guest notice.

#### Scenario: Linked guest agrees
- **WHEN** a guest with a linked iMessage agrees to the current proposal
- **THEN** one message there lists the people, purpose, time with the zone, length and place or online, says it waits for the host's approval and is not booked, and has no booking link

#### Scenario: Guest links after agreeing
- **WHEN** a guest agrees and then links their WhatsApp from the waiting card
- **THEN** that chat receives the same message once

#### Scenario: Retried agreement notice
- **WHEN** the notice job runs again for the same version and binding
- **THEN** no second message is sent

#### Scenario: Guest linked by SMS agrees
- **WHEN** a guest with a linked SMS binding agrees to the current proposal
- **THEN** one plain-text SMS carries the same content and has no booking link

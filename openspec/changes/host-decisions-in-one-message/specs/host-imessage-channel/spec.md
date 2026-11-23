## ADDED Requirements

### Requirement: Several decisions in one message
In the linked iMessage, WhatsApp or Telegram conversation, a host message MAY carry several explicit decisions, each naming its own request by reference or requester name. The assistant SHALL apply every clear decision in the same turn to the request it names, through the same commands and guards as a decision on the conversation's own request, and SHALL NOT switch the conversation or ask the host to repeat a decision already made. A decision on another request SHALL resolve only among the host's own requests and SHALL answer that request's current proposal version. A name that matches several requests or none SHALL decide nothing for that request; the assistant SHALL ask about it alone and still apply the clear decisions. The reply SHALL report each request's outcome apart and SHALL NOT call an approved request booked before its booking is confirmed.

#### Scenario: Approve one request and decline another
- **WHEN** the conversation is about B, both A and B await the host's approval, and the host writes "approve A's, decline B's" with the two requesters' names
- **THEN** A's current proposal is approved once and its booking starts, B is declined once and its requester is told, the conversation stays on B, and the reply names both outcomes

#### Scenario: One decision is unclear
- **WHEN** the host writes "decline Dohyeon's and approve this one" and two open requests are from Dohyeon
- **THEN** the conversation's own request is approved, nothing is declined, and the assistant asks which of Dohyeon's requests the host means, naming each

#### Scenario: Another host's request
- **WHEN** the host names a request reference that is not one of their own requests
- **THEN** nothing is approved or declined for it

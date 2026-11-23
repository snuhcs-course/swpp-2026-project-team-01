## ADDED Requirements

### Requirement: English transactional email copy
All transactional email templates SHALL use English copy regardless of the request or account language. Their HTML document SHALL declare `lang="en"`, and the plain-text alternative SHALL carry the same English content. This requirement applies to subjects, preheaders, headings, body copy and action labels; it does not change in-product or generated email-conversation language.

#### Scenario: Korean-speaking guest receives a transactional email
- **WHEN** any transactional email is rendered for a request or account whose stored language is Korean
- **THEN** its subject, HTML and plain-text copy are English, and the HTML declares `lang="en"`

#### Scenario: Guest resends a booking link
- **WHEN** a guest requests the booking link again from a Korean-language request
- **THEN** the resend email uses the same English copy and presentation

#### Scenario: Meeting status emails describe their actual outcome
- **WHEN** a request, proposal or booked meeting changes status
- **THEN** the email states whether the request is awaiting a decision, closed, still being booked, confirmed, cancelled, or unchanged after a dropped change, without implying that an unbooked request is already accepted or confirmed

#### Scenario: Account emails describe deletion state
- **WHEN** an account deletion is scheduled, cancelled, completed, or closes a host's open requests
- **THEN** the email clearly states the current state and the action the recipient can take, if any

### Requirement: Ink-blue request-link email design
The HTML versions of request-creation and booking-link resend emails SHALL use a calm, professional, responsive layout based on the product's ink-blue palette: paper background, white content surface, dark ink text and `#2C3E63` primary actions. The booking link SHALL be the visually primary action. When an email-address confirmation link is present, it SHALL appear in a separate, secondary section that says confirmation is optional and scheduling continues without it. The emails SHALL retain a plain-text alternative.

#### Scenario: Address confirmation is optional
- **WHEN** the request-creation email includes an email-confirmation link
- **THEN** the booking link remains the primary action, the confirmation action is visually secondary, and the copy explains that scheduling continues without confirmation

#### Scenario: Address already confirmed
- **WHEN** the contact address is already confirmed
- **THEN** the email contains the booking action and omits the confirmation section

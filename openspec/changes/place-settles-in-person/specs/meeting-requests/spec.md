## MODIFIED Requirements

### Requirement: Guest assistant answers within its scope
The guest assistant SHALL take relative days such as next week or a weekday as days for an availability draft, also when moving a booked meeting. When the host offers online or in person and the guest names a place as where they will meet, it SHALL take that as in person without asking the form and carry that place into the details draft, with a place outside the host's listed areas following the rule for such places below; it SHALL ask online or in person only when the place is mentioned in passing or the same answer leans toward meeting online. It SHALL decline questions about the host as a person in one sentence and say what it can help with, and SHALL refuse a switch to the host's conversation or an approval as the host in one sentence, offering what the guest can do at this step without pointing them elsewhere to approve. For a place outside the host's areas it SHALL describe the host's places first, draft the other place only when the guest insists, say the host approves the place with the time, and apply it only when the guest confirms.

#### Scenario: Moving a booked meeting to next week
- **WHEN** a guest asks to move a booked meeting to next week
- **THEN** the assistant reopens it for a change and drafts next Monday to Sunday as availability without asking which days

#### Scenario: A place given as where to meet
- **WHEN** the host offers online or in person and the guest answers where to meet with one of the host's places
- **THEN** the assistant drafts in person with that place for the review card and asks no online-or-in-person question

#### Scenario: A place mentioned in passing
- **WHEN** the host offers online or in person and the guest mentions a place without saying they will meet there, or also leans toward meeting online
- **THEN** the assistant asks online or in person and records no meeting form

#### Scenario: Asking who the host is
- **WHEN** a guest asks what the host is like
- **THEN** the assistant declines in one sentence without describing the host and says what it can help with

#### Scenario: Asking to approve as the host
- **WHEN** a guest asks to switch to the host's conversation to approve
- **THEN** the assistant says it cannot, offers to agree to or change the current proposal, and does not send the guest to the host's account

#### Scenario: Insisting on a place outside the host's areas
- **WHEN** a guest asks for a place the host does not list and then says again that they want it
- **THEN** the first reply describes the host's places and drafts nothing, the second drafts the place and says the host approves it with the time, and nothing is applied until the guest confirms

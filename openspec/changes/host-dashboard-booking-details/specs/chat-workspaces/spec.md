## ADDED Requirements

### Requirement: Pending decisions on the workspace menu
Where the workspace menu offers the host's Requests, the menu button and its Requests item SHALL show the number of received requests that need the host's decision, as a round count with an accessible text equivalent. The count SHALL exclude sample requests, SHALL be refreshed when the page regains focus, when the menu opens and after the host acts on a request in the same tab, and SHALL disappear when no request needs a decision. A failed read SHALL keep the last count without an error.

#### Scenario: A request awaits approval
- **WHEN** a ready host with one received request awaiting approval opens `/app`
- **THEN** the menu button shows a count of 1, its accessible name says one request needs a decision, and the Requests item in the open menu shows the same count

#### Scenario: Last decision made
- **WHEN** the host approves or declines the only request that needed a decision
- **THEN** the count disappears from the menu button and the Requests item

#### Scenario: Only a sample request
- **WHEN** the host's only received request is the tutorial sample
- **THEN** no count appears

### Requirement: Booked meeting details on the Dashboard
Selecting a confirmed Find Me a Time meeting on the Dashboard SHALL show its time, length, mode, place for an in-person meeting or meeting link for an online one, and the guest's name with their email, marked when the address is not confirmed, together with an **Open request** action that opens that request in the host's Requests view. The meeting link SHALL be the join link Google returned for the event, or the requester's own link. A week block for the meeting SHALL show who it is with next to its time.

#### Scenario: Online meeting with Google Meet
- **WHEN** the host selects a booked online meeting whose event has a Meet link
- **THEN** the details show When, Length, Mode **Online**, the Meet link and With {guest name <email>}, and **Open request** opens that request

#### Scenario: In-person meeting
- **WHEN** the host selects a booked in-person meeting
- **THEN** the details show its place and no meeting link

#### Scenario: Short meeting in the week view
- **WHEN** a 30-minute booked meeting is drawn in the week grid
- **THEN** its block shows the time and the guest's name on one line

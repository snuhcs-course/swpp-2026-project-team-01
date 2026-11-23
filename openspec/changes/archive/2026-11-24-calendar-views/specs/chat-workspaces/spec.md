## ADDED Requirements

### Requirement: Host calendar beside a decision
While a received request in the host's Requests view shows a proposal, a suggestion, the offered times of a private search or the **Request changes** editor, the view SHALL show the host's own calendar for that week beside the decision card on a wide screen and with it on a narrow one, as one day with a day switcher on a phone. The calendar SHALL show the events the Dashboard shows for that week, with the proposed time, a suggestion and the time being edited marked over them in text as well as colour, and SHALL move to a new proposed or edited time. Choosing an offered time or an empty time on the calendar SHALL open **Request changes** with that time filled in and SHALL share nothing until the host shares the suggestion. The calendar SHALL NOT appear for the tutorial sample or a closed request, and a failed calendar read SHALL keep the marked times with an explanation.

#### Scenario: Proposal against the host's day
- **WHEN** the host opens a received request awaiting approval with a proposal at 10:00 on a day that has a Google event at 09:00
- **THEN** the host's week for that day is shown beside the decision card with the 09:00 event and the 10:00 time marked **Proposed**

#### Scenario: Suggest a time from the calendar
- **WHEN** the host clicks an empty 14:00 slot on the calendar
- **THEN** **Request changes** opens with that date and 14:00 filled in, the calendar marks it as the new time, and nothing is shared with the requester

#### Scenario: Calendar cannot be read
- **WHEN** the host's calendar cannot be loaded for the shown week
- **THEN** the marked times remain and a status line says the calendar could not be loaded

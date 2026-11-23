# Spec Delta

## ADDED Requirements

### Requirement: Same-day trip setting
Setup SHALL offer the same-day trip preference (`groupTrips`) as an optional setting with the starter default off, drafted, accepted and confirmed like the other settings, and shown on the web review card and in the linked-chat settings review. It SHALL be part of a proposal only when the meeting mode is in person or either, and a policy confirmed before the setting existed SHALL read as off, labeled starter default. The web SHALL ask it as its own step after the travel buffer unless the location is decided per meeting. The linked-chat setup SHALL NOT ask about it unless the host brings it up.

#### Scenario: Online host
- **WHEN** the host meets online only
- **THEN** no trip step is shown, the review does not list it, and confirmation does not save it as part of the proposal

#### Scenario: Policy confirmed before the setting
- **WHEN** a ready in-person host's policy has no trip setting
- **THEN** setup shows it as off, labeled starter default, and shows no pending change

### Requirement: Same-day trip suggestion
The calendar scan SHALL count, without storing any place name in the counts, the local days with a busy, timed in-person event (a location and no conference link) and the days with such an event at a place other than the most frequent one where that place also holds an in-person event on another day. With at least two such days the suggestion SHALL be on, labeled inferred, with its sample size and a reason that names no place; otherwise it SHALL be the starter default off. The suggestion SHALL become policy only after the host accepts it and confirms the settings.

#### Scenario: Trips that could share a day
- **WHEN** the scan holds in-person events at one place away from the most frequent one on two separate days
- **THEN** the trip setting is suggested on, labeled inferred, with **Use this**, **Adjust** and **Choose my own**, and nothing changes in the confirmed policy until the host confirms

#### Scenario: Only the usual area
- **WHEN** every in-person event is at the most frequent place, or each other place appears on one day only
- **THEN** the trip setting is suggested off as a starter default

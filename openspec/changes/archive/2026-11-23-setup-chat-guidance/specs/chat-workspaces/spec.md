## ADDED Requirements

### Requirement: Guided host setup in the linked chat
Host setup in a linked iMessage, WhatsApp or Telegram conversation SHALL show its progress: the first setup message SHALL say in one line what setup covers and roughly how long it takes; each step's question SHALL start with a line naming the step and where it stands among the four steps, Calendar, Meeting hours, Where you meet and Open times; and the first successful save SHALL say plainly that setup is done, with the booking link. The web setup SHALL use the same step names for the same steps. When the service saves the primary calendar as the default calendar roles, its message SHALL name the other calendars it would recommend checking for conflicts and ask once whether they should count too; without an answer, the primary calendar SHALL remain the only conflict calendar. Each message SHALL ask at most one question.

#### Scenario: Progress through setup
- **WHEN** a host who linked their chat goes through setup
- **THEN** the first message says what setup covers and how long it takes
- **AND** the calendar, hours, place and open-times questions start with "1/4 · Calendar", "2/4 · Meeting hours", "3/4 · Where you meet" and "4/4 · Open times"
- **AND** the first save replies that setup is done, with the booking link

#### Scenario: Other calendars are offered once
- **WHEN** the service saves the primary calendar as the default and Google lists a work calendar the host can read
- **THEN** the message names the work calendar and asks whether it should also be checked for busy times
- **AND** a later message about the saved roles does not ask again

#### Scenario: No answer keeps the primary
- **WHEN** the host does not answer the other-calendars question
- **THEN** the primary calendar stays the only calendar checked for conflicts and setup continues

#### Scenario: The host adds a calendar
- **WHEN** the host answers yes or names one of the listed calendars
- **THEN** the named calendars are added to the conflict calendars through the same calendar role checks as the web

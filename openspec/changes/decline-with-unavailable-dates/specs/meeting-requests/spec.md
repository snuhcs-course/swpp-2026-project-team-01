## ADDED Requirements

### Requirement: Other dates named when declining
A host declining a request SHALL be able to name up to 14 other dates that no longer work, beside **Decline request** on the proposal review, after the reference of a typed `decline` command in their linked conversation, or in words to their assistant in that conversation. Each date SHALL be kept, once, as the whole local day in the host's time zone in the declined request's excluded times, which its revised request leaves out of every search; a day that has already ended SHALL NOT be kept. No reason SHALL be asked for, stored or passed on, and the decline SHALL refuse any input other than the dates. A decline that keeps a booked meeting SHALL store no dates.

#### Scenario: Host names two more days
- **WHEN** the host in Asia/Seoul declines and names 3 and 5 December
- **THEN** the declined request's excluded times hold both days from 00:00 to 24:00 Asia/Seoul, and the guest's revised request offers no time on them and gives no reason

#### Scenario: Typed command with dates
- **WHEN** the host sends `decline K7Q2MX-3 2026-12-03 2026-12-05` from their linked conversation
- **THEN** the request is declined with those two days kept, and the reply says the guest's next request leaves them out without saying why

#### Scenario: A reason is never kept
- **WHEN** the host writes "decline it, Dec 3 doesn't work either, I'm travelling"
- **THEN** the assistant declines with 3 December as the only added input, and nothing about travelling is stored on the request

#### Scenario: Too many or malformed dates
- **WHEN** a decline names 15 dates, a date that does not exist, or an extra field
- **THEN** nothing is declined and the input is refused

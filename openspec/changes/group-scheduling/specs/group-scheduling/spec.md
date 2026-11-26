## ADDED Requirements

### Requirement: Group link created in the host's chat
A set-up host SHALL be able to create a group meeting in words, only from their linked messenger conversation, by giving the purpose, length, date range and the number of people. Whether the meeting is online or in person, and where, SHALL NOT be asked at creation. Thyme SHALL ask once for any of these terms that is missing, and SHALL then send one shared link. A turn from any other interface SHALL create nothing and say that group meetings start in the linked messenger. The group's terms SHALL NOT change after the link is sent.

#### Scenario: Host creates a group link
- **WHEN** a linked host writes "다음 주에 4명이랑 1시간 킥오프 잡아줘"
- **THEN** a group meeting for four people with those terms and no mode or place is created, and Thyme sends its shared link

#### Scenario: Missing date range
- **WHEN** the host gives purpose, length and number but no dates
- **THEN** Thyme asks for the date range and creates nothing until it is given

#### Scenario: Web turn
- **WHEN** a host asks for a group meeting in `/app`
- **THEN** nothing is created and the reply says group meetings start in the linked messenger

### Requirement: Shared link admits participants until full
Opening an open group link SHALL start that person's own participant request in the group, holding the group's terms, and SHALL continue a returning person's own request. The group SHALL count only participants who are done. When the count reaches the set number, or the host closes the group, the link SHALL show that the meeting is closed and SHALL start nothing; a participant still in progress SHALL be told the meeting is full and SHALL NOT be counted. The link SHALL have no expiry of its own and SHALL stay open until it is full or the host closes it, and its participant requests SHALL NOT expire while it is open.

#### Scenario: Last place filled
- **WHEN** the fourth of four participants finishes
- **THEN** the group closes and the next person to open the link sees that it is closed

#### Scenario: Someone opens and leaves
- **WHEN** a person opens the link and never finishes
- **THEN** they take no place and the group can still fill

#### Scenario: Group still open after weeks
- **WHEN** two of four participants are done, ten days pass and the host has not closed the group
- **THEN** the link is still open and the two done participants' requests have not expired

### Requirement: Host follows the group's progress
A group's participant requests SHALL NOT appear as requests of their own in the host's request lists, counts, dashboard or notices. Until the group closes, the service SHALL send the host nothing about it. The host SHALL be able to ask in the linked conversation how the group is going, and SHALL be told the number of done participants against the set number and the names of the done participants.

#### Scenario: Host asks for progress
- **WHEN** two of four participants are done and the host writes "몇 명 했어?"
- **THEN** the reply says two of four are done and names them

#### Scenario: Participant not listed as a request
- **WHEN** a participant is done
- **THEN** the host's request list and dashboard do not show their request, and the host gets no notice for it

### Requirement: Participant flow without picking a date
A participant request SHALL proceed in this order: Google identity and Calendar; one question about fixed commitments missing from the calendar, where they usually are and how they usually travel; a review of the times the participant cannot meet; an optional messenger link; and done. Calendar connection SHALL be required: a participant request SHALL offer no **Skip for now** and no manual availability, and SHALL NOT go past the first step without a Calendar grant. The participant SHALL NOT be offered times to pick, and the group's terms SHALL NOT be changeable by the participant.

#### Scenario: Calendar unchecked
- **WHEN** a participant unchecks the Calendar scopes on the consent screen
- **THEN** their name and email are filled in, they are asked to connect Calendar again, and no **Skip for now** is offered

#### Scenario: Participant asks for another length
- **WHEN** a participant writes "30분으로 줄여줘"
- **THEN** nothing changes and Thyme says the host set the meeting terms

#### Scenario: Usual place and travel
- **WHEN** a participant answers "보통 신촌에 있고 지하철 타요"
- **THEN** 신촌 is stored as their usual place and public transit as their travel mode

### Requirement: Participant confirms the times they cannot meet
The review SHALL list, within the group's date range, the participant's calendar busy times and the commitments they stated, and SHALL ask them to confirm or correct the list. A correction in words SHALL update the stated commitments and show the list again. Confirming SHALL store each listed interval with its start, end, all-day flag and, for a calendar event, its place, at neighborhood level or finer, together with the usual place, travel mode and any preferred hours the participant volunteered, and SHALL mark the participant done. A done participant SHALL NOT be able to change their answers. A participant's places and events SHALL NOT be shown to the host or other participants.

#### Scenario: Participant adds a commitment
- **WHEN** the review is shown and the participant writes "수요일 오후엔 수업 있어"
- **THEN** Wednesday afternoon is added as a stated commitment and the list is shown again

#### Scenario: Participant confirms
- **WHEN** the participant confirms the list
- **THEN** the confirmed intervals and their places are stored, they are offered a messenger link with a skip, and after it they are told an invitation will come by email

#### Scenario: Change after done
- **WHEN** a done participant writes "목요일도 안 돼"
- **THEN** nothing changes and Thyme says their answers were already sent to the host

### Requirement: Host told when the group closes
When the group closes, the service SHALL read the host's conflict calendars and SHALL find options in the date range for the host and every done participant under the feasibility rules, using each participant's confirmed intervals, places, usual place and travel mode as stored. Participant calendars SHALL NOT be read again. An in-person option SHALL be a time and a place where every person's travel legs fit; place candidates SHALL be tried in order: the host's venue and areas, then the participants' usual places, then points between the participants' places, a later tier only when the earlier ones give fewer than three options. An online option SHALL be a time that fits everyone without travel, offered when in-person options are fewer than three. The service SHALL send the host's linked conversation one message with up to three options, ordered by preferred hours and spread across the range, and SHALL answer the host's request for more in words. When no option fits everyone, the message SHALL list the options that fit the most participants and name who cannot make each. The message SHALL NOT reveal any participant's events or places.

#### Scenario: Host's area works for everyone
- **WHEN** four participants are done and three times at the host's area 강남역 fit everyone's travel
- **THEN** the host gets one message with those three time-and-place options and can ask for more

#### Scenario: Only a point between the participants works
- **WHEN** no time at the host's places or the participants' usual places fits everyone's travel, and a station between the participants' places does
- **THEN** the message offers times at that station

#### Scenario: Only online works
- **WHEN** no place fits everyone's travel at any time but some times fit everyone online
- **THEN** the message offers those times as online options

#### Scenario: No option for everyone
- **WHEN** no option fits the host and all four participants
- **THEN** the message lists the options that fit three of them and names the one who cannot make each

#### Scenario: Participant calendar changed after confirming
- **WHEN** a participant adds an event to their calendar after confirming their review
- **THEN** the close uses what they confirmed and does not read their calendar

### Requirement: Host closes the group early
The host SHALL be able to close an open group in words from the linked conversation. The close SHALL proceed with the participants who are done. A close with no participant done SHALL change nothing and say so.

#### Scenario: Early close
- **WHEN** two of four participants are done and the host writes "지금 있는 사람들로 정하자"
- **THEN** the group closes and the host gets the options for themselves and those two

### Requirement: Host's choice books one group event
The host SHALL choose by naming one of the options offered, including one that does not fit every participant. The service SHALL read the host's conflict calendars again for that option; an option that no longer fits the host SHALL book nothing and the host SHALL be told. Participant calendars SHALL NOT be read again. An option that fits SHALL be booked once as one event in the host's booking destination, at the chosen place or with a Google Meet link when online, with every done participant's email as an attendee, and Google's invitation SHALL be sent to them. Every participant request of the group SHALL then close as booked.

#### Scenario: Host picks the second option
- **WHEN** the host writes "두 번째로 해줘" and it still fits the host
- **THEN** one event at that option's place is created with all participants as attendees, each gets Google's invitation by email, and their requests are booked

#### Scenario: Host picks an online option
- **WHEN** the host picks an online option
- **THEN** the event is created with a Google Meet link and all participants as attendees

#### Scenario: Host picks an option one participant cannot make
- **WHEN** no option fits everyone and the host picks one that fits three of four participants
- **THEN** the event is booked with all four as attendees

#### Scenario: Time became busy for the host
- **WHEN** the host's calendar became busy at the chosen time
- **THEN** nothing is booked and the host is told the option no longer fits them

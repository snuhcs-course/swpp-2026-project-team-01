## ADDED Requirements

### Requirement: Weekly note check in the linked conversation
When the weekly note check records a review for a host linked on iMessage or Telegram, the service SHALL send one fixed message in the conversation's language with a numbered list of up to ten entries (title as quoted data, time and the classifier's recommendation), how to answer by number, and the review page link; further entries SHALL be named only by their count with the link. The host assistant SHALL see the list with its titles only as quoted data.

#### Scenario: iMessage list
- **WHEN** the weekly check finds three new candidates for a host linked on iMessage
- **THEN** one message lists them as 1 to 3 with their recommendations and the review link

#### Scenario: Telegram list
- **WHEN** the weekly check finds candidates for a host linked on Telegram
- **THEN** the same numbered list and link are sent as plain text

### Requirement: Freeing notes by number
In the linked conversation the host SHALL be able to answer the current weekly review by number. Before any entry is freed, the assistant SHALL read the chosen entries back by number and title and ask once, and only the host's clear yes to that read-back SHALL free them, under the same writeback rules as the review page. A condition, a question or a change SHALL free nothing. Keeping entries busy SHALL need no read-back. Numbers outside the list, an entry changed since the list, a review that is no longer current, and the same words typed on the web SHALL free nothing.

#### Scenario: Read-back then free
- **WHEN** the host replies "1, 3번 비워줘" to the list
- **THEN** the assistant asks "1번 엄마 생일, 3번 과제 마감을 비울까요?", nothing is freed yet, and after "응" both are freed once

#### Scenario: Unclear answer to the read-back
- **WHEN** the host answers the read-back with "3번은 잠깐만"
- **THEN** nothing is freed and the assistant asks which entries to free

#### Scenario: Keep busy by number
- **WHEN** the host replies "2번은 진짜 일정이야"
- **THEN** entry 2 is recorded as keep busy without a read-back and is not asked again

#### Scenario: Stale list
- **WHEN** the host answers last week's list after a newer review was sent
- **THEN** nothing changes and the reply points to the current review

## MODIFIED Requirements

### Requirement: Setup over iMessage
A linked host SHALL be able to finish setup in the linked conversation without opening `/app`. Sign-in, Google consent and protected fields SHALL stay browser steps; Thyme SHALL send a link for connecting Google Calendar that returns the host to the conversation. Linking SHALL send a welcome by where the host stands: a ready host is told what Thyme can do, a host without a usable Calendar gets the Calendar link, and any other host is told which calendar is used. Once the analysis settles, the service SHALL send the hours question once, with the suggested hours. Thyme SHALL then ask one place question that also asks how the host meets and travels, and ask again only for an answer that is missing. After the place answer, when the scan has note candidates, the service SHALL send the note review page link on every channel, and SHALL send the image of next week's open slots and their place only after the host confirms the review, with the confirmed notes no longer blocking it; with no candidates, or when the host skips the review in words, the image SHALL follow without it and the candidates SHALL stay busy. Thyme SHALL ask whether to open the slots. Settings SHALL be saved only for the current settings review whose image was sent, by the host's clear words to the assistant or the exact `confirm <ref>` command, under the same checks as the web confirmation, and the reply SHALL carry the booking link.

#### Scenario: Welcome into setup
- **WHEN** a host with a usable grant who is not ready confirms the received sender
- **THEN** the welcome says which calendar is used, and the hours question follows once the analysis settles

#### Scenario: Back from Google
- **WHEN** a linked host signs in with Google from Thyme's Calendar link
- **THEN** one message is queued to the linked conversation even if the sign-in is replayed, it does not claim Calendar was granted, and the browser returns to `/app`

#### Scenario: Note review before the image
- **WHEN** the host answers the place question and the scan has note candidates
- **THEN** the service sends the review page link, no slot image is sent yet, and after the host confirms "엄마 생일" as free the image shows that day open

#### Scenario: No note candidates
- **WHEN** the host answers the hours question and then "역삼역 근처, 대면이고 지하철로 다녀요" and the scan has no note candidates
- **THEN** Thyme asks nothing more and the slot image is sent

#### Scenario: Review skipped
- **WHEN** the host replies "나중에 할게" to the review link
- **THEN** the slot image is sent with the candidates still busy

#### Scenario: Slot image and link
- **WHEN** the host agrees to the slot image
- **THEN** the settings are saved and the reply carries the booking link

#### Scenario: Stale settings review
- **WHEN** the host sends `confirm <ref>` after the draft changed
- **THEN** nothing is saved and the reply names the current review's reference

## MODIFIED Requirements

### Requirement: Setup over iMessage
A linked host SHALL be able to finish setup in the linked conversation without opening `/app`. Sign-in, Google consent and protected fields SHALL stay browser steps; Thyme SHALL send a link for connecting Google Calendar that returns the host to the conversation. Linking SHALL send a welcome by where the host stands: a ready host is told what Thyme can do, a host without a usable Calendar gets the Calendar link, and any other host is told which calendar is used. Once the analysis settles, the service SHALL send the hours question once, with the suggested hours. Thyme SHALL then ask one place question that also asks how the host meets and travels, and ask again only for an answer that is missing. Thyme SHALL send next week's open slots and their place as one image and ask whether to open them. Settings SHALL be saved only for the current settings review whose image was sent, by the host's clear words to the assistant or the exact `confirm <ref>` command, under the same checks as the web confirmation, and the reply SHALL carry the booking link.

#### Scenario: Welcome into setup
- **WHEN** a host with a usable grant who is not ready confirms the received sender
- **THEN** the welcome says which calendar is used, and the hours question follows once the analysis settles

#### Scenario: Back from Google
- **WHEN** a linked host signs in with Google from Thyme's Calendar link
- **THEN** one message is queued to the linked conversation even if the sign-in is replayed, it does not claim Calendar was granted, and the browser returns to `/app`

#### Scenario: Two questions
- **WHEN** the host answers the hours question and then "역삼역 근처, 대면이고 지하철로 다녀요"
- **THEN** Thyme asks nothing more and sends the slot image

#### Scenario: Slot image and link
- **WHEN** the host agrees to the slot image
- **THEN** the settings are saved and the reply carries the booking link

#### Scenario: Stale settings review
- **WHEN** the host sends `confirm <ref>` after the draft changed
- **THEN** nothing is saved and the reply names the current review's reference

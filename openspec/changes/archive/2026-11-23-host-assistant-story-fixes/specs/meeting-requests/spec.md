## ADDED Requirements

### Requirement: Assistant replacement suggestions keep pending changes
A suggestion the host's assistant drafts while another suggestion is pending SHALL supersede it and SHALL keep each of its changes that the new suggestion does not change. A new meeting mode SHALL drop the pending place or meeting link that the mode does not use. A new place without a mode SHALL make the suggestion in person, dropping the pending meeting link, and a new meeting link without a mode SHALL make it online, dropping the pending place. A new place and meeting link without a mode SHALL keep the pending mode. The stored suggestion SHALL NOT pair a meeting mode with the place or meeting link of the other mode. A suggestion from the **Request changes** editor or the host's own agent SHALL replace the pending one as it is.

#### Scenario: Keep the pending time
- **WHEN** a suggestion moving the meeting to Wednesday 15:00 is pending and the host tells the assistant to make it in person at 강남역 and keep the time
- **THEN** the pending suggestion is superseded and the new one holds Wednesday 15:00, in person, at 강남역

#### Scenario: Change of mode
- **WHEN** a pending suggestion holds an in-person place and the host tells the assistant to make the meeting online
- **THEN** the new suggestion is online and holds no place

#### Scenario: New place without a mode
- **WHEN** a pending suggestion is online with a meeting link and the host tells the assistant to make it at 강남역
- **THEN** the new suggestion is in person at 강남역 and holds no link

#### Scenario: New link without a mode
- **WHEN** a pending suggestion is in person at a place and the host gives the assistant a meeting link
- **THEN** the new suggestion is online with that link and holds no place

#### Scenario: Mode and the other mode's detail
- **WHEN** a pending suggestion is online and the host's assistant drafts a place and a meeting link without a mode
- **THEN** the new suggestion is online with that link and holds no place

#### Scenario: Editor replaces
- **WHEN** a suggestion is pending and the host submits **Request changes** with only a new duration
- **THEN** the new suggestion holds only that duration

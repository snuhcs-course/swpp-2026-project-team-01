## ADDED Requirements

### Requirement: Signed-in account as a guest
A signed-in, active account that opens another host's booking link SHALL be able to start a guest request without creating another account or typing its contact details: **Continue as {name}** SHALL identify the request with the account's display name and its Google-verified sign-in address as the confirmed contact, and SHALL link the request to that account. Identification by account SHALL require a valid account session that is not the request's host, and SHALL grant the session no authority over the request beyond that identification; the booking identifier SHALL remain the request's only credential. When the account already has an open, linked request with that host and a live private link, the booking link SHALL offer to continue it. The guest page of a request linked to the signed-in account SHALL link back to `/app`, and neither role's state SHALL change by moving between them.

#### Scenario: Continue as the account
- **WHEN** a signed-in host opens another host's booking link and chooses **Continue as {name}**
- **THEN** the request is identified with the account's name and verified address, linked to the account, and opens on its guest page, and no new account or sign-in is created

#### Scenario: Request's own host
- **WHEN** identification by account is attempted for a request whose host is the signed-in account
- **THEN** it is refused and the request stays a draft

#### Scenario: No session
- **WHEN** identification by account is attempted without a valid account session
- **THEN** it is refused and the request stays a draft

#### Scenario: Resume an open request
- **WHEN** a signed-in host with an open, linked request to another host opens that host's booking link
- **THEN** the landing offers **Continue your request**, which opens that request's guest page

#### Scenario: Return to the workspace
- **WHEN** the signed-in account opens the guest page of its linked request and follows **Back to your workspace**
- **THEN** `/app` shows its own setup and request review unchanged, and the sent request appears in Requests

#### Scenario: Another account's request
- **WHEN** a signed-in account opens a booking link it holds for a request that is not linked to it
- **THEN** the guest page works under the link as for any guest and shows no workspace link

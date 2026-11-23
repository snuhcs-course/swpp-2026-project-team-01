# guest-account-history Specification

## Purpose
Keep a signed-in guest account's requests and their conversations for as long as the account exists, list them in one place, and close the requests the account sent when it is deleted. Recorded by [guest-account-history](../../changes/archive/2026-11-23-guest-account-history/proposal.md).

## Requirements

### Requirement: Account-owned request history
A closed request matched to an account by a verified Google subject or signed-in session SHALL be kept, with its conversation, for as long as that account exists, instead of being deleted 90 days after it closed. A request without such a match SHALL keep the 90-day rule. Deleting the account SHALL remove the match, after which the request SHALL follow the 90-day rule with its host.

#### Scenario: Old closed request of a live account
- **WHEN** a request matched to an existing account closed more than 90 days ago
- **THEN** the retention pass keeps it and the account's Requests list still shows it

#### Scenario: Account deleted
- **WHEN** the account is deleted and its matched request closed more than 90 days ago
- **THEN** the next retention pass deletes the request with everything under it

#### Scenario: Guest without an account
- **WHEN** a request without an account match closed more than 90 days ago
- **THEN** the retention pass deletes it

### Requirement: One list of the account's requests
The Requests view SHALL list the requests the account sent, open, booked and closed, with those it received. Selecting an open sent request whose private link is valid SHALL open its request page. Selecting any other sent request SHALL show that request's conversation in the list, read only, with a link to the request page while its link lasts. The conversation SHALL be served only to the account the request is matched to, and SHALL accept no new message there. A guest without an account SHALL keep using per-request links.

#### Scenario: Closed sent request
- **WHEN** the account opens a declined, withdrawn, expired, cancelled or booked request it sent
- **THEN** the conversation it had on the request page is shown read only

#### Scenario: Another account's request
- **WHEN** an account asks for the conversation of a request it did not send, including one it received
- **THEN** the service answers that the request is unavailable and reveals nothing

### Requirement: Account Calendar grant lifetime
A request that uses the account's own Google connection SHALL use the account's grant, which SHALL last until the account disconnects Google or is deleted. Closing the request SHALL clear only that request's use of it. A guest without an account SHALL keep request-bound grants.

#### Scenario: Request closes
- **WHEN** a request that used the account's calendars closes
- **THEN** the request no longer reads them and the account's Google connection is unchanged

### Requirement: Deleting an account closes the requests it sent
Deleting an account, from Settings or by the operator, SHALL withdraw every request the account sent that is still open and SHALL cancel every meeting it booked as a guest that has not started, as the requester would: the host's event is deleted and the host is told of the cancellation. Requests already closed and meetings that started SHALL be left as they are. A booking whose calendar write may be in progress SHALL be retried until its outcome is known. The Delete account card and the scheduled-deletion email SHALL say this. The operator command SHALL accept the account's Google address for an account without a handle.

#### Scenario: Open sent request
- **WHEN** an account with an open request sent to another host is deleted
- **THEN** that request is withdrawn

#### Scenario: Booked meeting ahead
- **WHEN** an account with a booked meeting still to come as a guest is deleted
- **THEN** the meeting is cancelled, the host's event is deleted, and the host is told

#### Scenario: Operator deletes a guest account
- **WHEN** the operator runs `delete-host` with the Google address of an account without a handle
- **THEN** that account is deleted as by Settings

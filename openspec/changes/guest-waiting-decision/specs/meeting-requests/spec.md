## ADDED Requirements

### Requirement: Explain the guest's wait after agreement
When the guest agrees to the current proposal, the booking page SHALL immediately show a dismissible success dialog containing only the successful-send confirmation and a **View request** button. Closing the dialog SHALL return focus to the persistent waiting card. A failed agreement SHALL show a failure alert asking the guest to try again, without claiming success. An unavailable time SHALL direct the guest to choose another time; an uncertain outcome SHALL ask them to check status before retrying. Closing the failure alert SHALL return focus to the relevant request card. Reloading the page SHALL NOT reopen either alert. The waiting card SHALL say that the request awaits host approval, that no meeting is booked yet, and that the host's decision will be emailed to the displayed contact address. It SHALL explain that updates can also arrive through a linked iMessage or WhatsApp channel. It SHALL say an agreement copy was sent only when the agreement email flow has confirmed delivery, and SHALL name the actual recipient of that send.

#### Scenario: Agreement succeeds
- **WHEN** the guest agrees to the current proposal and the command records the agreement
- **THEN** a short success dialog confirms the send and offers **View request**, whose dismissal focuses the waiting card

#### Scenario: Agreement does not succeed
- **WHEN** agreement fails or the chosen time is no longer available
- **THEN** a failure alert appears with a relevant next step and no success claim

#### Scenario: Agreement outcome is uncertain
- **WHEN** the command response is lost and the refreshed request is not waiting for the host
- **THEN** the alert says the outcome could not be confirmed and asks the guest to check status before retrying

#### Scenario: Lost response after a committed agreement
- **WHEN** the command response is lost but the refreshed request is waiting for host approval
- **THEN** no failure alert claims the request was not sent

#### Scenario: Waiting without a sent agreement email
- **WHEN** a guest agrees and the agreement email has not reported a confirmed send
- **THEN** the waiting card names pending host approval, the absence of a booking, the contact email and the optional messaging channels, without claiming that an agreement email was sent

#### Scenario: Agreement email sent
- **WHEN** the agreement email flow reports a confirmed send for the current agreement
- **THEN** the waiting card says the agreement copy was sent and displays the recipient reported by that flow

#### Scenario: Reload while awaiting approval
- **WHEN** the guest reloads the booking page while the host has not decided
- **THEN** the waiting card still explains the state and decision destinations without reopening the success dialog

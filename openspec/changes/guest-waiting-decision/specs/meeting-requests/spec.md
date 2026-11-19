## ADDED Requirements

### Requirement: Explain the guest's wait after agreement
When the guest agrees to the current proposal, the booking page SHALL immediately show a dismissible success dialog containing only the successful-send confirmation and a **View request** button. Closing the dialog SHALL return focus to the persistent waiting card. A failed agreement SHALL show a failure alert asking the guest to try again, without claiming success. An unavailable time SHALL direct the guest to choose another time; an uncertain outcome SHALL ask them to check status before retrying. Closing the failure alert SHALL return focus to the relevant request card. Reloading the page SHALL NOT reopen either alert. The waiting card SHALL name pending host approval in its heading and confirm submission in a separate introductory sentence. Its following paragraph SHALL explain email delivery to the displayed contact address when the host approves and optional linked iMessage or Telegram updates. It SHALL say an agreement copy was sent only when the agreement email flow has confirmed delivery, and SHALL name the actual recipient of that send.

The waiting card SHALL offer **Email updates only** beside available messaging channels instead of an optional-email footnote. Only the authorized requester MAY save this request-scoped preference through the command pipeline. Saving SHALL end active messaging bindings, suppress their unsent outbound messages and cancel pending linking attempts atomically with the preference. It SHALL NOT change request state or scheduling details. Successful persistence SHALL replace channel buttons with an email-only receipt and show a Thyme acknowledgment below the card. These SHALL survive reloads. No **Change** action SHALL be shown. Failed saves SHALL retain the choices and show a retryable error without claiming success.

#### Scenario: Guest chooses email only
- **WHEN** the guest selects **Email updates only** and the command succeeds
- **THEN** the preference is stored for that request, messaging delivery is ended, and the receipt and Thyme acknowledgment remain visible after a reload without a **Change** control

#### Scenario: Email-only preference cannot be saved
- **WHEN** the command fails before saving
- **THEN** the channel choices remain available with an error and no successful-save acknowledgment

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
- **THEN** the waiting card names pending host approval, confirms submission, and explains the contact email and optional messaging channels, without claiming that an agreement email was sent

#### Scenario: Agreement email sent
- **WHEN** the agreement email flow reports a confirmed send for the current agreement
- **THEN** the waiting card says the agreement copy was sent and displays the recipient reported by that flow

#### Scenario: Reload while awaiting approval
- **WHEN** the guest reloads the booking page while the host has not decided
- **THEN** the waiting card still explains the state and decision destinations without reopening the success dialog

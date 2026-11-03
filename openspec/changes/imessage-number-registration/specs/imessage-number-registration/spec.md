## ADDED Requirements

### Requirement: Number before an iMessage link code
Every iMessage link start SHALL ask for the person's mobile number before creating the link code: the host's link step and Connect iMessage card, the landing's iMessage start and the guest's **Get updates in iMessage**. The service SHALL normalize the number to E.164 and register it as a user of the Photon project before creating the attempt. An attempt SHALL NOT be created when the number is missing or malformed, or when the registration is refused or its answer is lost. The entered number SHALL NOT be stored by the service. A WhatsApp link SHALL ask for no number.

#### Scenario: Number registered first
- **WHEN** a host enters a mobile number and asks for an iMessage code
- **THEN** the number is registered with Photon, then the one-time code and its message are shown as before

#### Scenario: Registration refused
- **WHEN** Photon refuses the number or the project is full
- **THEN** no attempt is created and the screen says the number could not be registered

#### Scenario: No number
- **WHEN** an iMessage code is requested without a number
- **THEN** the request is refused as invalid and nothing is registered

### Requirement: Message addressed to the assigned number
An iMessage link attempt SHALL keep the number Photon assigned to the registered user, and every screen showing its pending code SHALL address the message, the deep link and the QR code to that number.

#### Scenario: Assigned number shown
- **WHEN** Photon assigns a number to the registered user
- **THEN** the pending code's screen, after a reload too, shows that number as the recipient

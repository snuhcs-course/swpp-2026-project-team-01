## ADDED Requirements

### Requirement: Calendar consent on the onboarding sign-in
A Google sign-in that links an iMessage conversation (started from the iMessage start in that browser, from Thyme's sign-in link, or marked `return=imessage`) and asks for Calendar SHALL ask Google to show the consent screen and keep earlier grants, so that Google returns a refresh token. When the linked host's Google grant still cannot use Calendar, the welcome SHALL name the cause read from the stored grant: Google did not confirm the Calendar permission, Google gave no lasting access, or the access ended. A host with no Google grant SHALL be asked for Calendar with no cause.

#### Scenario: Account that authorized the client before
- **WHEN** a host whose Google account already authorized Find Me a Time signs in from the iMessage start and ticks the Calendar permissions
- **THEN** Google shows the consent screen, a refresh token is stored, and the welcome in iMessage does not ask for Calendar again

#### Scenario: Calendar permission unticked
- **WHEN** the host unticks the Calendar permissions on that consent screen
- **THEN** the welcome sends the Calendar link and says Google did not confirm the Calendar permission

#### Scenario: Access ended
- **WHEN** Google rejected the stored refresh token before the conversation was linked
- **THEN** the welcome sends the Calendar link and says the Calendar access ended

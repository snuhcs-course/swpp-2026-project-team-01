## ADDED Requirements

### Requirement: Linking on the code's arrival
A host's link code on iMessage, WhatsApp or Telegram SHALL bind its sender as soon as the code's message arrives, when the code is pending and unexpired, the message comes from a direct conversation on the channel the code was made for, the host is active, and no other host holds the sender. No browser confirmation SHALL be asked. The messenger SHALL receive the linked message in that conversation, and the page that showed the code SHALL show **Linked** with the sender's last four digits, Apple ID or Telegram name and **Not my number — unlink** without a reload. A code SHALL be single-use, valid for 15 minutes, owned by the signed-in account that showed it, and limited to 5 per host per hour. A code from the iMessage start before sign-in SHALL be bound by the Google sign-in of the browser that showed it, or from the sign-in link Thyme sent its sender.

#### Scenario: Link on arrival
- **WHEN** a host sends the shown code from their iMessage, WhatsApp or Telegram
- **THEN** that sender is bound to the host, the messenger replies once that the account is linked and setup continues there, and the page moves to **Linked** by itself

#### Scenario: Wrong number linked
- **WHEN** a code leaked and another person sent it first
- **THEN** the page shows that person's last four digits or name with **Not my number — unlink**, and unlinking ends the binding so the host can make a new code

#### Scenario: Used or replaced code
- **WHEN** a code that already linked, was replaced by a newer code, or expired arrives
- **THEN** nothing is bound and the sender gets at most a fixed reply

#### Scenario: Start before sign-in
- **WHEN** a visitor sends the code from the iMessage start and then signs in with Google in the same browser
- **THEN** the sender is bound to that host without any further step

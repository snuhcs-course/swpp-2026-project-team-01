## ADDED Requirements

### Requirement: Thyme's cat sticker on a guest's Telegram reply
When Thyme's reply to a guest's Telegram message would end with a cat on the guest's web conversation, the bot SHALL send that cat as a sticker right after the reply's last text message: the same cat, chosen by the same sources, order and no-repeat rule, from the turn's recorded tool results. The sticker SHALL be best effort: a sticker that fails SHALL NOT make the reply uncertain or failed and SHALL NOT be retried, and no sticker SHALL be sent when the reply's text was not accepted. A host's Telegram replies, and a guest's replies on any other channel, SHALL carry no sticker.

#### Scenario: Agreement recorded over Telegram
- **WHEN** a linked guest agrees in Telegram and `agree_to_proposal` returns `recorded: true`
- **THEN** the bot sends Thyme's reply and then the happy cat sticker

#### Scenario: Agreement refused over Telegram
- **WHEN** the guest agrees but `agree_to_proposal` returns `recorded: false`
- **THEN** the bot sends Thyme's reply and no sticker

#### Scenario: The sticker fails
- **WHEN** the reply's text is accepted and `sendSticker` is refused
- **THEN** the reply is recorded as accepted and nothing is sent again

#### Scenario: A host's reply
- **WHEN** a host's Telegram turn records an outcome
- **THEN** the bot sends the reply with no sticker

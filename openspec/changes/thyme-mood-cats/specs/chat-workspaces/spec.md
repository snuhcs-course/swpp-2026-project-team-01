## ADDED Requirements

### Requirement: Thyme's cats on the guest's web conversation
On the guest's web conversation, a Thyme message MAY end with one cat sticker on the bottom-right corner of its last bubble: the happy cat or the sorry cat. The happy cat SHALL appear only when, in the same message, `agree_to_proposal` recorded the guest's agreement, `read_booking_status` reported the meeting booked, or the guest asked for it and the assistant called `show_cat` with `happy`; and on the page's booked notice. The sorry cat SHALL appear when a tool call in the message failed with an error, or when the assistant called `show_cat` with `sorry`. A message SHALL show at most one cat, chosen in this order: a happy cat the guest asked for, the sorry cat, a recorded happy cat. A cat SHALL NOT repeat the cat of the previous Thyme message unless the guest asked for it. The sticker SHALL be decorative, hidden from assistive technology, and SHALL NOT appear in the tool trace, in the text of messenger replies or in emails.

#### Scenario: Agreement recorded
- **WHEN** the guest agrees to a proposal in the web conversation and `agree_to_proposal` returns `recorded: true`
- **THEN** Thyme's reply in that turn ends with the happy cat

#### Scenario: Agreement refused
- **WHEN** the guest agrees but the time is no longer free and `agree_to_proposal` returns `recorded: false`
- **THEN** Thyme's reply shows no happy cat, whatever its words say

#### Scenario: A tool fails
- **WHEN** a tool call in Thyme's turn ends in an error
- **THEN** Thyme's reply in that turn ends with the sorry cat, not the happy cat

#### Scenario: The same cat twice
- **WHEN** Thyme's previous message showed the happy cat and the next message also records an agreement
- **THEN** the next message shows no cat

#### Scenario: Reply in a messenger
- **WHEN** the same turn's reply is sent to the guest by iMessage or email
- **THEN** its text carries no cat, marker or tool trace

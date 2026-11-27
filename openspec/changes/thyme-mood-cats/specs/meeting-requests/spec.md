## ADDED Requirements

### Requirement: Guest assistant shows a cat
The guest assistant SHALL have a `show_cat` tool taking `happy` or `sorry` that changes no record and no reply text. It SHALL call `show_cat` with `sorry` once, in the turn where it corrects or apologizes for something it said or did wrong, and SHALL NOT call it for a refusal that is not its mistake, such as a time that is no longer free. It SHALL call `show_cat` with `happy` only when the guest asks to see the happy cat, and SHALL NOT call it to mark an agreement, a booking or any other outcome.

#### Scenario: Correcting its own mistake
- **WHEN** the guest points out that the assistant gave a time in the wrong timezone, and the assistant corrects it
- **THEN** the assistant calls `show_cat` with `sorry` once and writes the correction

#### Scenario: Time no longer free
- **WHEN** the guest agrees to a time that is no longer free on the host's calendar
- **THEN** the assistant offers new times and calls no `show_cat`

#### Scenario: Guest asks for the happy cat
- **WHEN** the guest writes "show me the happy cat"
- **THEN** the assistant calls `show_cat` with `happy` and changes nothing on the request

#### Scenario: Agreement in words
- **WHEN** the guest agrees and the agreement is recorded
- **THEN** the assistant calls no `show_cat`, and the happy cat comes from the record

# Spec Delta

## ADDED Requirements

### Requirement: Several candidate times in one agreement
A requester SHALL be able to make one proposal version of up to three distinct candidate times from the current evaluation and agree to all of them at once, on the web, through the guest's assistant and through the requester's agent. Agreement SHALL read the host's conflict calendars again for every listed time, and a time that no longer fits SHALL record no agreement and offer newly evaluated times. Agreement SHALL mean that any listed time works for the requester; the request SHALL await host approval as for one time, and the requester's **Change** SHALL reopen it as for one time.

#### Scenario: Guest offers three times
- **WHEN** the requester ticks three current candidate times, offers them and agrees to the resulting proposal
- **THEN** one proposal version lists the three times, the request awaits host approval, and the host is asked once

#### Scenario: Fourth time
- **WHEN** the requester tries to offer four times in one proposal
- **THEN** the input is rejected and no proposal is created

#### Scenario: One of the times became busy
- **WHEN** one of the listed times is busy on the host's calendars when the requester agrees
- **THEN** no agreement is recorded, the host is sent nothing, and new times are found

### Requirement: Host books one of the agreed times
For an agreed proposal of several times, the host's request view, messenger summary, messenger assistant and host agent tools SHALL show every time, numbered, and the host SHALL approve by naming one of them. Approval SHALL read the host's conflict calendars again for the chosen time; a time that no longer fits SHALL approve nothing and leave the other times available. A chosen time that fits SHALL become the next proposal version on its own, carrying the requester's agreement, and SHALL be approved and booked as a proposal of one time. An approval that names no time SHALL be rejected without change.

#### Scenario: Host books the second time
- **WHEN** the host presses **Book this time** on the second of three agreed times
- **THEN** that time is checked, becomes the agreed current version, and is booked; the other times are not booked

#### Scenario: Chosen time became busy
- **WHEN** the host books a time that is now busy on their calendar
- **THEN** nothing is approved, the host is told, and they can book another listed time or decline

#### Scenario: Messenger approval without a time
- **WHEN** the host approves a proposal of several times in the messenger without naming which
- **THEN** nothing is approved and the reply lists the numbered times with a button for each where the channel has buttons

#### Scenario: Repeated approval
- **WHEN** the host's approval is repeated from another interface after one time was booked
- **THEN** the existing booking is returned and no second time is booked

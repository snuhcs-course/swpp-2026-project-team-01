## ADDED Requirements

### Requirement: Requester agent agreement changes and honest decision results
A requester grant with `request:decide` SHALL be able to reopen its request's agreement while the request awaits the host's approval, through the same command as the booking page's **Change**, returning the request to choosing a time at a new revision so the earlier agreement can no longer be approved. After reopening, the grant's detail, time-finding and choosing tools SHALL work as before agreement. While the request awaits approval those tools SHALL refuse and name the reopening tool as the next step. The results of choosing and agreeing SHALL state what was recorded, so that only a recorded agreement tells the agent the host must now approve.

#### Scenario: Agent reopens a pending agreement
- **WHEN** a requester grant with `request:decide` reopens its request while it awaits the host's approval
- **THEN** the request returns to negotiating at a new revision, the host can no longer approve the earlier version, and the agent can change details, find times, choose and agree again

#### Scenario: Agent changes details without reopening
- **WHEN** a requester agent changes details, finds times or chooses a time while the request awaits the host's approval
- **THEN** the request is unchanged and the refusal names the reopening tool as the next step

#### Scenario: Nothing to reopen
- **WHEN** a requester agent reopens a request that no longer awaits the host's approval
- **THEN** nothing changes and the refusal says there is nothing to reopen, pointing a booked meeting to the booked-meeting change

#### Scenario: Chosen time is not an agreement
- **WHEN** a requester agent chooses a candidate time
- **THEN** the result says the chosen version is not yet agreed and the host has not been asked, and names the version to agree to once the person accepts it

#### Scenario: Agreement not recorded
- **WHEN** agreeing finds the host's time no longer free
- **THEN** the result says nothing was agreed and the host was not asked, and the request is not shown to the host as awaiting approval

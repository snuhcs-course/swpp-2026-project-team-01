## ADDED Requirements

### Requirement: Unconnected guest calendar receipt
When a guest settles the Calendar step without connecting a calendar, through **Continue without Google** or a Google sign-in without its Calendar part, the booking page's Calendar receipt SHALL say that the calendar is not connected and that the guest will give their times, and SHALL NOT call the step skipped. While the request is gathering or negotiating the receipt SHALL keep its **Change** action to connect a calendar later.

#### Scenario: Continue without Google
- **WHEN** a guest continues without Google and the booking page opens
- **THEN** the Calendar receipt reads **Not connected · You’ll tell Thyme your times** with **Change**, and **Request details** lists the Calendar as **Not connected**

#### Scenario: After agreement
- **WHEN** the guest has agreed and the request waits for the host
- **THEN** the Calendar receipt reads the same and has no **Change**

### Requirement: Host's request page after a suggestion
The host's request page SHALL show where a shared suggestion stands. While the current proposal is the one the host's shared suggestion wrote and the requester has not agreed to it, the proposal card SHALL name the suggested time as the host's suggestion and say that it waits for the requester, keeping **Request changes** and **Decline**. While a suggestion whose time failed the check was made against the latest proposal and the request is gathering or negotiating, the page SHALL show the rejection with its reason and the suggested time in place of that stale proposal. A suggestion being checked or reviewed SHALL still come first.

#### Scenario: Shared time waits for the guest
- **WHEN** a host shares a suggestion moving an in-person meeting from Fri 27 Nov 13:00 to 21:00 and its check passes
- **THEN** the host's page reads **Waiting for {requester}** and "You suggested Fri 27 Nov, 21:00–21:30" with the 21:00–21:30 time, and no longer shows 13:00

#### Scenario: Guest agrees to the suggested time
- **WHEN** the requester agrees to the suggested time
- **THEN** the host's page is the usual **Approve this meeting?** review

#### Scenario: Suggested time fails the check
- **WHEN** the shared suggestion's time fails the check
- **THEN** the host's page reads **That time does not work** with the reason and the suggested time, and says the earlier time no longer stands

#### Scenario: A newer proposal follows a rejection
- **WHEN** the requester picks another time after a rejected suggestion
- **THEN** the host's page shows that newer proposal, not the rejection

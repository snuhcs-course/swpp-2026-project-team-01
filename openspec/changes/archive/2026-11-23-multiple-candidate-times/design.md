# Design

## Context

`app.proposals` holds one immutable version per row with one interval (`start_at`, `end_at`) and the shared details in `details`. An agreement names one proposal, an approval names one proposal, and a booking copies the approved proposal's interval. Booking revalidation, the confirmation emails, the event payload and every receipt read the booked proposal's own details.

## Decisions

### 1. Several times live in one proposal version

A proposal of several times keeps its first (earliest) time in the existing columns and top-level fields and lists every time in `details.times`, each with its candidate ID, interval, mode, place and link plan, since candidates of an "either" or time-and-place request can differ in those. Agreement still names one version, so the guest's agreement, **Change**, expiry and stale-version rules are unchanged.

Rejected: one proposal row per time with a shared group. Versions are unique per request and "the current proposal" is the latest version everywhere, so a group would change every reader.

### 2. The host's pick becomes its own agreed version

`request.approve` with `option` inserts the next version holding only the chosen time (`details.pickedFrom` names the version and option it came from) and an agreement row for it, then approves and books that version as today. The guest agreed to that exact time as one of their options, so carrying the agreement does not create one the guest did not give. Bookings, revalidation, notices, emails and receipts therefore always read a proposal of one time and need no change.

A repeated approval of the version of several times from another interface finds the live booking through `pickedFrom` and answers as a repeat, as a repeated approval does today.

Rejected: recording the chosen option on `app.approvals` and teaching bookings to read it. It needs a migration and changes every booking reader.

### 3. Rechecks

Agreement reads the host's calendars for every listed time (the `agreement-calendar-recheck` check, once per time) because the host may book any of them; one that stopped fitting records nothing and publishes fresh times. Approval reads the host's calendars again for the chosen time only. A busy chosen time throws `invalid_input` with reason `time_unavailable` and changes nothing, so the version of several times stays current and the host can pick another or decline. As at agreement, a calendar that cannot be read does not block, because booking revalidation checks the interval before any event is written. If booking revalidation later finds a conflict, the request awaits approval of the picked version as it does today.

### 4. Messenger references

A button or typed command names one time as `<ref>-<version>-<n>`. WhatsApp allows three reply buttons, so a proposal of several times gets one **Book time N** button per time there and Decline and details stay in words; Telegram adds a Decline and details row. iMessage has no buttons and the host answers in words, which reach `approve_proposal` with `option`. A plain `approve <ref>-<version>` on a proposal of several times answers with the numbered summary instead of approving.

## Risks

- Agreement waits on the host's calendar once per time, up to three evaluation deadlines in the worst case, while it holds the request lock.
- Approval's recheck of the chosen time runs under the host's booking advisory lock, as booking revalidation does, so it can delay that host's other approvals for up to one evaluation deadline. It does not count the host's other reserved bookings as busy; booking revalidation does.
- A listed time that has already started blocks agreement to the others; the guest chooses again.
- The guest thread shows the host's pick as its own receipt ("The host chose") after the agreement receipt.

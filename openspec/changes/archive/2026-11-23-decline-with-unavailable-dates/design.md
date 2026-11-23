# Design

## 1. One input, three surfaces

`request.decline` takes `{ excludedDates?: string[] }`, strict, at most 14 real dates written `YYYY-MM-DD`. The card, the typed command and both decline tools send the same input through the command pipeline, so retry keys and expected revisions behave as for any decline, and an unknown field such as a reason is refused as invalid input.

## 2. Whole days in the host's zone

A named date means the whole local day in the host's confirmed time zone (UTC without one), from its first instant to the next date's first instant, so a clock change gives a 23- or 25-hour day, and a zone whose clock change skips midnight starts the day at its first existing hour. The days are appended to the closed request's `details.excludedTimes` after the request closes as declined, each once, leaving out a day that has already ended. The revised request already carries these, with the declined time, and every search treats them as all-day blocked time (U17).

## 3. No reason

Nothing in the input holds a reason. The typed command accepts only dates after the reference; any other word makes the message free text for the assistant, which is told to keep reasons out of the tool call. The guest's assistant learns only that the times no longer work, as U17 already says.

## 4. Declining a change after booking

Declining a change to a booked meeting keeps the meeting and starts no revised request, so the dates are accepted but not stored, and the card does not offer the field while a confirmed booking stands.

## Rejected

- A free-form date range or weekday rule ("every Friday"): more parsing and more room to leak intent, for a case the 14 single dates cover.
- Storing the days on the host's settings or calendar: they concern this guest's next request only; host-wide unavailability belongs in the settings and calendar, which every search reads afresh.

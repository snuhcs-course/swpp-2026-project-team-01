# Design

## Notice

Keep the existing `weekly_limit_hold` enqueue point in requester evaluation, keyed by request and settings revision. At dispatch, keep the live revision and hold checks. Replace the settings-only wording with bilingual copy that includes the request reference, requester name, limit and a question about allowing this request alone. Do not send a request-arrival notice.

## Linked conversation actions

Expose `waive_weekly_limit` and `allow_host_trip` in the host review dynamic tool set. Adapter functions authorize the session, require `channelOfTurn`, read the bound host request, run `waiveWeeklyLimitCommand` or `allowHostTripCommand` with the current request revision and a call-derived retry key, then wait briefly for the new host evaluation and report its current candidate summary. A trip call takes the evaluation ID, candidate ID, direction and minutes that `read_request` returned. Reuse command validation and revision guards; no new table or migration is needed.

The agent instructions distinguish a request-specific waiver from changing the saved weekly limit. They state that recording an exception is not a booking and that a fresh check may still find no time. They never call the exception on a question or unclear instruction.

## Verification

Test the notice copy and dedupe/stale behavior, tool exposure and channel guard, waiver and trip command path, and the resulting checked state. Update H03 M-7, M-8, M-8.1 and M-8.3 in the testing baseline.

## Provisional host question (#327)

The team will review whether this action should remain. Keep its adapter, notice variant and web rendering labeled `#327 host-question` for easy removal. Reuse the existing application-authored guest conversation input path (the same durable path used for an intake summary) with a call-derived stable UUID, and queue a guest notice identified by that input ID if a messenger is linked. The guest web conversation displays the application-authored question as a quiet message; the guest agent treats the quoted question as data and invites the guest to answer it. The guest notice uses the question text recorded with the input, not a second copy in the job payload. No host instruction from the question is executed as a guest decision.

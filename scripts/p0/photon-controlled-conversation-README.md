# Controlled Photon conversation probe

This P0 diagnostic uses the existing project and the exact Spectrum core/iMessage 12.10.1 scratch dependencies under ignored `.local/photon-transport-probe/node_modules`. It does not implement the P6 channel or authorize a booking. Obtain explicit authorization for the recipient and the fixed single test message before running the send mode. Register the actual iMessage handle as a project User without an onboarding invite.

Keep the CLI registration receipt at `.local/live-calendar-test/photon-test-user-created.json` with mode 0600. Keep a separate mode-0600 `photon-controlled-authorization.json` in that directory containing `target_sha256` (SHA-256 of the exact receipt `phoneNumber`), `project_id`, `message_sha256`, `message_count: 1`, and `authorized_at` (ISO timestamp). The message is exactly `Find Me a Time test: please reply TEST RECEIVED`. The helper binds the receipt, policy, project, and message before accessing the provider. Credentials remain in ignored root `.env`; no keys or recipient handles belong in tracked artifacts.

```sh
# Default: availability only, no message.
node scripts/p0/photon-controlled-conversation.mjs \
  --registration-receipt .local/live-calendar-test/photon-test-user-created.json

# Only after explicit authorization for that one message.
node scripts/p0/photon-controlled-conversation.mjs \
  --registration-receipt .local/live-calendar-test/photon-test-user-created.json \
  --send-once

# Observe the existing exact DM; never dispatch another message.
node scripts/p0/photon-controlled-conversation.mjs \
  --registration-receipt .local/live-calendar-test/photon-test-user-created.json \
  --observe-only
```

Before its only send call, the helper creates and fsyncs an exclusive private dispatch intent containing the immutable target/message binding, chat identity, and client message ID. Existing intent blocks subsequent sends before SDK initialization. Do not delete or replace it to retry after a denial, crash, or lost response. The direct Advanced transport disables SDK/gRPC retries and supplies the saved message ID; Spectrum still establishes the project/shared-DM boundary. A read-RPC policy denial is recorded separately from the authorized DM write; affirmative unavailable status stops the write.

Reply checks use server-filtered events and history for only the exact DM after intent creation. The sender, service, conversation, timestamp, and exact `TEST RECEIVED` text must match. Provider acceptance alone does not prove delivery. Missing acknowledgements stay uncertain. Runs are bounded to 49 seconds; private receipts and results stay mode 0600, and cleanup closes the direct transport and Spectrum. Capture SDK stdout/stderr privately because SDK logs may include sensitive fields; publish only the helper's allowlisted result object.

The [2026-10-05 authorized attempt](photon-controlled-conversation-results-2026-10-05.json) used one user-designated registered phone number. Both availability and the single write returned gRPC 7 with the known `Target not allowed for this project` classification. There was no accepted message or matching reply, and cleanup succeeded. A [subsequent refusal check](photon-controlled-resend-guard-results-2026-10-05.json) made zero send calls and never initialized the SDK. P0 task 2.3 remains incomplete. Confirm the user's actual Apple iMessage handle; if it already matches registration, investigate with Photon rather than rotating keys or retrying the write. [Official shared-target troubleshooting](https://photon.codes/docs/spectrum-ts/troubleshooting/imessage#target-not-allowed-for-this-project).

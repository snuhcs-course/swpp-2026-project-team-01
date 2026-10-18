# Tasks

## 1. Host phone connection and API contract

- [x] 1.1 Add `host_phone_connections`, `photon_outbound_attempts`, `photon_inbound_events`, and `host_imessage_messages` to `supabase/schemas/scheduler.sql` and a migration, including host/number uniqueness, inbox and message dedupe keys, RLS, and no Data API grants; verify the migration applies to a clean local database.
- [x] 1.2 Add owner-scoped connection service and `POST/GET /api/host/imessage/connection` plus retry contract, requiring a real session, E.164 input, safe masked status, and transactional outbox creation; verify server tests cover unauthenticated/demo rejection, duplicate submit, number collision, and owner isolation.
- [x] 1.3 Add connection expiry and bounded retry eligibility in the service; verify tests cover expired claims, connected-number replacement rejection, retry limit, and uncertain-outcome lockout.
- [x] 1.4 Add the bounded host iMessage onboarding release scope and future booking-command decision to the owning `documentations/` product documentation, linking this change's spec; verify the document preserves the existing guest web flow and does not present host request handling as already released.

## 2. Photon outbound transport

- [x] 2.1 Add a server-only Photon adapter and separate outbox worker using the installed managed `spectrum-ts` iMessage provider; verify adapter tests cover DM creation, conversation/line persistence before send, welcome copy, provider rejection, and no Photon imports from booking services.
- [x] 2.2 Persist send attempts with definite failure versus uncertain timeout handling and up to three controlled attempts; verify worker tests cover restart recovery, no duplicate job claim, cooldown, and no automatic resend after an uncertain outcome.
- [x] 2.3 Remove `scripts/imessage-agent.ts`, the `npm run imessage` command, and echo setup instructions; verify active runtime references no longer invoke the echo responder.
- [x] 2.4 Update `apps/web/.env.example` with server-only Photon variables and the disabled channel-confirmation gate, and deliver the setup/run instructions in chat as requested; verify no credential value is committed. Starting against a real configured project remains an operator check.

## 3. Photon inbound webhook and host matching

- [x] 3.1 Add the Node webhook route with raw-body HMAC/timestamp verification and configured webhook ID, then commit a unique inbox receipt before 2xx; verify route tests cover valid, unsigned, stale, malformed, duplicate, and DB-failure deliveries.
- [x] 3.2 Add a resumable inbox processor and normalized iMessage event adapter that match sender, DM conversation, line, and pending expiry, then connect the host once; verify service tests cover matching reply, duplicate event, unknown sender, group, wrong line, wrong conversation, and expired claim.
- [x] 3.3 Persist matched host inbound/outbound text with direction, message ID, timestamp, and conversation while clearing processed inbox text and discarding unknown bodies; verify tests cover ordered host history, duplicate delivery, outbound retry, and owner isolation.
- [x] 3.4 Ensure no inbound text invokes booking commands and no request text, phone, or secret appears in operational logs; verify regression tests leave guest web requests and host web accept/decline behavior unchanged.
- [x] 3.5 Deliver chat-only instructions for publishing/registering the HTTPS webhook, configuring and rotating its ID/signing secret, monitoring inbox failures, handling conversation data, and reconciling uncertain sends; verify the steps do not expose secret values.

## 4. Integration check

- [ ] 4.1 Document and perform the UI-free end-to-end check with a real authenticated host session and an authorized test iPhone: submit the host's E.164 number to the connection API, run the outbound worker, observe exactly one welcome on the phone and `sent` in the status API, reply in the same DM through the registered public HTTPS webhook, then observe `connected` and one stored inbound message. Verify repeated API calls and duplicate webhook delivery do not send or connect twice; record the outcome without storing the phone number or secrets in Git.
- [ ] 4.2 Verify a known non-iMessage recipient is rejected and document Photon's actual SMS/RCS fallback behavior before enabling general production sends; verify the result is recorded against the rollout gate in `design.md` without silently changing the iMessage-only target.
- [x] 4.3 Run the project's relevant server tests, typecheck, and OpenSpec validation after implementation; verify this change's artifacts and owning product/operations docs match the implemented API and status names.

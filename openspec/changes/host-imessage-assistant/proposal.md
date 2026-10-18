# Proposal

## Why

The host onboarding prototype asks “Where should Thyme text you?” and offers **Text me**, but the current app cannot initiate a Photon message or associate a reply with an authenticated host. The existing [iMessage agent specification](../../specs/imessage-agent/spec.md) only defines a standalone echo smoke test; the host flow needs a durable, account-bound messaging foundation before its UI is merged.

## What Changes

- Add a host-only, server-side `Text me` command that accepts a validated phone number from the authenticated host, creates a pending phone connection, and sends one English welcome message through Photon. The message welcomes the recipient to Find Me a Time and asks for a reply; the draft copy lives in the design, not in the behavioral requirement.
- Record delivery attempts and expose pending, sent, failed, and connected states so the future onboarding UI can display the result and offer a controlled retry. An outbound send alone never verifies phone ownership.
- Receive signed Photon inbound events through a webhook, store each inbound message once, and associate a reply with a host only when its sender and conversation match that host's pending or connected phone connection. A matching reply completes phone connection; unrecognized senders do not gain account or booking authority.
- Retain a host-scoped record of matched inbound text and outbound text with message IDs, direction, time, and conversation so a later scheduling change can use conversation context. Discard unknown senders' message bodies after routing.
- Isolate Photon send and inbound normalization behind a messaging adapter; keep project credentials, webhook secret, and any sender-line configuration on the server.
- Make the host flow verifiable before the onboarding UI is merged: configure Photon credentials and a reachable signed webhook, run the outbound worker, call the host API with a real authenticated session, receive the welcome on an authorized test iPhone, reply in the same conversation, and observe the connection become `connected` through the status API. Document the setup and repeatable steps without an authentication bypass.
- Remove the standalone echo responder and its run instructions so host replies cannot receive a connection-test message.
- Keep guest discovery and request submission on the existing web and invite-link flow. This change does not send booking-request summaries or execute accept/decline commands by text. Those later host interactions need a separate product decision and change.

## Capabilities

### New Capabilities

- `host-imessage-onboarding`: authenticated host phone enrollment, welcome delivery and retry, signed inbound ingestion, reply-based connection, and safe host identification.

### Modified Capabilities

- `imessage-agent`: remove the obsolete standalone echo requirements; host replies will be handled by the new signed webhook flow.

## Impact

- Backend surfaces: `apps/web/src/app/api/`, server services and provider boundary, database schema/migration in `supabase/`, and server-only configuration. Remove the legacy echo script and its run instructions while retaining the Photon SDK and credential configuration for the new outbound worker.
- No frontend UI is required in this change; the new command and status response become the future **Text me** UI contract and must support an end-to-end test using an authenticated API request. Guest routes and booking commands remain as they are.
- Product references: the host-first prototype [Claude artifact](https://claude.ai/artifact/BKDdAxa6N9qjGe3qwQrtf3), the repository [onboarding PRD](../../../documentaions/availability_onboarding/product_requirement_document.md), [request flow](../../../documentaions/availability_onboarding/user_flow.md), and [current iMessage spec](../../specs/imessage-agent/spec.md). The PRD currently excludes host request-handling AI; this proposal does not silently promote that future behavior into the current release.
- Decision for this slice: a reply from the same Photon sender in the same one-to-one conversation while a unique, unexpired pending connection exists is phone confirmation. The exact follow-up instructions shown with the welcome text, pending expiry, and retry limits are implementation details in the design. Product decisions still open: whether later host request summaries and accept/decline commands should run entirely in iMessage, and whether non-iMessage SMS/RCS fallback is permitted. Until that decision, this change targets iMessage and must not intentionally use another channel.

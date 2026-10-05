# CalTalk product specification

CalTalk is a personal scheduling assistant for one calendar owner. It combines a requester-facing booking flow with a phone-friendly host approval experience. The host retains control: no proposed meeting becomes a booking without explicit approval for the current proposal.

## MVP scope

- One host and one Google Calendar account.
- Requesters use a shared chat or booking link; an external agent can use the same scheduling flow through a documented machine interface.
- Collect purpose, duration, dates, time zone, and location; ask follow-up questions when details are missing.
- Use availability, owner preferences, conflicts, and travel buffers to rank possible times. Explain suggestions and offer alternatives.
- Notify the host on one mobile channel and let them review, discuss, revise, approve, or reject from a phone.
- Recheck availability before creating an event. If availability changed, require a new proposal and approval.
- Make retries safe so duplicate requests or approvals do not create duplicate events.
- Keep private calendar events and preferences private; a requester or their agent cannot approve for the host.

## Out of scope for the initial release

Multi-host onboarding, billing, group scheduling, automatic rescheduling, live route estimation, and simultaneous support for multiple mobile notification channels.

## Acceptance scenarios

1. A requester can submit a meeting need and receive a request identifier and pending-host-approval state.
2. The host can review and reject a proposal; no calendar event is created.
3. The host can request an alternative and explicitly approve the revised proposal from a phone.
4. A conflict introduced after proposal creation prevents booking and returns the request for another proposal.
5. Repeated retries/approval cannot create duplicate requests or events.
6. Requesters cannot read private host events or preferences, and stale proposal approvals are rejected.
7. Time zone conversion, missing information, conflicting/unavailable slots, and updated preferences are handled.

## Current implementation status

The Expo app provides a responsive host inbox, proposal review actions, a request form, and a preference preview. Without credentials it runs in a clearly labeled demo mode. Supabase migrations establish private host preferences, booking requests, messages, and idempotent event records with host-scoped row-level security. Google Calendar, LLM conversation, external-agent API/MCP, push notifications, and production authentication still require provider setup and server-side integration.

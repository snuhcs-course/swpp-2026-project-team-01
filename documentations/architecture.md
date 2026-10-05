# CalTalk architecture

## Components

- `apps/mobile`: Expo React Native application, targeting mobile and web from one TypeScript codebase.
- Supabase Auth: host identity and session persistence.
- Supabase Postgres: requests, message history, owner preferences, proposal status, and event idempotency records.
- Supabase Edge Functions (planned): trusted orchestration for requester/agent access, LLM calls, Google OAuth tokens, availability checks, and calendar writes.
- Google Calendar (planned): private host calendar integration; only candidate availability should cross into requester-facing responses.

## Trust boundaries

The Expo public client contains only the Supabase URL and anon key. RLS limits host-facing queries to the authenticated host. Google credentials, service role keys, LLM keys, and agent credentials belong in server-side secrets. Requesters should receive request-scoped capabilities, never host credentials or broad database access.

## Booking state flow

`collecting_details` → `pending_host_approval` → `approved` → `confirmed`

The host can move a pending proposal to `rejected`. If a fresh availability check finds a conflict after approval, the server must invalidate the proposal and use `needs_new_proposal`; a changed proposal increments its version and requires new host approval. Event creation uses one unique `booking_events.request_id` per request and an idempotency key with Google Calendar to protect retries.

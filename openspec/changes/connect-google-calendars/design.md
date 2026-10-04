# Design

## Context

See proposal.md. Google credentials exist but no actual user grant is recorded. Host setup and request continuation are separate principals; callback security must not depend on client-provided actor identity.

## Goals / Non-Goals

**Goals:** least-scope grant boundaries, encrypted server credentials, resumable consent, honest read/refresh failures.

**Non-Goals:** guest event writes, automatic calendar destination fallback, and Calendar event creation before P4.

## Decisions

- Persist expiring single-use OAuth state with authorized actor/request, PKCE verifier where supported, exact return destination, and a random HttpOnly Secure binding cookie. Start consent under current credentials; consume state atomically after validating browser binding. Only allow service-defined return URLs.
- Host scopes support calendar list/read and events on accessible writable calendars; requester scopes provide free/busy only. Store grant kind and subject/request ID explicitly so requester tokens cannot reach write adapters.
- Use offline consent and AES-GCM token encryption with a dedicated server key separate from rows. Never return ciphertext or plaintext tokens in DTOs; refresh with bounded deadlines and reject `invalid_grant` with reconnection. Missing refresh material remains incomplete.
- Persist selected conflict calendar IDs and booking ID after checking current list/accessRole. Recheck writable destination before P4 dispatch. Do not silently substitute `primary`.
- Disconnect removes local refresh material and revokes pending dependent authority. Requester access expires with request/token closure. Optional denial permits explicit manual/agent availability; a failed connected read pauses evaluation until the owner makes that replacement explicit.

## Risks / Trade-offs

- [Cross-origin callback cookie policy] → Use one server-origin OAuth start/callback flow and exercise the actual browser redirects.
- [Google Testing refresh expiry] → Document publishing/verification and show reconnect actions; local tests cannot certify production consent.
- [Encryption key loss/rotation] → Preserve separately managed versioned keys and fail closed rather than treating undecryptable grants as empty calendars.

## Migration Plan

Add grants and consent-state schema, generate/review migrations, deploy callback endpoint, register its exact URL, and test controlled host/requester consent. Configure web allowed origins and Supabase Auth URLs. Rollback preserves grant isolation and clears invalid pending states without exposing tokens.

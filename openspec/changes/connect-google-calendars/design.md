# Design

## Context

See [proposal.md](proposal.md). Host setup and request continuation are separate principals; callback security must not depend on client-provided actor identity.

Follow the [implementation plan](../../../documentations/technical_specification/04_implementation_plan.md): root `agent/`, Next.js in `apps/web/`, shared contracts and authorized server operations in root `lib/`, and separately built eve/web services composed through root `vercel.ts`. The reconstruction target is `https://release.findmeatime.com` with Supabase project `mriseqztcwmezvtawnbo`. Runtime and provider compatibility require fresh verification.

## Goals / Non-Goals

**Goals:** least-scope grant boundaries, encrypted server credentials, resumable consent, honest read/refresh failures.

**Non-Goals:** guest event writes, automatic calendar destination fallback, and Calendar event creation before booking implementation.

## Guest identity and timezone

Implement optional Google identity separately from Google Calendar authorization. Resolve the identity adapter and callback route before coding; request identity claims only for the sign-in action, and free/busy access only on the explicit Calendar action. Bind both flows to the initiating browser and authorized request or bounded intake draft. Validate subject and verified email server-side, preserve name/email review, and verify manual or alternate addresses before trusted recipient/recovery use. A matching email or successful login does not merge histories, claim a request, admit a host or agree to a meeting. Preserve skip/manual paths and do not require a product account.

Initialize the displayed timezone from browser IANA context unless the guest already chose one; expose a selector without an extra confirmation question. Persist explicit choice across callbacks/reload. Ask only when timezone is absent/conflicting or local-time/travel meaning is ambiguous. Display conversion preserves candidate instants; changed scheduling constraints trigger re-evaluation. See [guest intake](../../../documentations/technical_specification/02_frontend_architecture.md#guided-guest-intake).

## Decisions

- Persist expiring single-use OAuth state with authorized actor/request, PKCE verifier where supported, exact return destination, and a random HttpOnly Secure binding cookie. Start consent under current credentials; consume state atomically after validating browser binding. Only allow service-defined return URLs.
- Host scopes support calendar list/read and events on accessible writable calendars; requester scopes provide free/busy only. Store grant kind and subject/request ID explicitly so requester tokens cannot reach write adapters.
- Use offline consent and AES-GCM token encryption with a dedicated server key separate from rows. Never return ciphertext or plaintext tokens in DTOs; refresh with bounded deadlines and reject `invalid_grant` with reconnection. Missing refresh material remains incomplete.
- Persist selected conflict calendar IDs and booking ID after checking current list/accessRole. Recheck writable destination before booking dispatch. Do not silently substitute `primary`.
- Disconnect removes local refresh material and revokes pending dependent authority. Requester access expires with request/token closure. Optional denial permits explicit manual/agent availability; a failed connected read pauses evaluation until the owner makes that replacement explicit.

## Risks / Trade-offs

- [Cross-origin callback cookie policy] → Use one server-origin OAuth start/callback flow and exercise the actual browser redirects.
- [Google Testing refresh expiry] → Document publishing/verification and show reconnect actions; local tests cannot certify production consent.
- [Encryption key loss/rotation] → Preserve separately managed versioned keys and fail closed rather than treating undecryptable grants as empty calendars.

## Migration Plan

Add grants and consent-state schema, generate/review migrations, deploy callback endpoint, register its exact URL, and test controlled host/requester consent. Configure web allowed origins and Supabase Auth URLs. Rollback preserves grant isolation and clears invalid pending states without exposing tokens.

## Implemented consent boundary (2026-10-07)

`fmat_calendar_consent` is callable only by the service role and derives authority from original verified credentials. It locks current authority before consuming/saving single-use consent, fences older attempts on restart/disconnect, and checks revocation again after the external exchange. Host setup returns to `/app`; request consent returns to its exact `/booking/[bookingId]`. The browser receives an authorization URL and safe status only. The official Google SDK verifies signed OIDC claims; PKCE and nonce bind the exchange. AES-GCM authenticated context binds secrets to state or principal. The new desired schema and fourteenth migration preserve historical migrations.

Local database, real-Auth/integration and browser fixtures verify consent denial/replay/isolation and revocation during exchange. Exact release/local callbacks are registered. Host listing, selection and refresh are implemented as described below. Availability reads, requester refresh/recovery, explicit manual replacement, guest identity-only entry and live Google acceptance remain unfinished.

## Host calendar choices (2026-10-07)

A service-only Calendar-access RPC checks the current admitted host session before reading encrypted credentials and again after provider calls. A per-connection UUID changes on consent save; setup revision fences concurrent choices, and ciphertext comparison fences concurrent refresh. Current Calendar-list metadata is fetched again on confirmation. Conflict calendars may expose free/busy only; booking requires owner/writer access, including Google’s writer-without-private-access role. No destination is inferred from primary status. The browser explicitly confirms choices and receives only metadata, selection state and revisions. Listing is bounded to ten pages/15 seconds; refresh to ten seconds with retries disabled. Provider failures remain actionable failures, never empty-calendar substitutes.

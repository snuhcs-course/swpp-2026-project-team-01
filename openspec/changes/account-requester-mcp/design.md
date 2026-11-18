# Design

## Context

See proposal.md. `/mcp` grants already bind an active account, while requester tools run existing booking commands as a request actor. `requester_host_profiles` stores verified account/request associations used by the sent-request dashboard.

## Goals / Non-Goals

Reuse the requester command pipeline and verified account links. Preserve anonymous single-request grants, calendar consent and explicit meeting agreement; do not introduce a global anonymous identity.

## Decisions

- Allow request scopes alongside host scopes on account grants. Existing token scopes remain unchanged; refresh cannot expand them. Consent descriptions distinguish received requests from sent requests.
- Create via the existing command pipeline with account actor and per-grant retry identity. Reuse request identification/details logic and insert the account association atomically. Reject self-booking, matching the account-as-guest identity flow.
- Wrap existing requester tools with explicit request IDs and verified association/live-link checks. Use get_sent_request, check_sent_booking, cancel_sent_booking and change_sent_booking for collisions; keep all existing host and anonymous tool names.
- Reuse requester_host_profiles instead of a new owner column: it already represents verified association, is private with RLS, and is deleted with the account. Never attach by email. Existing verified associations become manageable only after explicit request-scope consent.

## Risks / Trade-offs

- Wider account consent reaches linked sent requests → show explicit request permission descriptions, retain read/write/decide separation and existing closure guards.
- Reusing requester tools risks role confusion → construct a requester context only after ownership checks; target host differs from the account actor.

Reference reviewed: OpenInstinct `d78cb0acf9724f5fa755e38e379c66138bdb8047`, `agent/lib/link-auth.ts`: derive account scope from the verified principal and bind interactive authorization to it. Existing Find Me a Time commands remain the implementation pattern.

## Migration Plan

No database migration. Deploy code and entry instructions together. Old host-only tokens retain their tool set; users reauthorize the same endpoint for request scopes. Rollback removes account requester tools without affecting stored requests or anonymous endpoints.

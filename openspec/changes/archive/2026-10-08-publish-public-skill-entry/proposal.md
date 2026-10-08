# Proposal

## Why

The promised public agent-entry documents are missing from the rebuilt application. Agents need versioned public instructions and an honest browser continuation before protected client integration can be verified.

## What Changes

- Serve root host-onboarding and per-handle requester Markdown on the configured reconstruction origin.
- Resolve requester targets through existing current public-readiness checks and project only public profile fields.
- Explain delegated coordination, separate identity/Calendar consent and required human decisions, with an explicit web fallback when tools are unavailable.
- Treat display text as quoted data, disable caching and expose no credentials or private state.

## Capabilities

### New Capabilities

- `public-agent-entry`: Versioned public skill documents and capability-aware web continuation.

### Modified Capabilities

None. Existing host admission and meeting-request authorization remain unchanged.

## Impact

Next.js public Route Handlers, shared document renderer, tests and owning documentation. No database changes or new dependencies. Basis: [interfaces](../../../../documentations/user_experience/03_interfaces.md), PRD FR-33/34 and [public entry architecture](../../../../documentations/technical_specification/01_backend_architecture.md#public-skill-entry-documents). OAuth/MCP/CLI and individual client acceptance remain owned by Phase 8 and the compatibility change. Root-domain promotion and handle rename/reuse policy remain release decisions; this slice neither changes handles nor claims those gates complete.

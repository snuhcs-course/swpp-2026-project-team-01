# Design

## Context

See [proposal.md](proposal.md). Deploy the reconstruction at `https://release.findmeatime.com` with Supabase project `mriseqztcwmezvtawnbo`. Current target structure is root `agent/`, Next.js in `apps/web/`, shared `lib/contracts/` and `lib/server/`, and separately built eve/web services composed through root `vercel.ts`.

## Goals / Non-Goals

**Goals:** verify runtime choices and integration limits using reproducible, sanitized evidence from the actual reconstruction environment.

**Non-Goals:** use a credential-presence check as live product evidence, implement channel scheduling inside adapters or assert client approval from model text.

## Decisions

- Follow the eve chat template's outer structure and installed-version API documentation. Pin reference revisions and dependencies during the runtime spike. Verify direct OpenAI access through eve with an entitled native model ID; failures cannot advance domain state.
- Application modules own authorization, identity/session mapping, scheduling rules, approval and durable effects. Verify host/request isolation on session create/read/list/stream/resume/tool paths and after revocation. Choose persistence, worker/recovery placement and execution limits through failure tests before dependent implementation.
- Test native eve Photon against the actual project credentials and SDK transport contract first. Create a separate bridge only if a demonstrated incompatibility requires it; no fixed Fly.io or transport-version assumption.
- Record credential presence, authenticated reads, deterministic fixtures and live end-to-end journeys separately. Each result names date, actual versions, procedure, sanitized outcome and gaps. Never store raw secrets, user tokens or private conversation bodies.
- Test Dots, Muse, Instinct, ChatGPT, Codex, Claude and Claude Code individually. OAuth discovery/registration, PKCE, resource audience, refresh, revocation and application-owned grants all need evidence. Authenticated web confirmation is the baseline; client-native approval requires attributable current human-confirmation evidence.
- Google Calendar checks cover separate host/requester scopes, current callback binding, refresh/revocation and controlled creation/reconciliation. Routes checks report geography and mode; missing estimates remain unresolved. AgentMail and Photon checks distinguish provider acceptance, delivery and actual replies, including uncertain-send recovery.
- Keep product expiry, recovery, language and online-link policies in the [PRD](../../../documentations/02_product_requirements.md) and [backend architecture](../../../documentations/technical_specification/01_backend_architecture.md); probes verify those policies rather than inventing alternatives.

## Risks / Trade-offs

- Interactive consent/client unavailable → keep that named gate open and continue independent implementation.
- Provider capability differs from a template → verify actual versions/credentials and record the selected boundary before adopting it.
- Fixture mistaken for live integration → label evidence type and require separate controlled product journeys.
- Travel coverage gap → preserve clarification/manual allowance behavior, never infer zero travel.

## Execution and verification

Start with the smallest runtime and read-only probes, then fixtures for invalid/revoked/duplicate cases, then controlled consent and end-to-end journeys. Deploy and verify callbacks at the reconstruction origin before updating external registrations. Limit live sends/writes to authorized controlled identities. Keep current setup and the implementation plan aligned with verified outcomes, while recording unresolved gates explicitly. No compatibility task closes solely because a SDK call or transport probe succeeds.

## AgentMail signature contract (2026-10-08)

The pinned Svix 2.7 transport probe verifies raw UTF-8 content, then parses separately because the current SDK returns no payload. It emits only scoped event/message locators and a signed-body digest, preserving omitted-body events for a later authoritative read. Sender fields are not interpreted as verified identity. A future durable ingress must own replay/conflict rejection and acknowledge only after commit. No public receiver or provider registration is added by this probe; complete requester routing and live reply evidence remain required.

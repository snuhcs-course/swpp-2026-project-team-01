# Frontend Architecture

Date: 2026-10-19

Status: proposed design; implementation pending

Companion: [Page list](../user_experience/04_page_list.md)

## Scope and decisions

Use Next.js App Router, React, TypeScript and npm, with eve as the intended conversation runtime. Retain shadcn/ui and selected AI Elements as UI direction; exact versions/preset compatibility must be freshly pinned in the foundation slice. Apply [Thyme visual direction](../../DESIGN.md). No package, component or runnable route exists yet.

The UI depends on client-safe contracts and shared authorized operations, never directly on tables, RPCs or function URLs. Confirm the separately built web/eve composition before expanding the workspace. Source templates are references; their authentication, persistence and generic tool approval cannot replace product authority.

## Source organization

The following paths are a future layout, not current files:

```text
agent/                      eve definition, instructions, tools and channel adapters
apps/web/                   Next.js routes, feature UI and web-specific adapters
lib/contracts/              browser-safe schemas, actions and audience projections
lib/server/                 shared identity, onboarding, scheduling, booking, delivery
lib/server/providers/       narrow Calendar, Routes and messaging adapters
lib/server/db/              transactions and repositories
lib/server/jobs/            durable dispatch and reconciliation
tests/integration/          cross-module, database and runtime verification
tests/e2e/                  browser journeys
supabase/schemas/           future desired application schema
supabase/migrations/        reviewed future migration chain
supabase/tests/             grants, invariants and concurrency tests
```

Unit tests live beside modules. Defer independently published packages, new worker apps and bridge deployments until a measured runtime need justifies them. Root build/deployment configuration will be introduced after the foundation check selects its integration shape. No placeholder application directories are needed in this planning checkout.

## Logical boundaries

Server entry points authenticate, authorize, validate and delegate. Eve tools invoke the same domain operations as web, MCP, user CLI and verified channels. Provider credentials, privileged persistence and model configuration stay server-only. Contract modules must be safe for both browser and server builds; check indirect/re-export imports as well as direct imports.

Render only audience-filtered server snapshots. React handles local interaction; it does not decide admission, agreement, approval, feasible candidates or booking outcomes. Runtime events and model text cannot invent action-card permissions.

## Rendering and state ownership

| State | Authority |
|---|---|
| Host identity, admission, grants and channel binding | Current server verification |
| Request, proposal, decisions, candidate evidence and booking | Durable versioned domain state |
| Conversation/runtime binding and committed inputs | Application-owned scope backed by durable execution |
| Transcript and action cards | Authorized audience projection |
| Composer text, open dialogs and unsaved control edits | Local React state |

Use stable message/artifact identities, revision-aware commands and exact retry identity. Do not persist private transcripts or bearer/provider credentials in browser local storage. Clear protected snapshots on sign-out, actor change and revocation. Shared caches must never contain private HTML, responses or streams.

## Identity and conversation selection

One host workspace at `/app` serves access, setup, request selection, review and settings. Keep setup, host-private request discussion and shared/requester discussion distinct. Selecting a request ID changes context only after ownership is checked. Notification links, reload and browser consent restore authorized scope without treating the URL as proof.

Public intake uses `/{handle}`; `/booking/[bookingId]` continues a protected request before and after booking. The user-facing booking ID resolves to a request, not a provider event ID. Request credentials are exchanged through protected mechanisms and removed from URLs; shared Calendar links never unlock transcripts. Reserve protocol/application route names before resolving handles.

## Guided guest intake

Offer optional identity-only Google prefill and manual continuation, separate from optional request-bound Calendar consent. Preserve an editable detected IANA timezone, date-specific offsets and supplied details. Review extracted changes before applying them; resolve ambiguous dates, duration or physical place before agreement. Contact proof and recovery remain protected controls, never chat/model inputs.

## Host setup conversation

Lead setup through agent guidance and compact in-chat cards. Suggest actual conflict calendars first, then a writable booking destination; explain/edit and confirm selection. Automatically analyze the saved conflict calendars over the past/next four weeks, disclose scope and bounded failures, and present evidence-based or labeled starter preferences. **Analyze again** is a recovery/refresh action, not a required second opt-in for the first scan.

Ask meeting mode/location explicitly and reuse explicit prior answers. In-person/either requires transportation or per-trip policy and an extra travel buffer; online-only skips these controls. Suggestions and typed corrections update a draft. Current final review, explicit confirmation and server readiness checks precede saved policy/publication.

Keep iMessage phone entry, six-digit proof, connection summary and optional skip inline. Browser sign-in, invitation and Google consent use protected handoffs; returning restores the same draft. Code fields submit directly to the protected server, outside transcripts and model context. Private-channel settings confirmation needs its own reviewed delta and expiring current-review context.

## Commands, artifacts and human decisions

Cards are typed, allowlisted projections with current revisions and permitted actions. Distinguish candidate selection, requester agreement, host approval, booking dispatch and confirmed receipt. Confirmations must identify the current proposal/settings review; model prose, an OAuth grant or a delivery receipt is insufficient.

Keep structured controls usable when the model fails. Stale cards refresh rather than silently mutate newer state. Pending commands reuse retry identity across lost responses and status lookup; no automatic second send is created from an uncertain result.

## Streaming and cross-channel updates

Authorize every runtime create/read/list/stream/input/control route and recheck authority on tools and stream delivery. Default runtime endpoints fail closed. Reconnect resumes an authorized cursor; terminal recovery is a separate explicit transition preserving committed inputs, history, cumulative usage and current scope. Do not silently create replacement sessions on missing state.

Use one committed transcript projection and prevent duplicate message animation/replay. Completed authored onboarding messages display immediately on revisits; reduced-motion users receive complete text. Browser recovery preserves unsent drafts and reachable cards without claiming a failed or uncertain provider operation succeeded.

## Accessibility and verification

Check phone widths, 200% zoom, keyboard-only interaction, reduced motion, forced colors and focus restoration. Keep the composer/actions reachable when the mobile keyboard opens; timezone and status are readable beyond color. Use labeled controls and restrained announcements. Retain only local unsent draft text after access loss, with select/discard actions, while removing protected server data.

Verify two-host/two-requester isolation, unauthorized raw routes, protected import boundaries, callback/reload recovery, stale/concurrent actions, reconnect versus terminal recovery, model failure and complete scheduling journeys. Pin dependencies and introduce documented app build/check commands with the foundation implementation. Fixtures and controlled provider/device checks supply different evidence; neither replaces the other.

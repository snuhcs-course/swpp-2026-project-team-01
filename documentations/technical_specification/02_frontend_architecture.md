# Frontend Architecture

Date: 2026-10-19

Status: proposed design; implementation pending

Companion: [Page list](../user_experience/04_page_list.md)

## Scope and decisions

Use Next.js App Router, React, TypeScript and npm, with eve as the intended conversation runtime. Retain shadcn/ui and selected AI Elements as UI direction; exact versions/preset compatibility must be freshly pinned in the foundation change. Apply [Thyme visual direction](../../DESIGN.md). No package, component or runnable route exists yet.

The UI depends on client-safe contracts and shared authorized operations, never directly on tables, RPCs or function URLs. Confirm the separately built web/eve composition before expanding the workspace. [Source templates](#reference-repositories) are references; their authentication, persistence and generic tool approval cannot replace product authority.

## Reference repositories

The implementation copies one base template and builds Find Me a Time on top of it; the other repositories are read for specific patterns only. None is a dependency or compatibility boundary. Pin each reviewed revision in the foundation change, record source commits in the implementing pull request and preserve upstream license notices on copied code. Keep npm and pin a tested dependency set rather than copying a template's lockfile or floating ranges.

### Base template

Copy the **eve chat template** as the base. It already matches the agreed stack (Next.js App Router, React, TypeScript, shadcn/ui, eve as a separately built service composed through root `vercel.ts`), tracks current eve releases, and is small enough (about 90 TypeScript files, one `apps/web` app) that replacing its identity and persistence is less work than removing another template's product features. Its starter mode is a shared password with browser-local chats and a shared memory document; its production mode is Sign in with Vercel plus Neon and Upstash. Replace both with Supabase Auth and our durable domain storage before any real host data enters the app. Route authentication alone does not enforce per-session ownership; our actor/resource/audience bindings do.

OpenInstinct was considered as the base and rejected: it is a complete product (about 440 TypeScript files) whose centre is a Kernel cloud-browser subagent, an encrypted password vault, Stripe Link purchases, Linq iMessage and Better Auth on Neon, with pnpm and Turbo. Most of it would be deleted, and its eve pin (0.66.3) is older than the chat template's. The personal-agent template is Nuxt/Vue and the memory agent template has no web UI, so neither can be the base.

### Pattern references

| Reference | Use for | Do not adopt |
|---|---|---|
| [eve chat template](https://github.com/vercel/eve/tree/main/apps/templates/eve-chat-template) | Base copy: root `agent/`, `apps/web/`, `useEveAgent` client integration, stored stream events and session cursors for `/chat/[id]` resume, streaming and message rendering | Shared password identity and its shared memory/connection grants, Sign in with Vercel, Neon/Upstash, unrestricted tools, pnpm lockfile |
| [OpenInstinct](https://github.com/Merit-Systems/OpenInstinct) | Closest shipped shape to ours on Next.js 16 + eve: eve channel for iMessage with phone-verified users mapped to accounts, user-scoped Google OAuth through a connector for Calendar/Gmail/Contacts, scheduled runs, per-user memory slots with revision checks and bounded records, server-side request scoping, repository `AGENTS.md` conventions | Kernel browser subagent, password vault and autofill, Stripe Link wallet, Linq transport (we use Photon Spectrum), Better Auth/Neon/Blob, AI Gateway default, Vercel Pro cron dependency |
| [personal-agent template](https://github.com/vercel-labs/personal-agent-template) (also [in the eve monorepo](https://github.com/vercel/eve/tree/main/apps/templates/personal-agent-template) with Sendblue iMessage) | Account/channel linking between browser and messaging, internal API between web and agent services, user-approved `save_memory` proposals, durable approval on write tools | Nuxt/Vue frontend, Better Auth, Sendblue/Slack/Linear integrations, personal-assistant privileges |
| [eve memory agent template](https://github.com/vercel-labs/eve-memory-agent-template) | Smallest example of eve memory slots: separate per-user and per-group memories keyed to verified channel identity, recalled before each turn, with instructions on when the model may save | Slack transport, Vercel Blob/Sandbox storage, no web UI to reuse |
| [Vercel chatbot](https://github.com/vercel/chatbot) | Message and composer interactions, responsive polish, empty/loading/error states and browser-test patterns | Auth.js, a second user database, Neon/Blob provisioning, guest accounts, public sharing and uploads, generic artifacts, model picker |

Memory slots in these templates let the model write durable facts about a user; in Find Me a Time, scheduling policy is written only through confirmed settings commands, so any memory slot holds non-authoritative context at most. No reference supplies email delivery or the Photon Spectrum iMessage transport, and none overrides the no-sidebar [workspace contract](../../openspec/specs/chat-workspaces/spec.md).

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

Server entry points authenticate, authorize, validate and delegate. Eve tools invoke the same domain operations as web, MCP, user CLI and verified channels, and are registered per session audience ([permission layers](04_agent_configuration.md#permission-layers)). Provider credentials, privileged persistence and model configuration stay server-only. Contract modules must be safe for both browser and server builds; check indirect/re-export imports as well as direct imports.

Render only audience-filtered server snapshots. React handles local interaction; it does not decide host eligibility, agreement, approval, feasible candidates or booking outcomes. Runtime events and model text cannot invent action-card permissions.

## Rendering and state ownership

| State | Authority |
|---|---|
| Host identity, eligibility, grants and channel binding | Current server verification |
| Request, proposal, decisions, candidate evidence and booking | Durable versioned domain state |
| Conversation/runtime binding and committed inputs | Application-owned scope backed by durable execution |
| Transcript and action cards | Authorized audience projection |
| Composer text, open dialogs and unsaved control edits | Local React state |

Use stable message/artifact identities, revision-aware commands and exact retry identity. Do not persist private transcripts or bearer/provider credentials in browser local storage. Clear protected snapshots on sign-out, actor change and revocation. Shared caches must never contain private HTML, responses or streams.

## Identity and conversation selection

One host workspace at `/app` serves access, setup, request selection, review and settings. Keep setup, host-private request discussion and shared/requester discussion distinct. Selecting a request ID changes context only after ownership is checked. Notification links, reload and browser consent restore authorized scope without treating the URL as proof.

Public intake uses `/{handle}`; `/booking/[bookingId]` continues a protected request before and after booking. The user-facing booking ID resolves to a request, not a provider event ID. The random booking identifier in the URL is the requester's credential, so the page sends `Referrer-Policy: no-referrer`, is excluded from indexing and never writes the identifier into shared Calendar descriptions or full request logs. Reserve protocol/application route names before resolving handles.

## Guided guest intake

Offer optional Google prefill that requests identity and availability-only Calendar access on one screen, plus manual continuation; a declined Calendar part still prefills identity, and request-bound Calendar consent can be granted later. Preserve an editable detected IANA timezone, date-specific offsets and supplied details. Review extracted changes before applying them; resolve ambiguous dates, duration or physical place before agreement. Contact proof and recovery remain protected controls, never chat/model inputs.

## Host setup conversation

The [host onboarding flow](../user_experience/05_host_onboarding_flow.md) records the states and server checks; the [agent configuration](04_agent_configuration.md) records how the conversation runtime is defined. Lead setup through agent guidance and compact in-chat cards. Suggest actual conflict calendars first, then a writable booking destination; explain/edit and confirm selection. Automatically analyze the saved conflict calendars over the past/next four weeks, disclose scope and bounded failures, and present evidence-based or labeled starter preferences: preferred times, weekly meeting load with a suggested limit, note-like entries to exclude and the most frequent area and venue, each as a question with its sample size. **Analyze again** is a recovery/refresh action, not a required second opt-in for the first scan.

Ask meeting mode/location explicitly and reuse explicit prior answers. In-person/either requires transportation or per-trip policy and an extra travel buffer; online-only skips these controls. Suggestions and typed corrections update a draft. Current final review, explicit confirmation and server readiness checks precede saved policy/publication.

Keep the iMessage link card inline: the line number, the one-time link code with **Copy** and an **Open Messages** deep link that lands in Messages with the code already in the input, the masked-sender confirmation, the **Send me a code instead** fallback with phone entry and six-digit proof, the connection summary and optional skip. Browser sign-in and Google consent use protected handoffs; returning restores the same draft. Code fields submit directly to the protected server, outside transcripts and model context. Private-channel settings confirmation needs its own reviewed delta and expiring current-review context.

## Commands, artifacts and human decisions

Cards are typed, allowlisted projections with current revisions and permitted actions. Distinguish candidate selection, requester agreement, host approval, booking dispatch and confirmed receipt. Confirmations must identify the current proposal/settings review; model prose, an OAuth grant or a delivery receipt is insufficient.

Keep structured controls usable when the model fails. Stale cards refresh rather than silently mutate newer state. Pending commands reuse retry identity across lost responses and status lookup; no automatic second send is created from an uncertain result.

## Streaming and cross-channel updates

Authorize every runtime create/read/list/stream/input/control route and recheck authority on tools and stream delivery. Default runtime endpoints fail closed. Reconnect resumes an authorized cursor; terminal recovery is a separate explicit transition preserving committed inputs, history, cumulative usage and current scope. Do not silently create replacement sessions on missing state.

Use one committed transcript projection and prevent duplicate message animation/replay. Completed authored onboarding messages display immediately on revisits; reduced-motion users receive complete text. Browser recovery preserves unsent drafts and reachable cards without claiming a failed or uncertain provider operation succeeded.

## Accessibility and verification

Check phone widths, 200% zoom, keyboard-only interaction, reduced motion, forced colors and focus restoration. Keep the composer/actions reachable when the mobile keyboard opens; timezone and status are readable beyond color. Use labeled controls and restrained announcements. Retain only local unsent draft text after access loss, with select/discard actions, while removing protected server data.

Verify two-host/two-requester isolation, unauthorized raw routes, protected import boundaries, callback/reload recovery, stale/concurrent actions, reconnect versus terminal recovery, model failure and complete scheduling journeys. Pin dependencies and introduce documented app build/check commands with the foundation implementation. Fixtures and controlled provider/device checks supply different evidence; neither replaces the other.

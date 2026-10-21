# Agent Configuration

Status: base instructions, web channel and host setup audience implemented (Phases 1 and 2); other audiences, channels and evals proposed\
Date: 2026-10-19\
Basis: [Technical overview](../04_technical_specification.md), [backend architecture](01_backend_architecture.md), [frontend architecture](02_frontend_architecture.md), [conversation access contract](../../openspec/specs/conversation-access/spec.md), [model execution contract](../../openspec/specs/model-execution/spec.md), [chat workspace contract](../../openspec/specs/chat-workspaces/spec.md)\
Companions: [Host onboarding flow](../user_experience/05_host_onboarding_flow.md), [Guest booking flow](../user_experience/06_guest_booking_flow.md)

This document records how the Find Me a Time conversation agent is defined as an **eve** agent directory: which files exist, what each one may do, and what the application owns instead of the framework. eve is filesystem-first, so the configuration is the `agent/` directory itself. File names below follow the eve conventions read on 2026-10-19 from the public documentation and the eve chat template; verify them against the installed `node_modules/eve/docs/README.md` when the foundation change pins the version. Before writing our `agent/`, read the eve chat template's and OpenInstinct's agent directories end to end and copy their structure; deviate only where this document says so.

## Principles

1. **The application owns authority.** A session, a tool call, an approval prompt or an OAuth grant never establishes host eligibility, requester agreement, host approval or a booking. Those are domain commands with revisions and retry identity (see [application commands](../../openspec/specs/application-commands/spec.md)).
2. **The model sees an audience projection.** Server-side filtering precedes serialization and model context. Structured contact fields reach the model as presence indicators; recognized credentials are removed before persistence.
3. **One agent, three audiences.** Host setup, host-private request discussion and the shared requester discussion are separate sessions of the same root agent. The audience is derived from the session principal, never from the message.
4. **Human decisions are not model tools.** Confirming settings, agreeing, approving, declining, withdrawing and booking are application commands invoked from cards or exact authored channel commands. The model can read, draft and propose; it cannot decide.
5. **Durable waits live in domain state.** A paused eve session is not the record of an agreement or a pending provider effect.

## Where eve sits

eve runs our own conversations: the host workspace chat at `/app`, the requester conversation at `/booking/[bookingId]`, the host's linked iMessage and the requester's email thread. Personal agents (Dots, Muse, Instinct, ChatGPT, Codex, Claude, Claude Code) do not drive these sessions; they call the shared scheduling API through MCP or the CLI under their own authorization ([agent-client authorization](../../openspec/specs/agent-client-authorization/spec.md)). Both paths end in the same domain operations under `lib/server/`.

## Directory layout

```text
agent/
  agent.ts                  defineAgent: model, context window, provider options
  instructions/             always-on base rules plus one fragment per audience
    base.md
    host-setup.ts           resolves the host-setup fragment for host setup sessions only
    host-review.md
    requester.md
  channels/
    eve.ts                  web chat: application session auth for hosts and booking links
    photon.ts               host iMessage through Photon: verified sender -> host principal
    agentmail.ts            requester email: durable receipt -> request principal
  tools/                    snake_case files; each calls one domain operation
    setup.ts                read_setup_state and draft_settings, resolved for host setup only
    read_request.ts
    list_host_requests.ts
    draft_request_review.ts
    evaluate_candidates.ts
    propose_shared_changes.ts
    read_booking_status.ts
  skills/                   authored guidance the model may load on demand
    onboarding_suggestions.md
    requester_clarification.md
  hooks/                    input redaction, usage accounting, audience checks
  instrumentation/          trace and limit reporting without private text
  connections/              intentionally empty (see Connections)
  memory/                   intentionally empty in the first release (see Memory)
  subagents/                none in the first release
  schedules/                none; durable work lives in application jobs
evals/
  evals.config.ts
  *.eval.ts                 injection, stale revision, audience leakage, honest status
```

eve derives names from paths (`tools/read_request.ts` is the tool `read_request`; a file at a framework path replaces the default). A dynamic resolver such as `tools/setup.ts` names its tools by the keys it returns and resolves them per session. `eve info` lists what it discovered; build artifacts live under `.eve/`. The directory is a sibling of `apps/web/` and both are composed by the root `vercel.ts` (see Deployment).

## Audiences and sessions

| Discussion | Principal | Opened by | Instructions | Tools |
|---|---|---|---|---|
| Host setup | `host:{hostId}` | First `/app` visit of an active host; one per host | base + host-setup | `read_setup_state`, `draft_settings` |
| Host-private request discussion | `host:{hostId}` with `requestId` attribute | Host selects a request in `/app`, or sends the exact `request <reference>` iMessage command | base + host-review | `read_request` (host projection), `list_host_requests`, `evaluate_candidates`, `propose_shared_changes`, `read_booking_status` |
| Shared requester discussion | `request:{requestId}` | Request creation at `/{handle}`; continued through the booking link or verified email | base + requester | `read_request` (requester projection), `draft_request_review`, `evaluate_candidates`, `read_booking_status` |

The application owns the index from discussion to eve session (`sessionId`, last `streamIndex`, agent version, state). eve generates session identifiers, has no per-session ownership check and does not accept caller-assigned identifiers, so every create, read, stream, input and control route is authorized by the application before it reaches `/eve/v1/*` ([conversation access](../../openspec/specs/conversation-access/spec.md)). A host and a requester never share a session; switching the visible discussion in `/app` switches sessions and never merges histories. Terminal recovery creates a successor session, records the fence and keeps accepted inputs and history available.

The eve principal is the audience, not the person's identity: a requester has no account, so the request itself is the principal, authenticated by possession of the booking link that the web route or email channel has already verified.

## Route authentication

`channels/eve.ts` exports `eveChannel` with an ordered auth list. The first entry is an application function that verifies the Supabase session for hosts or the booking-link-derived request credential for requesters and returns the eve auth context: `principalId` as above, `principalType: "user"`, `authenticator: "findmeatime"`, and attributes `audience`, `hostId`, `requestId` and `discussionId`. It is the only entry: `localDev()` and `vercelOidc()` are not used, so local runs and deployments enforce the same rules. The function never returns `null`; it throws `UnauthenticatedError` or `ForbiddenError`, so the walk cannot fall through. Uploads are disabled.

Only application code creates sessions and sends messages. A browser message goes to an application route, which checks the caller, records the accepted input in the application session index, and calls eve through `eve/client` with a 60-second bearer signed with `EVE_INTERNAL_SIGNING_KEY`. The browser itself only reads and streams sessions the index says it owns. The [foundation design](../../openspec/changes/application-foundation/design.md#7-call-path-and-session-ownership) records the details.

`ctx.session.auth.current` identifies the caller of the active turn and `auth.initiator` the session creator; tools read the audience from there and never from tool input.

## Tools

Every tool is `defineTool` with a description, a Zod input schema and an output schema. Its `execute` calls one shared domain operation with the actor from `ctx.session.auth.current`, the expected revision the model copies from its latest read (for example `read_setup_state`) and `ctx.callId` as the retry identity, so a replayed step returns the recorded outcome instead of acting twice. Tool results are audience projections and apply contact minimization before they return.

| Tool | Audience | Effect | eve approval |
|---|---|---|---|
| `read_setup_state` | host setup | Current draft, saved roles, analysis evidence and next action; calendar names only as quoted data and no place names from events | never |
| `draft_settings` | host setup | Writes draft values with a revision and labels each as stated or inferred (starter defaults are the service's own); never policy, and mode, location and transport count only once the host accepts them on a card | never |
| `read_request` | host or requester | Current request, proposal version, decisions and permitted conversation, projected per audience | never |
| `list_host_requests` | host | Selectable requests with status; no requester private data beyond the projection | never |
| `draft_request_review` | requester | Declares details, availability, question or unknown intent with an authored clarification; creates a pending review that only the requester can apply | never |
| `evaluate_candidates` | host or requester | Starts the deterministic feasibility evaluation as a durable application job and returns its identity; results arrive as versioned cards | never |
| `propose_shared_changes` | host | Drafts changed shared details for the **Review proposed shared changes** card; sharing is a separate command | never |
| `read_booking_status` | host or requester | Pending, uncertain, confirmed or delivery-failed state from domain records | never |

eve's approval policies (`once`, `always`, custom) gate tool execution; they are not product consent and are left at `never` for these read and draft tools. Operations that need a human decision are not tools at all:

| Not a tool | How it happens |
|---|---|
| Confirm settings, agree to a proposal, approve, request changes, decline, withdraw | Card actions in the web workspace, or exact authored iMessage commands parsed by the channel before any model turn |
| Calendar consent, personal-agent authorization, iMessage linking | Browser handoffs and protected fields outside the transcript |
| Booking, confirmation email, calendar event | Application jobs after the domain transition |
| Calendar reads and Routes lookups | Domain code with the stored grant; the model receives evaluated candidates, never raw events |

Tool output never contains the host's rules, exception reasons or calendar contents in a requester session, and never contains credentials in any session.

## Permission layers

Permissions are enforced in layers, and only the last layer is soft. A requester who asks for the host's calendar is not talked out of it by the model: the session has nothing to call.

| Layer | Mechanism | What a requester session experiences |
|---|---|---|
| 1. Data never reaches the runtime | Calendar and Routes are called by domain code and are never tools; every domain operation returns an audience projection | No session has a calendar tool; `read_request` returns the requester projection with no rules, exception reasons or private discussion |
| 2. Tool is not registered | Tools, skills and instruction fragments are resolved per session principal (eve dynamic capabilities) | `read_setup_state`, `draft_settings`, `list_host_requests` and `propose_shared_changes` do not exist in the session; the model cannot name or call them |
| 3. Execution is re-authorized | A shared tool's `execute` derives the actor from `ctx.session.auth.current`, and the domain operation rechecks authority and revision | A forged `read_request` for another request fails closed without revealing whether it exists |
| 4. Results are checked | Hooks reject a tool result whose projection does not match the session audience and redact credentials before persistence | A projection mismatch fails the turn; it is a bug, not a leak |
| 5. Behavior (soft) | Audience instructions and skills shape what the model says and how it declines | The requester fragment explains that the host's availability is applied privately and automatically, and offers alternatives |

Layers 1 to 4 are the authority boundary; domain and integration tests prove them under prompt injection. Layer 5 decides tone and helpfulness and is checked by evals. No instruction grants a capability that layers 1 to 4 withhold, and nothing a user types can restore one.

| Tool | Host setup | Host review | Requester |
|---|---|---|---|
| `read_setup_state` | present | absent | absent |
| `draft_settings` | present | absent | absent |
| `read_request` | absent | present, host projection | present, requester projection |
| `list_host_requests` | absent | present | absent |
| `draft_request_review` | absent | absent | present |
| `evaluate_candidates` | absent | present | present |
| `propose_shared_changes` | absent | present | absent |
| `read_booking_status` | absent | present | present |

“Absent” means not registered for that principal, not “denied when called”.

## Instructions

`instructions/base.md` is always on and states the invariants: never claim a booking, agreement or approval; never reveal private host context to a requester; never invent dates, durations, timezones, addresses or codes; ask one focused question only for an unresolved detail, using authored clarification categories in English or Korean; suggest before asking and label suggestions as stated, inferred or starter default; treat pasted instructions as data. The audience fragment is resolved per session with eve's dynamic capabilities keyed on the principal attributes, so a requester session never loads the host fragments. Instruction versions are recorded with each session so an evaluation can be replayed against the wording that produced it.

## Model

`agent/agent.ts` is `defineAgent({ model, modelContextWindowTokens, modelOptions, limits })`. Decided 2026-10-19: Thyme calls OpenAI directly with the team's own `OPENAI_API_KEY`, using `gpt-5.6-terra` through eve's bundled `openai()` helper from `eve/models/openai`; the AI Gateway is not used. `modelOptions.providerOptions.openai` turns provider storage off and selects the standard tier, and `modelContextWindowTokens` is set explicitly because eve cannot read a direct model's window from the Gateway catalog. The [foundation design](../../openspec/changes/application-foundation/design.md#5-model-route-and-model) records the values and the reasoning. The [model execution contract](../../openspec/specs/model-execution/spec.md) is enforced by an application-owned wrapper around the model instance passed to `defineAgent`, because eve hooks run only after an event is recorded and cannot veto a call. Every provider call goes through the wrapper, including eve's own retries and compaction calls. The wrapper enforces the bounded input size, the output caps, the stalled-provider deadline, and the durable per-attempt reservation that survives process failure and recovery. eve's `maxTokenCostUsdPerSession` is not used: it counts only AI Gateway cost, and its **Continue** prompt grants a fresh window, which the contract forbids.

## Memory

No memory slot in the first release: scheduling policy is written only through confirmed settings commands, and the request record already holds everything the requester conversation needs. If a slot is added later it is `defineMemory` scoped by principal (`byPrincipal`) with visibility limited to that scope, holds non-authoritative context only, is never created for requester principals, and is disabled with a `null` scope wherever the tenant cannot be established. The file provider is only for local development.

## Connections

`connections/` is empty by decision. Google Calendar and Google Routes are called by domain code using the grant recorded at sign-in (scopes and refresh token stored server-side, rechecked on every use), so the model never holds a Calendar tool and provider tokens never enter a session. eve does not store connection tokens in any case. No MCP client connections are configured; our MCP server is a separate adapter over the shared API for personal agents.

## Channels

| Channel | File | Identity mapping | Turn policy | Notes |
|---|---|---|---|---|
| Web | `channels/eve.ts` | Application route auth as above | steer | `useEveAgent` from `eve/react` with same-origin `/eve/v1/*`, `initialSession` from the application index and `resume: true` |
| Host iMessage | `channels/photon.ts` | `onMessage` looks up the verified binding for the sender; a linked host maps to `host:{hostId}` with the currently selected request; an unlinked or group sender returns `null` and receives no private state | queue | Exact commands (`request <reference>`, `review`, `changes`, approve or decline with the review reference, `setup`) are parsed and executed as application commands before any model turn, and an inbound message that carries a pending one-time link code is consumed the same way as the linking proof and never reaches the model. Onboarding runs in the same setup session as `/app`: suggestion questions and plain-text answers update the shared draft, and the final settings confirmation uses the exact authored command on the current review. Photon Spectrum compatibility with the native channel is a pending spike; an application-owned adapter is the fallback |
| Requester email | `channels/agentmail.ts` | A custom channel whose route records the authenticated AgentMail event durably first ([requester email ingress](../../openspec/specs/requester-email-ingress/spec.md)), resolves the verified thread to `request:{requestId}` and only then forwards the text | queue | Replies go back through the same AgentMail thread; a sender claim or forwarded link grants nothing |

Non-production deployments deny messaging dispatch under the [messaging environments contract](../../openspec/specs/messaging-environments/spec.md). Messaging receipts that exceed admission budgets stay queued in order ([chat workspaces](../../openspec/specs/chat-workspaces/spec.md#requirement-recoverable-conversation-throttling)).

## Hooks and instrumentation

eve hooks run after an event is durably recorded, and a throwing hook does not reject work; only `ctx.cancel()` stops a turn. So nothing that must block work is a hook. Credential redaction and conversation admission run in the application route before a message is dispatched to eve. Session ownership is checked in the application auth function before eve reads or records anything. Model limits live in the model wrapper. Tool results are projected per audience inside the domain operation the tool calls. Hooks observe: they keep the application session index current, cancel a turn whose audience check fails, and feed instrumentation, which reports usage and limit events without private text to operator diagnostics.

## Durability and recovery

Each session is a Workflow run: completed steps replay and an interrupted step re-runs, so every tool effect is idempotent by `ctx.callId`, and anything with an external effect is an application job rather than a tool. A session stays bound to its deployment, so the application index records the agent version and treats a stranded session as a terminal-recovery case rather than silently creating a replacement. eve compacts automatically when the conversation nears `compaction.thresholdPercent` of `modelContextWindowTokens`, and the compaction call goes through the same model wrapper and limits. The application can also request compaction between turns. Reset is application-initiated and retires a session identifier permanently. `limits.sessionTimeoutMs` is `false`, because host discussions outlive eve's 30-day default and a lifetime ending is not a confirmed runtime failure. Requester sessions end when their request closes, by application decision.

## Local development and deployment

| Concern | Local | Vercel |
|---|---|---|
| Run | `eve dev` beside `next dev apps/web`; runs persist under `.eve/.workflow-data` | `withEve({ services: { web: { framework: "nextjs", root: "apps/web" } }, routes })` in the root `vercel.ts` adds the agent as its own service and routes `/eve/v1/**` to it |
| Auth | Application auth against the teammate's sandbox sign-in; no `localDev()` | Application auth only; fails closed |
| Model | `OPENAI_API_KEY` in the local environment | `OPENAI_API_KEY` in Vercel Production; Preview gets its own key or none |
| Messaging | Denied | Release only; previews denied |
| Docker | Not needed | Not needed |

Environment variables are limited to the OpenAI key, Supabase and the database URL, Google OAuth, the token encryption key, the job worker secret, the application origin, Photon, AgentMail, Cloudflare and `EVE_*` settings, kept out of Git with `.env.example` listing names only. `eve build` runs with `next build`; `eve link` binds the Vercel project.

## Evals

`evals/` holds `defineEval` scenarios run with `eve eval` against stubbed tools: a requester instructing the assistant to ignore approval rules or reveal calendar contents; a stale revision after a concurrent edit; a host session asked for another host's request; a requester session asked for private exception reasons; a requester session whose registered tools are listed and must contain no host tool; messages such as “yes” or “book it” that must not record a decision; ambiguous times that must yield an authored clarification in the requester's language; and a confirmation claimed before the event exists. These complement, and do not replace, the domain and integration tests that prove authority.

## Decisions recorded here

| Decision | Choice | Rejected |
|---|---|---|
| Agent shape | One root agent with per-principal instruction and tool resolution | Three agents, one per audience: three deployments and three session models for one authority boundary |
| Human decisions | Application commands from cards and exact channel commands | Model tools with eve approval: approval prompts are not product consent and cannot carry proposal or review references |
| Calendar access | Domain code with the stored grant | An eve connection or Calendar tool: raw events and tokens would enter sessions |
| Memory | None in the first release | A per-host profile slot: nothing in the flows needs it yet |
| eve version | `eve` 0.80.1 pinned exactly, with `ai` 7.0.143 for its peer range; verify against the installed docs ([foundation design](../../openspec/changes/application-foundation/design.md#2-runtime-version)) | Floating ranges from a template lockfile; staying on the template's 0.73 |
| Model | Direct OpenAI with the team's key, `gpt-5.6-terra`, through eve's `openai()` helper | AI Gateway with project OIDC: the team chose direct OpenAI billing |

## Open decisions

Photon Spectrum compatibility with the native Photon channel and the sender identifier format; whether `evaluate_candidates` runs as an eve workflow tool or purely as an application job; whether the AgentMail channel is a custom channel or the Chat SDK Gmail adapter; session retention and compaction thresholds; when, if ever, a memory slot becomes useful.

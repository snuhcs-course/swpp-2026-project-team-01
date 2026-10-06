# Find Me a Time — Technical Specification

Status: architecture overview; replacement implementation and verification pending
Date: 2026-10-06
Basis: [implementation plan](technical_specification/04_implementation_plan.md), [PRD](02_product_requirements.md), and [interfaces](user_experience/03_interfaces.md)

The pre-launch rebuild replaces the web, agent integration, scheduling backend, contracts and channel integration source. Supabase remains selected infrastructure; the former API and worker implementation is not a retained dependency. Build directly in the final workspace paths on `feat/reconstruct-application` in the main checkout.

This document describes the target system. [Capability specifications](../openspec/specs/) retain agreed behavior; bounded [OpenSpec changes](../openspec/changes/) must resolve proposed deltas before implementation. The [implementation plan](technical_specification/04_implementation_plan.md#carried-forward-compatibility-gates) tracks unresolved provider/client gates; historical evidence is archived separately.

## 1. Scope and foundation

The system coordinates one host and one external requester, checks Google Calendar and host rules, negotiates a proposal, and books only after requester agreement and explicit host approval of the current proposal. All channels use the same request state.

| Area | Rebuild direction | Decision status |
|---|---|---|
| Web | Next.js App Router, React and TypeScript; conversation-centered pages with typed in-chat actions. | Proposed; see [frontend architecture](technical_specification/02_frontend_architecture.md) and [page list](user_experience/04_page_list.md). |
| Agent runtime | eve for durable conversation execution, connected through application-authorized tools and sessions. | Recommended, subject to build, security, reconnection and restart checks. |
| Model provider | Direct OpenAI through eve's `openai(...)` helper and a server-side `OPENAI_API_KEY`; use the intended OpenAI API billing account and applicable API credits. | Selected path; model ID, entitlement and runtime integration require verification. See [provider setup](technical_specification/03_provider_setup.md#openai-model-access-through-eve). |
| Identity and database | Supabase Auth and PostgreSQL; application-owned admission, grants and domain state. | Selected infrastructure; schemas and access paths are rebuilt and verified afresh. |
| Scheduling backend | Shared commands, audience-specific queries, deterministic feasibility, explicit decisions and reliable booking. | Required responsibilities; API/worker placement and durable job implementation remain open. |
| Agent access | Remote MCP and a thin CLI over shared scheduling operations. | Required release scope; authorization and each named client need independent verification. |
| Calendar and travel | Separate Google Calendar grants for host events and requester availability; Google Routes plus confirmed buffers. | Provider direction retained; replacement adapters and controlled journeys need verification. |
| Messaging | AgentMail requester conversation email, Photon Spectrum host iMessage, Cloudflare transactional mail and Supabase Auth SMTP. | Provider direction retained; implementations are replaceable. Native eve Photon compatibility with Spectrum credentials is unverified. |
| Hosting | Vercel at `https://release.findmeatime.com` for the proposed Next.js web app; selected Supabase project `mriseqztcwmezvtawnbo` for identity/data. See [deployment setup](technical_specification/03_provider_setup.md#reconstruction-deployment-origin). | Exact eve persistence, compute, worker and Spectrum bridge deployment must be settled by the runtime spike. |

Native mobile apps, group meetings, non-Google calendars and automated post-booking changes remain outside the initial release. Private host email is a proposed extension, not an accepted requirement.

### Backend decision

Use eve for durable conversation execution if the bounded runtime spike passes. Supabase owns identity and durable scheduling state; application code owns resource authorization, proposal revisions, human decisions, idempotency and external-effect recovery. Framework sessions and tool approval never establish application authority.

The runtime spike selects eve persistence, API/worker placement, durable job transport and recovery scheduling, and verifies build, isolation, reconnect/restart and Spectrum compatibility. Supabase Auth login does not establish MCP OAuth compatibility; resource-specific tokens and each named client's workflow require separate verification. See the [implementation gates](technical_specification/04_implementation_plan.md#phase-1--prove-the-runtime-and-settle-deployment-decisions).

## 2. Architecture

Use a modular application with Supabase-backed scheduling state and an application-authorized conversation runtime. The diagram shows logical responsibilities, not a selected API hosting layout.

```mermaid
flowchart TD
    W[Next.js web]
    A[MCP and CLI clients]
    C[AgentMail and Photon adapters]
    I[Identity, admission and session authorization]
    E[eve conversation runtime]
    D[Scheduling commands and scoped queries]
    DB[(Supabase PostgreSQL)]
    J[Durable booking and delivery execution]
    P[Calendar, Routes and messaging providers]
    W <--> I
    A <--> I
    C --> I
    I <--> E
    I <--> D
    E -->|Authorized tools| D
    D <--> DB
    DB <--> J
    J <--> P
```

## 3. User surfaces and trust boundaries

Hosts use the single `/app` agent chat for admission, setup, request review and settings through contextual cards/dialogs. Requesters start at `/{handle}` and continue with request-scoped access at `/booking/[bookingId]`. Authentication and provider consent use dedicated browser callbacks. Public `/SKILL.md` and `/{handle}/SKILL.md` explain agent entry; reading them grants no access. The [page list](user_experience/04_page_list.md) and [interfaces](user_experience/03_interfaces.md) own route and channel design.

Verified host web/iMessage and requester web/email may continue their respective authorized contexts. Keep host-private and requester histories, memory, projections and tool permissions separate. Resolve actor, resource and audience server-side for every read, stream, continuation and action. Provider credentials remain server-side.

## 4. Scheduling guarantees

Deterministic availability, rule and travel checks constrain candidate selection; the model gathers information and ranks feasible options. Booking requires current requester agreement and explicit, attributable host approval of the same proposal. Revalidate before creation, persist a stable event identity, and reconcile uncertain provider outcomes before another write. Delivery failure remains distinct from booking failure.

Confirmation email, Calendar invitation and protected receipt describe the same confirmed event. Shared invitations expose no conversation credentials or private host context. Initial-release scheduling excludes automated post-booking reschedule/cancel. Detailed rules live in backend architecture and the owning capability specs.

## 5. Detailed design owners

| Concern | Owning document |
|---|---|
| Identity/admission, public skill entry, MCP/CLI, data model, command contracts, availability, booking and channel recovery | [Backend architecture](technical_specification/01_backend_architecture.md) |
| Server/browser boundaries, session selection, artifact rendering, setup review, connection flows and accessible recovery | [Frontend architecture](technical_specification/02_frontend_architecture.md) |
| Supabase project, direct OpenAI configuration, messaging services, operator invitations and Google consent configuration | [Provider setup](technical_specification/03_provider_setup.md) |
| Phases, open decisions, compatibility gates, acceptance mapping and release evidence | [Implementation plan](technical_specification/04_implementation_plan.md) |
| Product intent and acceptance; user experience | [PRD](02_product_requirements.md), [journeys](user_experience/01_user_journeys.md), [user stories](user_experience/02_user_stories.md), [interfaces](user_experience/03_interfaces.md), [page list](user_experience/04_page_list.md) |
| Agreed behavior and proposed deltas | [Capability specifications](../openspec/specs/) and [OpenSpec changes](../openspec/changes/) |
| Dated provider/client probes and former setup procedures | [Archived compatibility evidence](archive/2026-10-06-compatibility_report.md) |

## 6. Delivery and verification

The [implementation plan](technical_specification/04_implementation_plan.md) is the execution entry point. It owns decision deadlines and fresh acceptance evidence across domain, database, runtime, browser, providers and every named agent client. Historical tests and archived deployments do not establish replacement readiness. Resolve scope in the PRD and technical decisions in the owning change; promote behavior into main capability specs only after implementation and verification.

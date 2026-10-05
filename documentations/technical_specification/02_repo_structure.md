# Find Me a Time — Repository Structure

Status: Current P1–P4 monorepo layout with proposed later adapter additions\
Date: 2026-10-05\
Basis: [Technical specification](../03_technical_specification.md), [backend architecture](01_backend_architecture.md), and [interfaces](../user_experience/03_interfaces.md)

Use one monorepo with a responsive web app, a thin CLI, and a shared Supabase backend. Organize backend code by product capability, with small entry adapters for HTTP, MCP, webhooks, and queued work. This document owns the directory layout; the backend architecture owns processing and reliability rules.

## 1. Current layout

The repository implements a React/Vite npm workspace with shadcn preset `b6rtA2Hmi`, shared contracts, a Hono/Deno API and worker, declarative schema/migrations, and CI. Vercel serves the web app; Supabase runs the backend. This tree records current code locations; create later adapter directories only when implementation lands. See the [runtime guide](07_request_and_booking_runtime.md) and [implementation plan](04_implementation_plan.md) for evidence and remaining live gates.

```text
apps/
  web/
    src/
      App.tsx                    # Route selection and shared app shell
      Landing.tsx                # Public waitlist and entry
      Host.tsx                   # Sign-in and resumable setup
      SetupConversation.tsx      # Durable host setup chat
      Requester.tsx              # Account-free intake/continuation
      Requests.tsx               # Host inbox and review
      RequestExtras.tsx          # Consent, recovery and related controls
      components/ui/             # shadcn preset b6rtA2Hmi components
      components/ai-elements/    # Official conversation primitives
      lib/                       # API client and shared web helpers
    tests/browser-smoke.mjs
    README.md
  photon-bridge/                 # Separate Node 24 project, not a root npm workspace
    src/                        # Photon subscription, scoped backend calls and health
    test/                       # Provider fixtures; no external messages
    Dockerfile
    fly.toml                    # Fly singleton deployed in Tokyo
    package.json
    package-lock.json
    README.md

supabase/
  config.toml
  functions/
    api/                         # Hono HTTP routes and callbacks
      routes/
    worker/                      # Internal bounded job consumer
    _shared/
      modules/
        onboarding/              # Bound Calendar OAuth
        requests/                # Evaluation and local RPC integration
        scheduling/              # Pure feasibility and confirmed receipts
        booking/                 # Dispatch/reconciliation policy
        booking_runtime/         # Durable worker orchestration
        delivery/                # Contact verification/recovery
      providers/                 # Google, Routes, model and email adapters
      database.ts                # Service-only command transport
      security.ts
    README.md
  schemas/                       # Desired foundation/onboarding/request/booking SQL
  migrations/                    # Reviewed generated history
  tests/                         # pgTAP permissions and workflow invariants

packages/
  contracts/index.ts             # Client-safe shared contracts
scripts/
  backend-contract.md
  manage-invitations.mjs          # Operator tooling
  manage-bookings.mjs
  deploy-backend.mjs
  deploy-web.mjs
  tests/booking-integration.ts
  p0/                            # Bounded provider/client probe evidence

documentations/
openspec/
  config.yaml
  specs/
  changes/
.github/workflows/check.yml      # Application and database checks
```

Module/provider tests live beside the code they exercise. Web checks, local RPC integration runners and P0 probes cover behavior spanning modules, processes or clients. Their fixtures use synthetic or dedicated test data. Product `apps/cli`, MCP/webhook functions and public skill-document templates remain planned; their absence does not remove those release requirements.

## 2. Interfaces and execution roles

| Interface | Code location | Responsibility |
|---|---|---|
| Responsive web | `apps/web` | Waitlist, invitation redemption, host setup/review, requester booking, and optional requester calendar connection. |
| CLI (planned) | `apps/cli` | Call the HTTP API with role-appropriate credentials and return structured results; existing operator scripts are separate. |
| HTTP API | `supabase/functions/api` | Validate inputs, resolve access, invoke shared operations and handle Calendar consent callbacks; public skill documents remain planned. |
| Remote MCP (planned) | `supabase/functions/mcp` | Map tool calls to the same shared operations with OAuth and request-scoped authorization. |
| Email and general iMessage scheduling inputs (planned) | `supabase/functions/webhooks` | Verify provider origin, persist deduplicated inputs, and enqueue processing. |
| Private iMessage host setup | `apps/photon-bridge` | Node 24 Photon transport into scoped setup commands; Fly singleton deployed; live linked-host journey pending. |
| Queued work | `supabase/functions/worker` | Consume bounded batches for conversation processing, booking, reconciliation, and delivery. |

Email and iMessage remain adapters to the shared command boundary. The implemented private iMessage setup adapter has a separate Node process because Photon uses a persistent gRPC connection. ChatGPT, Codex, Claude, Claude Code, Dots, Muse, and Instinct use shared interfaces; record their differences in compatibility tests and connection guidance. Add client-specific code only for a demonstrated compatibility need.

API and worker entry points run as Supabase Edge Functions on TypeScript/Deno, with Hono for routing. Proposed MCP/webhook adapters share the application boundary; direct Photon Spectrum uses the implemented narrow Node 24 bridge because its persistent gRPC transport needs its own runtime. The planned product CLI uses the HTTP API. Complete MCP client journeys and real linked-host iMessage onboarding remain open; the controlled Photon transport probe passed separately.

Supabase Queues and PostgreSQL preserve work between invocations. Cron triggers drains and recovery. Queue consumers follow the [job and recovery design](01_backend_architecture.md#8-jobs-inbox-and-outbox); the Photon setup bridge is the only separate always-running process currently implemented, with production hosting still pending.

## 3. Module and dependency boundaries

Keep a capability's operations, rules, persistence code, and unit tests together. A module may start as a few files; add subdirectories only when needed. Shared infrastructure provides database and queue primitives, while modules own their records and transitions. This avoids one global service layer that accumulates unrelated product behavior.

Application operations coordinate the logical boundaries described in the backend architecture. Current `scheduling` code owns feasibility; the service-only SQL command dispatcher owns request, agreement and approval transitions; `booking`/`booking_runtime` owns Calendar creation and reconciliation. These logical responsibilities need not each have a directory. All entry adapters use the shared authorization and version checks.

Dependencies flow from entry adapters to module operations, then to required integration/infrastructure implementations. Pure scheduling and decision rules should not depend on Hono, provider SDKs, or transport payloads. Modules expose deliberate operations to one another instead of writing each other's records directly.

Three boundaries need particular care:

- **Hosting versus requester access:** onboarding API routes and service-only SQL commands record invitation redemption/admission and enforce publishing/hosting authority. Requesting meetings and connecting a requester Google Calendar do not require host admission. Keep requester calendar grants bound to their authorized request.
- **Public versus private contracts:** `packages/contracts/index.ts` contains client-safe inputs, audience-specific outputs and stable errors shared by web and backend. It contains no provider credentials, database entities with private fields, internal approval evidence, or privileged client initialization; avoid parallel copies under `_shared`.
- **Providers versus policy:** `_shared/providers` translates provider requests and responses. Product modules decide recipients, permissions, proposal validity, and booking eligibility. Replacing an email or model provider should not create another scheduling state machine.

Keep shared contracts compatible with both the web/CLI tooling and Deno. Verify imports and Edge deployment bundling before relying on workspace package aliases; do not assume a Node workspace configuration automatically works in Supabase deployment. Pin dependencies and commit the applicable lockfiles when adding runtime tooling.

## 4. Public routes and skill documents

The planned public routes remain `findmeatime.com/SKILL.md` and `findmeatime.com/{host}/SKILL.md`. Proposed instruction sources under `_shared/skill_documents` will be served through API handlers and Vercel routing; these product entry routes are not implemented by the existing web/API deployment.

Generate host-specific documents from the requester template and allowlisted public profile fields. Do not create a committed Markdown file per host. Root instructions explain waitlist/invitation requirements; requester instructions offer manual, agent-provided, or optional directly connected Google Calendar availability.

The web app owns presentation and route forwarding. The backend owns admission, authorization, calendar credentials, and scheduling decisions. The deployed web app uses the same-origin `/api` proxy and `https://findmeatime.com/api/google/callback` for Google consent. Product MCP addresses/metadata and skill caching remain pending. Keep public URLs independent of Supabase function names.

## 5. Database, tooling, and documentation

Keep the desired schema in `supabase/schemas` and reviewed migrations in `supabase/migrations`. Follow the repository's [pg-delta workflow](../../AGENTS.md#supabase-schema-changes), including local rebuild verification. Do not introduce a second migration owner through a web framework or ORM.

The [web README](../../apps/web/README.md) and [backend README](../../supabase/functions/README.md) document existing setup and checks. Root npm workspace tooling checks React/Vite client code, shared contracts and Deno backend; package manifests and lockfiles pin dependencies. Keep secrets and local environment files out of Git and provide credential-free configuration examples where needed.

The existing [CI workflow](../../.github/workflows/check.yml) checks client types/builds, Edge Function types/tests, probe tests, migration rebuilds, SQL isolation/invariants and local RPC journey/recovery runners. Deployment jobs must identify the target environment; preview tests use dedicated credentials and must not send real invitations by default.

Keep product direction and architecture explanations in `documentations`. Use `openspec/changes` for bounded implementation proposals and tasks, and promote verified behavior into `openspec/specs` through the [repository workflow](../../AGENTS.md#documentation-and-specifications). The implementation plan distinguishes these implemented checks from pending live Calendar and MCP/channel journeys; this layout does not change release scope.

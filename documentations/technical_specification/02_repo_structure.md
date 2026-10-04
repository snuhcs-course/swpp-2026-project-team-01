# Find Me a Time — Repository Structure

Status: Planned layout for the selected Supabase backend; application code not yet implemented\
Date: 2026-10-05\
Basis: [Technical specification](../03_technical_specification.md), [backend architecture](01_backend_architecture.md), and [interfaces](../user_experience/03_interfaces.md)

Use one monorepo with a responsive web app, a thin CLI, and a shared Supabase backend. Organize backend code by product capability, with small entry adapters for HTTP, MCP, webhooks, and queued work. This document owns the directory layout; the backend architecture owns processing and reliability rules.

## 1. Planned layout

The repository currently has an `apps/` placeholder, local Supabase configuration, documentation, and OpenSpec configuration. The tree below is the intended implementation layout. Create directories when their first implementation lands, rather than scaffolding empty packages.

```text
apps/
  web/
    src/
      routes/                    # Adapt to the selected web framework
      features/
        waitlist/
        invitations/
        onboarding/
        booking/                 # Requester flow and calendar connection
        host_workspace/          # Inbox, rules, review, connections
      components/                # UI reused across features
      lib/                       # Client configuration and API access
  cli/
    src/
      commands/
      auth/
      output/                    # Structured results and exit codes

supabase/
  config.toml
  functions/
    api/
      index.ts
      routes/
    mcp/
      index.ts
      tools/
    webhooks/
      index.ts
      handlers/                  # Provider-specific inbound verification
    worker/
      index.ts                   # Internal, bounded queue consumer
    _shared/
      modules/
        access/                  # Identity, admission checks, client/guest grants
        onboarding/              # Waitlist, invitations, setup, profiles
        requests/                # Intake, conversation, request lifecycle
        scheduling/              # Rules, availability, proposal generation
        decisions/               # Agreement, host approval, confirmation evidence
        booking/                 # Event creation and reconciliation
        delivery/                # Audience-specific messages and outcomes
      integrations/
        google_calendar/
        google_routes/
        email/
        imessage/
        model/
      infrastructure/
        database/
        queues/
        observability/
      skill_documents/
        onboarding.md
        requester.md             # Template filled with public host fields
  schemas/                       # Desired database schema
  migrations/                    # Reviewed migration history
  tests/                         # Database permissions and invariants

packages/
  contracts/                     # Client-safe schemas shared across runtimes

tests/
  e2e/                           # Complete and cross-channel journeys
  compatibility/                 # MCP clients, OAuth, skill-entry behavior
  recovery/                      # Retries, termination, uncertain provider writes

documentations/
openspec/
  config.yaml
  specs/
  changes/
.github/
  workflows/
```

Keep module unit tests beside the code they exercise. Root test directories are for behavior spanning modules, processes, or external clients. Their fixtures must use synthetic or dedicated test data.

## 2. Interfaces and execution roles

| Interface | Code location | Responsibility |
|---|---|---|
| Responsive web | `apps/web` | Waitlist, invitation redemption, host setup/review, requester booking, and optional requester calendar connection. |
| CLI | `apps/cli` | Call the HTTP API with role-appropriate credentials and return structured results. |
| HTTP API | `supabase/functions/api` | Validate inputs, resolve access, invoke shared operations, handle consent callbacks, and serve public skill documents. |
| Remote MCP | `supabase/functions/mcp` | Map tool calls to the same shared operations with OAuth and request-scoped authorization. |
| Email and iMessage inputs | `supabase/functions/webhooks` | Verify provider origin, persist deduplicated inputs, and enqueue processing. |
| Queued work | `supabase/functions/worker` | Consume bounded batches for conversation processing, booking, reconciliation, and delivery. |

Email and iMessage are adapters, so they do not require separate apps. ChatGPT, Codex, Claude, Claude Code, Dots, Muse, and Instinct use shared interfaces; record their differences in compatibility tests and connection guidance. Add client-specific code only for a demonstrated compatibility need.

API, MCP, webhook, and worker entry points are Supabase Edge Functions. Their shared code runs on the selected TypeScript/Deno backend, with Hono for routing. MCP invokes shared application operations directly; it does not need to make an HTTP call to our API function. The CLI uses the HTTP API.

Supabase Queues and PostgreSQL preserve work between invocations. Cron triggers drains and recovery. Queue consumers follow the [job and recovery design](01_backend_architecture.md#8-jobs-inbox-and-outbox); no separate always-on backend application is part of the initial layout.

## 3. Module and dependency boundaries

Keep a capability's operations, rules, persistence code, and unit tests together. A module may start as a few files; add subdirectories only when needed. Shared infrastructure provides database and queue primitives, while modules own their records and transitions. This avoids one global service layer that accumulates unrelated product behavior.

Application operations coordinate the logical boundaries described in the backend architecture. `scheduling` owns feasible candidates and proposal generation; `decisions` owns agreement and approval evidence; `booking` alone initiates calendar event creation. All entry adapters use these operations, including their authorization and version checks.

Dependencies flow from entry adapters to module operations, then to required integration/infrastructure implementations. Pure scheduling and decision rules should not depend on Hono, provider SDKs, or transport payloads. Modules expose deliberate operations to one another instead of writing each other's records directly.

Three boundaries need particular care:

- **Hosting versus requester access:** `onboarding` records invitation redemption and admission; `access` enforces it for publishing a booking link and operating as a host. Requesting meetings and connecting a requester Google Calendar do not require host admission. Keep requester calendar grants bound to their authorized request.
- **Public versus private contracts:** `packages/contracts` contains validated inputs, public or audience-specific outputs, and stable errors. It contains no provider credentials, database entities with private fields, internal approval evidence, or privileged client initialization. Create this package when contracts first have multiple consumers; avoid parallel copies under `_shared`.
- **Providers versus policy:** `integrations` translates provider requests and responses. Product modules decide recipients, permissions, proposal validity, and booking eligibility. Replacing an email or model provider should not create another scheduling state machine.

Keep shared contracts compatible with both the web/CLI tooling and Deno. Verify imports and Edge deployment bundling before relying on workspace package aliases; do not assume a Node workspace configuration automatically works in Supabase deployment. Pin dependencies and commit the applicable lockfiles when adding runtime tooling.

## 4. Public routes and skill documents

The public routes remain `findmeatime.com/SKILL.md` and `findmeatime.com/{host}/SKILL.md`. Store the instruction sources under `_shared/skill_documents`, and serve them through the API handlers with the selected web host routing those public URLs appropriately.

Generate host-specific documents from the requester template and allowlisted public profile fields. Do not create a committed Markdown file per host. Root instructions explain waitlist/invitation requirements; requester instructions offer manual, agent-provided, or optional directly connected Google Calendar availability.

The web app owns presentation and route forwarding. The backend owns admission, authorization, calendar credentials, and scheduling decisions. Define public API/MCP addresses, OAuth metadata routes, consent redirects, and caching rules during deployment design. Keep public URLs independent of the Supabase function names.

## 5. Database, tooling, and documentation

Keep the desired schema in `supabase/schemas` and reviewed migrations in `supabase/migrations`. Follow the repository's [pg-delta workflow](../../AGENTS.md#supabase-schema-changes), including local rebuild verification. Do not introduce a second migration owner through a web framework or ORM.

Add setup and test instructions to each app when it is created. Root tooling should provide convenient commands for the checks that actually exist; the web framework, package manager, and precise workspace configuration remain implementation decisions. Keep secrets and local environment files out of Git and provide credential-free configuration examples where needed.

As code lands, CI should check client types/builds, Edge Function types/tests, database isolation, shared contract compatibility, and relevant journey/recovery tests. Deployment jobs must identify the target environment; preview tests use dedicated credentials and must not send real invitations by default.

Keep product direction and architecture explanations in `documentations`. Use `openspec/changes` for bounded implementation proposals and tasks, and promote verified behavior into `openspec/specs` through the [repository workflow](../../AGENTS.md#documentation-and-specifications). This layout does not create implemented capabilities or change release scope.

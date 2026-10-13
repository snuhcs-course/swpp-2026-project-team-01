# Design

## Context

The repository contains product/UX plans, fifteen agreed capability specs, shared skills and inactive Supabase configuration. Application source and application migration history are absent locally. The separately authorized reset on selected Supabase project `anelszynxtvxoxqvzgqt` also removed application objects, migration records, legacy jobs and queues; managed Auth/Storage/Vault remain. See [provider setup](../../../documentations/technical_specification/03_provider_setup.md#selected-rebuild-supabase-project) for the verified baseline and [proposal](proposal.md) for motivation and scope. No previous implementation pass establishes replacement acceptance.

## Goals / Non-Goals

**Goals:** Prove the intended separately built Next.js/eve runtime behind application-owned authorization, using minimal durable synthetic work and meaningful failure injection. Establish version pins, protected stream/tool semantics, durable accounting and recoverable execution before domain expansion.

**Non-Goals:** Implement host admission, provider consent, scheduling policy, actual booking/delivery, public skill/client workflows or remote activation. No production-like identity is synthesized as a runtime shortcut. The current turn produces planning artifacts only.

## Decisions

### Use a bounded reconstruction with existing contracts

Retain the settled [conversation access](../../specs/conversation-access/spec.md), [workspace](../../specs/chat-workspaces/spec.md), [model](../../specs/model-execution/spec.md), [command](../../specs/application-commands/spec.md) and [job](../../specs/durable-jobs/spec.md) guarantees. No delta is created because their required behavior is unchanged. Rebuilding all domain/channel code in one foundation change would make isolation and recovery failures harder to assess; later capabilities stay in their own slices.

### Keep the intended service layout and prove durable placement

Use root `agent/`, `apps/web/`, browser-safe `lib/contracts/` and server-only `lib/server/`, with npm orchestration and independent web/eve builds. The preferred persistence topology is managed Vercel Workflow execution plus Supabase-owned logical bindings, accepted inputs, accounting and durable effects. Verify the current supported integration before choosing exact APIs/mounts. Document worker/dispatcher wake-up ownership from a runnable spike before foundation completion.

A single long-lived in-memory server cannot meet the retained restart contract. An extra agent engine or independently deployed bridge/queue is deferred unless the bounded compatibility check demonstrates a specific need. If the preferred topology fails, record an explicit reviewed alternative before expansion.

### Make application authority precede runtime access

The server constructs a verified actor/resource/audience context and checks current authority before runtime create/read/list/stream/input/control and tool execution. Default framework endpoints fail closed. Route adapters remain thin; provider/runtime session identifiers and client claims never confer application access. The synthetic test fixture supplies narrow test-only principals without enabling production bypass identities.

Keep private/shared scopes separate through history, memory, tool permissions and stream projections. Recheck grant/generation under mutation locks and around asynchronous reads, including expiry while waiting. Preserve recognizable credential redaction and exact original-input comparison without plaintext secret retention.

### Persist accepted work before dispatch

Persist logical scope, accepted input/retry fingerprint, dispatch receipt and synthetic tool outcome before acknowledging their respective steps. Exact authorized retry returns the saved outcome; changed retry conflicts. The foundation effect is synthetic and cannot touch calendars, mail or saved scheduling policy. Durable recovery discovers committed work after a missing wake-up.

Reconnection resumes the existing authorized cursor. Terminal recovery requires trusted failed-state evidence and the observed generation; uncertainty creates no successor. One transition fences retired execution, retains history/cursors/accepted identities and reuses saved effects. Current authority and original limits remain in force after recovery.

### Preserve settled limits and safe failure

Implement the exact numerical admission/model limits in the main specs. Dependency/model selection must fit those limits; measured performance targets do not replace them. Keep durable reservations and cumulative usage across retries, channel changes and successors. Use deterministic provider fixtures for malformed/refused/stalled/credit/auth failures, then perform a controlled synthetic direct-provider probe only when its external use is authorized. Raw provider errors and secrets never reach the browser.

### Discover external incompatibilities early

Use fixture-based OAuth exact-resource/PKCE/callback/current-grant checks and Photon durable-receipt/acknowledgment/sender-identity checks to identify implementation boundaries. This spike is not full OAuth/channel deployment or actual named-client acceptance. Track the real-provider/device/client prerequisites in setup docs and the acceptance inventory instead of carrying old passes forward.

## Risks / Trade-offs

- Runtime integration changes → pin a freshly inspected version/template pair, verify both production builds and record supported persistence/recovery behavior.
- Framework retry appears successful while application work is lost/duplicated → inject process death after commit/before acknowledgment and lost wake-ups; require one saved synthetic effect with original input identity.
- A raw endpoint bypasses scope checks → inventory every exposed runtime entry and test anonymous, foreign, revoked, expired and retired-generation calls.
- Synthetic fixtures become a hosted migration backlog → isolate S1 storage; S2 owns the selected project's first application chain after a fresh baseline check. Reconcile applied history for any other populated target; never push an empty-baseline chain onto existing application data.
- New objects inherit unintended client access → review namespace/default privileges, explicit grants/revokes and RLS before applying the first application chain; the prior reset did not remove existing `public` default grants.
- Old external consumers process replacement state → identify and fence consumers before any remote schema/API activation or live provider test; an empty database job catalog does not prove old deployments/webhooks are inactive.
- Foundational tests are presented as release success → record fixture/provider evidence separately; all AC rows stay pending until their complete journeys pass.

## Migration Plan

There is no runtime deployment in the planning task. After a new implementation request, S1 starts in isolated disposable no-send storage, preserving the selected hosted project's clean application baseline. Introduce only the minimum reviewed synthetic persistence chain using the repository workflow; it is not an implicit pending chain for that hosted project. S2 authors the first product chain after rechecking the selected baseline and reviewing managed identity/configuration, namespace/default privileges, grants and RLS. Follow the [entry gates](../../../documentations/technical_specification/04_implementation_plan.md#clean-supabase-baseline-and-entry-gates), including environment/consumer ownership before any remote step or live provider test.

Do not replace current external callbacks or promote the release origin from a local build pass. Managed acceptance, if needed for the selected topology, uses a controlled synthetic preview and explicit environment authorization. Rollback removes/deactivates only that replacement environment and its consumers; it never rewrites applied history or resets existing hosted data. Update architecture/setup with actual verified commands and limits before closing the slice.

## Open Questions

Exact dependency/template revisions, model ID and fixture command names are resolved by the first foundation task after implementation authorization. They do not change the chosen product guarantees or service boundaries. Native Photon versus application-owned adapter suitability is measured in the spike; full transport integration remains S8. Named-client versions remain independent S9 acceptance prerequisites.

# Design

## Context

See [proposal](proposal.md). Eve 0.71.3 accepts live model instances only from `step.started` dynamic selection. Its session caps apply after provider usage arrives. Compaction uses the active model by default. Candidate ranking currently uses a direct Responses model with zero SDK retries, a 30-second deadline and a 2,048-token cap; it saves only exact permutations of current evidence.

## Goals / Non-Goals

**Goals:** enforce limits around actual provider invocations, with durable admission independent of runtime checkpoints and provider usage metadata.

**Non-Goals:** invoice reconciliation, organization-wide OpenAI spend enforcement, infrastructure/tool charges, retention/deletion and automatic refunds.

## Decisions

1. Wrap the installed AI SDK language model at `doGenerate`/`doStream`. Validate serialized prompt, tool definitions and response format before reservation. Only text, reasoning, function calls and text/JSON function results are permitted; deny files, URLs as attachments and provider tools. Replace call-level OpenAI options with the bounded stateless policy. Clamp output, combine caller cancellation with a 30-second timeout and bound stream reads. This covers SDK retries rather than trusting a once-per-turn hook. Retain lower caller output limits.
2. Use dynamic Eve selection to capture verified current runtime authentication and session ID in the wrapper reservation callback. The service RPC validates the current grant, scope, canonical session and pending input. Compaction must use this same wrapper; verify against the actual installed runtime before acceptance. No fallback to an unwrapped model.
3. Store private durable counters for principal/service windows and work attempts. Lock authority first, then service, principal and work counters consistently. Recheck authority/deadlines after waiting. Charge atomically before network work; database errors and unknown reservation outcomes fail closed. Do not refund failures because a timeout cannot prove the provider did no billable work. Work counters never roll over; daily windows start at the first accepted reservation after expiry.
4. Reserve 60 cents per call, with 3,000-cent principal and 30,000-cent service limits (50/500 calls). This deliberately overestimates typical requests. The verified [model page](https://developers.openai.com/api/docs/models/gpt-6-luna) lists a 1,050,000-token context and standard rates per million of $0.10 input, $0.125 cache writes and $0.50 output, with long-context multipliers 2/1.5 and a possible 10% regional premium. Even conservatively adding input and cache-write rates for the full context plus 4,096 output tokens gives under $0.53. The [Responses reference](https://developers.openai.com/api/reference/java/resources/responses/methods/create) defines the output cap to include reasoning and `default` to select standard pricing. Disable caller-specified cache breakpoints, remote conversation expansion and paid provider tools. This is a versioned reservation policy, not a report of actual spend; revalidate pricing, model and adapter changes before deployment.
5. Extend ranking with a reservation operation that validates the current evidence manifest under its existing lock order. Bind work accounting to the check ID, independent of the calling host/requester. Saved or empty rankings need no provider. Validate/save still reauthorizes after provider execution. A provider callback must reserve each actual attempt.

## Risks / Trade-offs

- Conservative reservations can deny work before actual spending approaches the allowance → expose safe limits, document fixed windows and retain structured controls; never silently reset counters.
- A model timeout cannot force remote cancellation or undo prior tool commits → retain the reservation and confirmed domain state; reject incomplete rankings.
- Framework changes could bypass compaction wrapping → share the production model-selection factory with deterministic runtime fixtures and explicitly test this path.
- Large history may hit the input bound → fail safely rather than truncate authority-sensitive context implicitly; evaluate compaction with real fixtures.

## Migration Plan

Add private counters and service-only reservation RPCs through pg-delta, preserving migration history. Verify reset, SQL, concurrent admission, provider boundaries, real runtime recovery and browser regressions. Deploy the database first, then the application from a clean committed checkout. Verify privileges, deployed definitions, public guards and rollback-only quota behavior. Keep counters on application rollback; do not erase charges or claim limits active on an unwrapped old deployment.

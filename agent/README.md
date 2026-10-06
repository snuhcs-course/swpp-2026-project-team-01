# Agent runtime

This is the eve agent source root. `agent.ts` selects direct OpenAI `gpt-6-luna`, explicit context-window metadata, low reasoning and bounded session usage. `instructions.md` describes scheduling authority and privacy; deterministic authorization and approval must remain in application code.

- `tools/`: thin adapters to authorized operations in `lib/server/`.
- `channels/`: eve web/messaging integration with verified application identity.
- `connections/`: supported eve connection definitions when required.

Run `npm run dev:eve`, `npm run build:eve` or `npm run start:eve` from the repository root. eve loads the root environment. `OPENAI_MODEL=gpt-6-luna` is required; runtime model calls additionally require server-only `OPENAI_API_KEY`. `npm run verify:model` verifies direct-provider structured tool generation using synthetic input. No gateway or subscription fallback is configured.

`channels/eve.ts` currently denies every caller. The public health endpoint remains available. This is a temporary guard until application-owned actor/resource/audience session authorization is installed, not completed conversation access. Default tools, subagent dispatch and shared memory are not enabled. Sandbox preparation still follows eve defaults; local builds need Docker.

Separate eve and Next.js builds are composed by root `vercel.ts`. Managed Vercel Workflow persistence is the intended deployment topology; restart, revocation and repeated-tool recovery gates remain pending. No separate worker or Photon bridge is introduced before compatibility evidence requires it.

The first authored tools read the current request/setup, save host-private notes and update shared request details. They use `ctx.session.auth.current`, never the session initiator, and delegate to the atomic conversation-tool RPC. They cannot confirm policy, agreement, approval, travel exceptions or provider outcomes. HTTP conversation ingress remains closed while durable dispatch and stream adapters are implemented; compiling these tools does not establish a working chat journey.

See the [source organization](../documentations/technical_specification/02_frontend_architecture.md#source-organization), [implementation plan](../documentations/technical_specification/04_implementation_plan.md) and [evidence ledger](../documentations/technical_specification/05_rebuild_evidence.md).

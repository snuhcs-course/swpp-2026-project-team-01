# Agent runtime

This is the eve agent source root. The directory scaffold exists; the runtime is not implemented yet.

- `tools/`: thin adapters to authorized operations in `lib/server/`.
- `channels/`: eve web/messaging integration with verified application identity.
- `connections/`: supported eve connection definitions when required.

Add `agent.ts`, `instructions.md` and the root build/deployment configuration during the runtime spike, using the pinned eve chat template. Scheduling rules and approval authority belong in shared application code, not prompts. Eve and Next.js have separate builds composed by root `vercel.ts` once implemented.

See the [source organization](../documentations/technical_specification/02_frontend_architecture.md#source-organization) and [implementation plan](../documentations/technical_specification/04_implementation_plan.md).

# Shared application source

This directory is shared source for the eve and web server builds, not a published package. Initial modules implement safe errors, origin/return validation, model configuration, Supabase credential verification and conversation grants; domain operations are being reconstructed.

- `contracts/`: browser-safe input schemas, actions and authorized projections.
- `server/`: shared identity, onboarding, scheduling, booking, delivery, provider, database and job modules.

All channel and tool adapters call the same authorized operations. Keep Next.js-specific request/cookie adapters in `apps/web/lib/`; pass verified actor/context into shared operations. Browser code must not import `server/`, including through barrel exports. Do not create a root export that mixes client-safe and privileged modules.

Unit tests live beside their modules. Cross-runtime coverage belongs in root `tests/integration/`. See the [backend boundaries](../documentations/technical_specification/01_backend_architecture.md#2-module-boundaries).

`server/identity/credentials.ts` verifies host access tokens or hashes request credentials; JSON actor objects cannot cross its in-process credential boundary. `server/identity/conversations.ts` opens/authorizes scopes through service-only RPCs. `checkExecution` is for trusted runtime adapters, never public grant-ID login. Browser responses use `contracts/conversations.ts` to omit execution grants. Authorization at the database remains required even after Auth verification.

`server/identity/tool-execution.ts` accepts only the active caller from authored eve context. Its service-only `fmat_conversation_tool` RPC derives the actor and resource from the execution grant, rechecks authority and executes in one transaction. Request reads, shared detail updates, private setup reads and private note writes have separate audience permissions. Model input cannot choose actors, resource IDs, retry keys or human decisions. Durable tool-call IDs produce stable retry keys; shared results are filtered even on cached-command replay. Public ingress must authenticate first; a serialized runtime auth object is not a browser credential.

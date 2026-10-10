# Design

## Context

See [proposal](proposal.md). OAuth discovery, consent, ES256 signing and grant enforcement are deployed. `AgentCredentials` provides a branded verified identity; `AgentOperations` exposes seven transactional operations with role/scope/target checks and expiry rollback. No MCP endpoint is mounted. Public documents currently describe browser fallback. Browser domain adapters cover substantially more scheduling functionality than the seven agent operations.

## Goals / Non-Goals

**Goals:** Reuse one strict operation catalog across MCP and CLI; preserve current authority at each domain transaction; make complete scheduling journeys possible without passing provider secrets to clients.

**Non-Goals:** Replacing Google identity, adding a generic privileged RPC proxy, attributing model text as human approval, or treating transport tests as named-client acceptance.

## Decisions

1. Use the official TypeScript SDK's current stable split server/client packages, pinned after package metadata verification. Its current README identifies v2 and the 2026-07-28 protocol; the installed skill's v1 imports are examples, not the selected dependency. Use the Web Standard Streamable HTTP transport in the existing Next Route Handler, stateless JSON responses, and a fresh server per request. Avoid hand-written JSON-RPC and process-global sessions in serverless instances. Verify exact SDK exports before implementation.
2. Require application bearer credentials before SDK dispatch, including tool discovery. Return no-store errors and the fixed protected-resource challenge; never read browser session cookies. Validate Origin against configured application/explicit client origins; absent Origin supports native clients. Preserve protocol-required headers and credential-free CORS only for allowed origins. Bound request bytes/upload time and reject token/query overrides. The existing OAuth 16 KiB/five-second reader can serve the initial tool inputs; larger domain payloads require explicit reviewed limits.
3. Start with a typed catalog over the seven implemented operations. Each named tool owns a strict input schema, role, derived scope, annotation and truthful description. Catalog entries map into `AgentOperations`, never arbitrary database function names. Register only the actor's relevant tools; enforce permissions again during invocation. This is an increment, not full workflow completion.
4. Extend the transactional operation adapter for host request lists with bounded cursors, conversation projections, availability, candidate review and booking status. Reuse existing domain functions and their audience/version semantics. External provider work retains the existing prepare/work/settle lifecycle and authority rechecks; do not run network calls while holding database locks. Add migration and concurrency tests for each new durable operation. Human-only confirmations and Calendar consent remain browser handoffs until attribution is verified for an individual client.
5. The CLI uses the official MCP client to call the same resource and catalog, returning JSON on stdout and safe diagnostics on stderr with nonzero error exits. Browser login uses a loopback ephemeral listener, S256, random state and exact resource. Origin-separated files use 0700 directories/0600 files, atomic replace and refresh locking. Credentials are never accepted on argv or emitted in normal results. Register callbacks per login and remove temporary listener/state on completion, denial or timeout. Do not silently retry uncertain code exchange/refresh.
6. Public instructions only advertise tested capabilities. Preserve both original paste-to-agent journeys and distinguish connection, admission, consent, requester agreement and host approval. Review each named client separately in the compatibility change.

## Risks / Trade-offs

- SDK or client protocol differences → official-client initialization/calls plus individual client evidence; pin dependencies and inspect supported versions.
- Tool coverage could stop at the seven existing operations → retain explicit coverage tasks and keep this change unarchived until complete.
- Revocation races and cross-request leakage → existing transactional locks plus direct transport/database integration tests for every added operation.
- Browser handoffs add interaction → necessary where attribution is unverified; preserve target and version and return to the same workflow.
- Lost refresh replies revoke recovery ability → reauthorization rather than replay; document the outcome and serialize local refresh.

## Host browser continuation

Agent request handoffs select an authorized request in `/app`. If Google login is needed, the browser submits only a strict UUID/audience target, stored for ten minutes in an HttpOnly, SameSite=Lax cookie (Secure with the `__Host-` prefix on HTTPS). Callback success or cancellation reconstructs the local workspace path and consumes the cookie. Cancellation removes only the error marker so a retry retains the target. Generic return URLs and identity/provider overrides remain rejected. Agent authorization consent uses its existing separate browser-bound return and clears the workspace hint. The target grants no request access, and the workspace reloads current authorization and proposal state.

## Migration Plan

Commit catalog, transport, domain expansions and CLI in reviewable increments with implementation-plan evidence. Validate local migrations, privileges, negative authorization, protocol/client tests and builds before deploying each activated surface. Inspect the selected Vercel/Supabase targets and migration dry run. Verify deployed challenges, real granted tool calls and revoked denial; roll back the web deployment if protocol exposure fails. Preserve additive migration history and disable new surfaces rather than restoring older authorization behavior. Keep all unrelated release gates open.

## References

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Streamable HTTP specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [Authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

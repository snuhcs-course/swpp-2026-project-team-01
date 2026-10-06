# Design

## Context

See [proposal](proposal.md). The implementation begins from scaffolds and retained SQL, not a working application. The user's full implementation/deployment instruction includes incremental commits; retain `feat/reconstruct-application` in the main checkout.

## Goals / Non-Goals

**Goals:** verified principals, audience-safe contracts, shared operation guards, executable runtime integration and a complete release ledger.

**Non-Goals:** duplicate the pending Calendar, setup, feasibility or booking implementations; claim compatibility from installed dependencies.

## Decisions

- Use root shared TypeScript source with Zod-validated public contracts. Next.js request/cookie handling stays in the web adapter. A generic client-supplied actor object is never authority.
- Keep the retained SQL as a migration baseline. Review the privileged command entry and verify it locally before adapting it; add migrations for changed behavior instead of overwriting history.
- Use opaque application-owned conversation bindings. Public runtime routes must fail closed until a verified binding and current access checks exist. Separate host-private and requester-facing contexts; disable shared runtime memory. Deliberate host access to shared discussion uses only the shared-safe context, as required by the frontend architecture.
- Store `conversation_scopes` for host setup, host-private request review and explicitly shared request discussion. Scope IDs locate contexts; they never authenticate a caller. Each participant receives a separate internal execution grant, omitted from browser projections.
- Verify host JWTs against the selected Supabase Auth service, then check the referenced `auth.sessions` row, user status and current host admission in the service-only access RPC. Ignore user-editable metadata. Guest credentials are request-bound opaque-token hashes checked against current request state. Closed guest access remains receipt-only through the separate existing receipt boundary.
- Recheck persisted execution grants before runtime output/tool effects; logout, host revocation, guest rotation/expiry/closure and scope retirement deny continuation. A revoked grant cannot be recreated from the same authority key. Runtime ingress, dispatch acknowledgment/recovery and stream wiring remain separate implementation work; the schema alone does not complete those tests.
- Pin eve and template revisions and verify their separate Next.js/eve builds under the compatibility change. Runtime placement/persistence is selected from actual bundled documentation and crash tests, not legacy topology.
- Main specs already settle seven-day request expiry, maximum thirty-day guest credentials, seven-day invitations, stable host handles and English/Korean intake. Preserve these obligations; broader follow-up, localization and retention policies remain release decisions.
- The pending setup change already includes browser-entered six-digit OTP. Implement that delta; obsolete documentation references to reconciling the old LINK flow do not revive it.

## Risks / Trade-offs

- Runtime APIs change → read installed docs, pin versions and keep adapter tests.
- Existing production consumers may still run → inventory and fence each transport before live event processing.
- Local credentials exist but linking metadata does not → verify the selected project and configure explicit targets before remote changes.

## Migration Plan

Commit the ownership/acceptance ledger first, then runtime and foundation slices with tests. Publish no private runtime path without authorization. Preserve provider resources, prior migrations and uncertain effect records. Feature changes retain their existing owners and cannot be marked done until replacement evidence passes.

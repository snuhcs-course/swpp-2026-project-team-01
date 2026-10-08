# Design

## Context

See [proposal](proposal.md). Runtime settlement already calls the Photon reply preparer before marking input complete. Requester email processing supplies a receipt-bound execution grant; its authority checker and receipt authorizer currently accept only incoming parent evidence. The existing AgentMail transport accepts an immutable snapshot and a final authorization callback.

## Goals / Non-Goals

**Goals:** Integrate that transport with transactional reply capture, persisted leases, bounded replay and signed outgoing-parent continuation.

**Non-Goals:** A send response is not an authentic delivery event. Do not invent delivery status or change consent, contact proof, intake or host login contracts. Their full implementation-plan gates remain open.

## Decisions

- Store one private reply per runtime input/receipt. Settlement freezes the answer once; capture a suppressed tombstone when authority has expired. Do not backfill replies from historical completed inputs, which have no trustworthy frozen output.
- Use the receipt's requester execution authority for capture and dispatch. Lock current request authority before the reply row, matching existing request invalidation order. Serialize work through row leases; recheck expiration after waits. Claim marks uncertainty and saves first-attempt time before HTTP. A lost claim response is safely recoverable.
- Use the existing `fmat-reply-<reply UUID>` transport identity. Same-payload replay is permitted only before first attempt plus 23 hours, leaving margin before AgentMail's documented 24-hour expiry. Persist acceptance without calling it delivered. Hold later sends behind earlier unknown outcomes. Stop scheduling exhausted unknown attempts; retain their records for future reconciliation.
- Centralize parent evidence lookup for receipt admission and later tool/runtime authorization. Accept either an earlier authenticated incoming receipt or an accepted reply whose original input has an earlier receipt order and whose first dispatch predates this receipt. Require identical link/receiver/inbox/thread; thread membership alone remains insufficient.
- A private route uses the existing runtime dispatch secret and a minute scheduler. Public client roles cannot read the ledger or invoke its mutation RPC. No new secret or public message API is necessary.

## Risks / Trade-offs

- Acceptance acknowledgment can arrive after an inbound response → only recorded acceptance authorizes that parent; fail closed while evidence is missing.
- Authority can change after dispatch authorization → the frozen recipient cannot change; a sent email cannot be recalled. Recheck as close as possible to HTTP and never retry after current authority fails.
- Model settlement and lease contention → lock request authority before reply state and verify concurrent settlement/claim behavior against real PostgreSQL.
- Provider key expiry → SQL and transport both enforce the horizon; never reset first-attempt time or issue another key.

## Migration Plan

Generate an additive pg-delta migration with desired schema and settlement/parent-function changes. Rebuild the disposable local chain, run SQL/integration/provider regressions, deploy the reviewed migration to the identified project, then deploy code from an archive excluding unrelated local edits. Verify private-route guards and selected receiver state. Rollback disables the receiver/scheduler and leaves immutable uncertain records intact; do not drop history or reset sends. Live activation requires controlled enrollment and reply acceptance evidence under the binding and compatibility gates.

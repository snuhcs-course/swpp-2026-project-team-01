# Proposal

## Why

The Phase 2 [legacy audit](../../../documentations/technical_specification/04_implementation_plan.md) found that the retired requester extractor rejected past-start and too-short windows, while the replacement review ledger accepts them. A local RPC regression reproduces acceptance of a window starting one minute ago; later feasibility checks do not make that review valid.

## What Changes

- Validate normalized proposed windows before creating or replacing an assistant review: future starts and sufficient duration when the merged request has a known duration.
- Recheck temporal validity when explicitly applying a review, including time elapsed while waiting for locks.
- Preserve existing reviews and scheduling state on rejection; preserve exact retries of already committed outcomes.
- Keep generic intake normalization and direct manual availability contracts separate. No inference of an omitted duration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: valid, current time windows at the assistant review boundary, extending [constrained interpretation](../../specs/meeting-requests/spec.md).

## Impact

The request-detail review SQL, generated migration, SQL and real-RPC tests, and owning technical/test documentation. No new dependency or provider action. Full legacy requester-model reconciliation also includes audience privacy and false status narration; those obligations remain open and are not silently certified by this window correction.

# Design

## Context

See [proposal.md](proposal.md). Durable ingress records transport references; full/raw reads and independent DKIM verification establish domain evidence but grant no request access.

## Goals / Non-Goals

**Goals:** explicit protected enrollment, immutable request/thread binding, current per-message authorization, browser controls and ingress-worker integration.

**Non-Goals:** general inbox access, host email, automatic proposal agreement from generic text, initial email intake or outbound send reconciliation. These remain required full-plan work.

## Decisions

- A current guest with verified contact requests a 256-bit linking proof, bound to the request token hash, verified email, configured inbox and receiver generation. Preserve an encrypted copy solely for protected retry/read recovery; keep its SHA-256 hash for matching. Pending proof lifetime is at most fifteen minutes and bounded by request/token expiry. Limit issuance to one per minute and five per request per hour.
- The browser instructs the requester to send exactly `FMAT-LINK <link-id>.<proof>` from their verified address. This is a linking control, never conversation/model input. Matching signed author and message identity/full-body evidence are required. No provider header is accepted as independent authentication evidence.
- Private links retain an immutable thread and binding receipt. One current pending/linked record per request and one linked request per inbox/thread prevent ambiguous association. Repeating the same binding receipt is idempotent; a different receipt cannot reuse the one-time proof.
- Receipt proof records are immutable and deduplicated by receipt and inbox/signature identity. Provider body reads occur outside database transactions. Database commit rechecks current configuration and authority after those reads.
- Lock registry, the inbox advisory lock for binding/authorization, request, then link. Request-change invalidation triggers hold the request lock before updating its links. Inbox-scoped binding serialization prevents concurrent crossed thread claims; no provider call occurs while locks are held.
- Contact changes, loss of contact proof, token rotation/revocation and terminal closure permanently revoke active links and erase encrypted enrollment secrets. Current time is checked after lock acquisition. A later restoration of the old email cannot reactivate an old link.
- Authorization returns receipt/link/request references, never a general guest credential or its token hash. Downstream conversation/tool operations must recheck current link authority rather than reuse a saved guest actor.
- New-message authorization rejects the binding message itself and every receipt received before the binding transaction, even when processed later. Every replay still requires current request/token/contact/receiver authority. Domain evidence cannot directly approve a proposal or book.
- The initial foundation exposes service-only RPCs and trusted server adapters. Browser APIs/UI and lease-bound ingress processing are separate tracked steps; production remains disabled until the complete channel route is verified.

## Risks / Trade-offs

- Strict signed Message-ID/author alignment rejects some legitimate mail → preserve a truthful protected web fallback and require positive live requester acceptance before enabling the channel.
- Enrollment tokens can be copied → require current guest/contact proof, exact authenticated author, one-time consumption, short expiry and immutable thread binding; do not inspect quoted text for a token.
- Deployment without complete processing → leave operator registry disabled, and never present queued transport as a linked channel.

## Migration Plan

Generate/review an additive pg-delta migration and rebuild the disposable local chain. Verify concurrent starts/binds, rollback, lost responses, contact/credential changes and direct-role denial. Deploy increments with remote rollback probes and regression checks. Enable live routing only after browser, worker and controlled continuation acceptance is complete.

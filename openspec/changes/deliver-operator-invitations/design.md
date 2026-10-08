# Design

## Context

See [proposal](proposal.md). Retained service-only `fmat_command` already supports invitation hashes and atomic redemption, but caller-supplied expiry/hash issuance has no operator application boundary or delivery record. `CloudflareEmail` already validates recipient acceptance and never automatically retries. Existing delivery workers use durable dispatch fences. The browser accepts sixteen RFC 4648 Base32 characters with optional grouping.

## Goals / Non-Goals

Provide an auditable operator CLI and durable remote invitation delivery while preserving matching verified Google identity and seven-day expiry. No browser/MCP issuance, invitation-code URLs, implicit host access revocation or automatic reissuance.

## Decisions

1. Use explicit project/operator/retry inputs and the server service credential, following booking recovery. Reject a target mismatch and public credentials before effects. Operator text is audit attribution, never authentication. Use a dedicated strict RPC; disable legacy issuance paths once the new boundary is active.
2. Preserve hash-only server credential storage. Derive the 80-bit code from HMAC-SHA256 with a dedicated 32-byte `INVITATION_CODE_KEY`, a versioned domain, selected project, normalized recipient, operator and random UUID retry identity. Persist only the hash and derivation context. A ten-byte prefix encoded as sixteen RFC 4648 Base32 characters provides the existing grouped code. Avoid storing recoverable plaintext or encrypted codes in database delivery payloads. Do not reuse the provider credential encryption key. Missing/changed key fails before dispatch when the derived hash disagrees. Retain the key throughout pending invitation lifetimes; restoring the original key enables recovery, while rotation never silently replaces issued codes.
3. Generate expiry from database wall-clock time on first issuance, fixed at seven days; retries return that original record. Freeze recipient, origin, sender, account and template version in a private delivery record with the issuance transaction. Render the fixed-version message in memory and verify its code hash before dispatch. Template changes must preserve old rendering versions until pending records expire.
4. Remote issue defaults to Cloudflare and validates configuration before database creation. Local issue defaults to manual and cannot call a provider. Explicit remote manual issue writes a newly created 0600 artifact under a protected directory, never stdout, argv or a code-bearing URL. Never overwrite an existing artifact. Reserve the exclusive file before issuance; if a later write fails after issue, recover the same invitation using its retry identity. Reject symlink ancestors and unsafe directory ownership/permissions; verify file identity before writing or cleanup.
5. Add pending/prepared/dispatched/sent/failed/suppressed/uncertain delivery states with claim/lease fencing and current invitation checks. Persist dispatch before network I/O. A crash after dispatch or an ambiguous reply becomes uncertain without resend. Revocation/expiry/redemption before dispatch suppresses it; after dispatch, status preserves the uncertain/accepted evidence. Revocation does not revoke an already admitted host.
6. Ordinary command output reports only IDs, original expiry and delivery status. Status/revocation are send-free. Manual recovery is explicit and restricted to a live unredeemed invitation; a dedicated service-only recovery operation locks and validates the invitation, audits the requesting operator, and returns the original private derivation context to the server adapter. It does not change delivery mode or automatically retry a prior email. Normal command results exclude both the readable code and derivation context.

## Risks / Trade-offs

- Key loss blocks code recovery/delivery → retain the dedicated key through outstanding lifetimes; never generate a replacement under a retry.
- Network failure after dispatch → retain uncertainty and operator evidence; no automatic resend.
- Generic retained operator RPC bypass → deny old issuance operations after the dedicated boundary is activated; verify direct API negatives.
- Manual file leakage → exclusive owner-only output, no code in CLI logs, URLs or structured errors.

## Migration Plan

Implement and test internal contracts/code derivation first. Add desired schema and a reviewed pg-delta migration, rebuild the disposable local database, test unauthorized/cross-target/concurrent/expiry/revocation behavior, then integrate CLI and Cloudflare delivery. Configure the dedicated production key without printing it, identify targets, dry-run/apply additive migrations and deploy the worker. Test only isolated authorized fixtures and clean them up; real mailbox acceptance requires a controlled recipient. Roll back the worker surface without dropping history or reactivating legacy issuance. Archive only after all tasks pass.

# Tasks

## 1. Recovery contracts and ownership

- [x] 1.1 Define strict browser recovery input/status contracts without caller-controlled runtime identity, authority or terminal claims; verify invalid/extra fields and retry/generation boundaries, and document the pending API boundary.
- [x] 1.2 Implement trusted terminal-evidence inspection for exact saved sessions using pinned eve APIs; verify failed versus active/missing/unknown state, bounded reads, usage evidence and authority after I/O. Document the supported evidence source and limitations.
- [x] 1.3 Add private generation/recovery persistence, generation-zero backfill and idempotent transitions with pg-delta; rebuild locally and verify grants, concurrent transitions, changed retries, expiry after locks and lost acknowledgments. Document lock order and rollout compatibility.
- [x] 1.4 Fence tools, readiness reads, model reservations, input delivery and settlement with runtime generation identity; verify retired and legacy runtime calls cannot mutate recovered scopes while ordinary generation-zero behavior remains valid. Update the route/tool inventory.

## 2. History, dispatch and provider failure

- [x] 2.1 Implement generation-aware history, stream projection and bounded safe model continuity context; verify old cursors, no missing/duplicate output, cross-audience denial, byte limits and revocation during reads. Document cursor compatibility.
- [x] 2.2 Implement leased successor creation/binding and original pending-input continuation through the authenticated dispatcher; verify duplicate recovery, uncertain create/send/settle, expired original grants and one committed tool effect with unchanged input identity and charges. Document recovery states.
- [x] 2.3 Normalize recoverable model configuration failures without exposing upstream errors or terminating healthy conversation ownership; verify generation/stream failures, explicit later continuation, retained reservations and accumulated session limits, including already terminated sessions through the separate recovery path.

## 3. Browser recovery and acceptance

- [x] 3.1 Add current-authority same-origin recovery routes and explicit accessible browser controls; verify CSRF/foreign/revoked/stale denial, retained text/history, concurrent participants and reload after lost responses. Update UX, setup and operational documentation.
- [x] 3.2 Run actual-process and browser recovery for an existing authentication-terminated workflow, pending input, prior committed draft and historical cursors; verify original logical identity, one effect, unchanged approvals and cleanup with the complete SQL suite.
- [x] 3.3 Verify managed recovery in an isolated diagnostic deployment using synthetic records, preserving release routing; record exact source/overlays, terminal evidence, successor/history/accounting results and verified run/database/deployment cleanup.
- [ ] 3.4 Deploy the reviewed migration and implementation to the identified production targets; verify migration/function parity, current release routing, protected HTTP guards and isolated recovery acceptance, then update the implementation plan and archive only after all tasks pass.

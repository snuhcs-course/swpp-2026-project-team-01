# Tasks

## 1. Account-free intake and continuation

- [x] 1.1 Implement ready-host discovery and complete structured request creation; verify required details, unknown/unready hosts, input limits, and English/Korean normalization tests.
- [x] 1.2 Implement request-bound 256-bit hashed guest tokens, maximum thirty-day TTL, closure mutation/OAuth/recovery revocation with a minimal final receipt read, and verified-contact recovery rotation; verify wrong-request/expired tokens and unverified recovery rejection.
- [x] 1.3 Add request/credential/contact/history desired SQL and reviewed migration; verify local reset and guest isolation through actual database commands.
- [x] 1.4 Document guest continuation/recovery and contact-verification boundaries; verify the documented path never relies on email possession claims alone.

## 2. Versioned negotiation and visibility

- [x] 2.1 Implement immutable proposal create/revise and requester agreement with expected revisions/idempotency; verify duplicate retries, stale agreement, concurrent revisions, and decision invalidation.
- [x] 2.2 Implement decline, pre-booking withdrawal, and expiry at min(seven days, requested-window end); verify terminal replay and booking-cutoff handling preserve actual pending outcomes.
- [x] 2.3 Implement separate host/guest projections and audience-scoped history; verify private notes, host messages, exceptions, calendar context, and unsafe errors are absent from guest responses.
- [x] 2.4 Implement strict structured extraction with bounded model input and stale-result checks; verify prompt injection, refusal/incomplete output, bad fields, and revision-change rejection.
- [x] 2.5 Document lifecycle and version semantics in the owning technical/product explanation; verify states and expiry agree with implemented guards and capability tests.

## 3. Responsive web journey

- [x] 3.1 Build booking intake, protected continuation, proposal selection/agreement, host inbox/revision/decline, and visible pending/error states; verify browser journey without requester signup.
- [x] 3.2 Verify phone layouts, keyboard access, labels, timezone displays, and exact-version decision details using browser checks; record results in phase evidence.
- [x] 3.3 Demonstrate agreed proposal reaching host review with no Calendar writes enabled; verify P3 integration evidence and separate later P4 booking requirements.

## Verification evidence

2026-10-05: generated P3 migration reviewed without destructive operations; full P1–P3 local reset and 189 pgTAP checks pass (123 request checks). Root typecheck/lint/85-test Deno suite/build pass; 18 of those tests exercise pending P4 adapters. Real local RPC journey covers creation, deterministic evaluation/ranking, current-proposal agreement, private exceptions/redaction, stale-result rejection and withdrawal with injected providers. The 24 browser fixture checks and 17 mutations pass at 390px, including optional consent/manual continuation, exact-version decisions and recovery. No live Calendar or email delivery success is claimed.

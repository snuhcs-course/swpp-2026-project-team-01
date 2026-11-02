# Design

## Context

See the [proposal](proposal.md) for the QA findings. The guest flow is one conversation across `/{handle}` and `/booking/[bookingId]`; `IdentityCard` submits `request.identify` through `useRequesterCards.run`, `ConnectCalendarCard` offers Google or skip, and `CandidatesCard` currently renders every offered candidate at once. The first three live in `apps/web/app/_components/guest/guest-workspace.tsx` and `apps/web/app/_components/requester/{cards,request-cards}.tsx`. The current `DESIGN.md` says only the landing and iMessage link step use ink; other screens still use Thyme globals. PR #13 established the ink palette, while issue #43 owns the app-wide token migration and issue #49 includes a guest screen redesign.

## Goals / Non-Goals

**Goals:** Keep one request and thread through identity retries; make screenshot-based availability an optional, review-before-apply path; shorten the candidate card without changing feasibility or ranking; verify host and guest onboarding against the ink design.

**Non-Goals:** Select, purchase, configure or deploy a production OCR provider; infer free time automatically from an ambiguous image; change candidate generation, scoring, Google consent or host approval; duplicate issue #43's app-wide migration or issue #49's broader guest redesign.

## Decisions

### 1. Diagnose identity failure before changing the command

Reproduce the reported Enter path in a browser and record the request/response category, UI state and server trace without logging the typed email. Compare Enter and button activation, invalid input, a temporary command error, and a response lost after commit. Keep the existing `request.identify` command and retry identity. On failure, render field-specific or service-specific feedback inside the identity card and preserve the form values. On a lost response, read authoritative request state before offering a new operation so an already committed identification continues to its booking link. This targets the observed symptom without assuming an unverified root cause. An alternative of adding a second submit endpoint would fragment the existing idempotency and thread transition.

### 2. Treat a screenshot as temporary evidence, not saved availability

Add a labeled file input to the guest Calendar card, separate from **Connect Google Calendar** and **Skip for now**. Accept PNG, JPEG and WebP images up to 10 MB; validate signature, type and decoded size on the server as well as the browser. Show a local preview with remove/cancel, upload progress and an explicit reading status. A request-scoped same-origin endpoint receives the image only under current booking-link authority, limits request size, and does not persist image bytes or raw OCR text. The extraction adapter has a fake implementation for tests and a production implementation only after a provider is selected and configured. If unavailable, the card says automatic reading is unavailable and points to the existing manual availability editor. Do not send images or extracted event titles to the assistant, host or logging pipeline.

The adapter returns candidate date/time marks with confidence and source bounds, not request mutations. The review card asks whether marked blocks mean busy or free, shows each inferred window with date and timezone, and makes ambiguous entries editable or removable. Only a guest confirmation invokes the same revision-guarded availability update used for manual windows; a stale revision reloads current state before another confirmation. An alternative of saving OCR output immediately could misread busy blocks as free, so it is rejected. The exact provider and its data-retention terms are a separate decision before live extraction is enabled.

### 3. Reveal existing candidates in batches

Render the first five offered candidates in the saved evaluation order, label each date and the displayed timezone, and expose **Show 5 more** with the remaining count. Revealing more is local UI state keyed to the evaluation ID and does not run `request.evaluate`. A new evaluation starts again at five; returning from a proposal can preserve the revealed count for the same evaluation. Show unresolved travel candidates in a clearly named secondary section and retain missing-link explanations. **Find other times** still reruns evaluation. An alternative of truncating server results would make valid options unreachable and disturb the ranking and soft-preference work in issue #60.

### 4. Apply the ink system through shared styling ownership

Use the tokens, type, component recipes and accessibility rules already defined in `DESIGN.md` and PR #13. Issue #43 owns changes to global theme variables and print/forced-color texture behavior; this QA change owns checking and correcting host setup and guest identity, Calendar, review, candidate, error and pending states as those tokens are applied. Share a single set of component rules rather than introducing a second onboarding-only palette. Coordinate with issue #49's guest screen redesign before editing shared cards. The acceptance surface is 375px and 390px phones, 800px and 1280px layouts, 200% zoom, keyboard operation, reduced motion and forced colors.

## Risks / Trade-offs

- **The reported identity error lacks a captured response** → reproduce it first; use the observed failure path to choose the smallest fix and retain the current command and retry semantics.
- **A screenshot can expose private event details** → keep bytes and raw extraction transient, authorize the request before processing, redact telemetry, and save only guest-confirmed windows.
- **A calendar image may not identify timezone or whether marks are busy** → require explicit interpretation and offer manual entry; never turn uncertainty into free time.
- **No OCR provider is configured** → exercise the complete upload/review path against a fake adapter, show an honest unavailable state in production, and track provider selection and credentials separately.
- **Theme work overlaps #43 and #49** → do shared token migration once in those owners, then run this change's onboarding QA against the integrated result.

## Migration Plan

No existing request data needs migration. Land the identity and candidate fixes independently of screenshot extraction. The upload control can ship with an unavailable/manual fallback until a reviewed OCR adapter is configured. Apply ink tokens through issue #43's shared theme work, then verify onboarding screens and update `DESIGN.md`'s known gaps only when the relevant surfaces are actually migrated. Rollback can disable image extraction while retaining manual availability; UI fixes do not change stored request data.

## Open Questions

- Which OCR provider, credentials, cost ceiling and retention terms will be approved for production? This is intentionally outside this change and does not affect the upload/review contract.
- What exact error response appears in QA item 5? Capture it during reproduction; the contract and task order do not depend on its current unknown cause.

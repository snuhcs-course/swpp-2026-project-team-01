# Proposal

## Why

Onboarding QA found a failure after submitting **Continue without Google**, no way for a guest to provide a calendar screenshot, an excessively long list of candidate times, and onboarding screens that still use the earlier Thyme theme. These interrupt or obscure the path from a host link to a reviewed meeting request. The expected guest journey is described in the [guest booking flow](../../../documentations/user_experience/06_guest_booking_flow.md), while the visual target is [DESIGN.md](../../../DESIGN.md) and the ink direction introduced in [PR #13](https://github.com/snuhcs-course/swpp-2026-project-team-01/pull/13).

## What Changes

- **QA 5 — manual identity:** Make submitting the name and email form with Enter or its button reach the same successful identified state. On a recoverable failure, keep the entered values and thread, show an actionable inline error, and allow a safe retry. The reported error text and root cause have not yet been captured; the first implementation task reproduces and records them.
- **QA 7 — calendar screenshot:** Offer a guest an optional image upload beside Google Calendar and manual availability. The web server uses OpenAI vision OCR when explicitly enabled with a server-side key, returning only structured time marks for a reviewable draft. The guest checks timezone and ambiguous entries before any availability is saved. Invalid, unreadable, rate-limited or unavailable extraction leaves manual entry usable. The live provider test and remote activation gate remain explicit deployment work.
- **QA 8 — candidate readability:** Keep all valid options reachable but show a short initial set in the existing evaluation order, with clear dates and timezone and a control to reveal more. Choosing a time continues to require the existing explicit proposal review and agreement.
- **QA 9 — ink design:** Bring host setup and guest onboarding surfaces into the ink visual system already defined in `DESIGN.md`, with phone, keyboard, zoom, contrast and error-state review. Coordinate the shared token migration with [issue #43](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/43) and the guest screen redesign tracked by [issue #49](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/49), so the same global styling work is not done twice.

[Issue #72](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/72) tracks this OpenSpec change. Issues #43 and #49 cover overlapping visual work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-workspaces`: reliable guest identity submission, reviewable image upload and compact candidate presentation inside the existing conversation, plus accessible ink treatment on onboarding surfaces.
- `meeting-requests`: optional screenshot-derived availability remains untrusted until the guest reviews and applies explicit time windows; it cannot authorize evaluation or agreement by itself.

## Impact

The likely web surfaces are the guest identity card and conversation, Calendar card, candidate card, host setup cards, and shared theme components. Screenshot intake needs a request-scoped upload and extraction boundary, validation, privacy handling and tests. It must preserve account-free access, request authority, current revision checks, Calendar consent rules and the existing candidate feasibility engine. The current [requester intake change](../requester-intake-and-feasibility/proposal.md) and [chat workspace contract](../../specs/chat-workspaces/spec.md) remain the behavioral baseline.

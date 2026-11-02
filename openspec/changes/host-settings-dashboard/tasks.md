# Tasks

## 1. Persist and enforce the intake switch

- [ ] 1.1 Add default-on `accepting_requests` and `intake_revision` to the declarative host-account schema, generate and review the migration, and verify `supabase db reset --local` rebuilds the chain with existing-host behavior preserved.
- [ ] 1.2 Add a host-authenticated toggle command and settings read with expected revision and retry identity; verify integration tests cover on/off, reload, lost response, stale revision, suspension and a missing Calendar grant.
- [ ] 1.3 Apply one effective-intake check to public HTML, skill documents, requester MCP, email entry and transactional new-request creation, while allowing existing drafts to identify and existing requests to continue; verify integration tests cover every path plus a concurrent pause/create race.
- [ ] 1.4 Update the public-entry and guest-booking-flow explanations and their Korean mirrors with the paused intake behavior; verify the documented neutral response and existing-request continuation match the integration tests and `npm run check:docs` passes.

## 2. Settings modal and schedule editing

- [ ] 2.1 Mount a shared gear immediately left of the upper-right menu and an ink-styled settings dialog in setup, inbox and selected-request views, with a translucent backdrop, visible **X**, focus containment and focus return; verify browser tests cover X, Escape, phone width, 200% zoom and retained conversation/scroll state.
- [ ] 2.2 Show confirmed weekly windows and timezone, reuse the weekday editor for a draft change, and review before `setup.confirm_settings`; verify tests show old confirmed windows during a pending edit, next-day labeling, equal-time rejection, stale confirmation and successful new-window evaluation.
- [ ] 2.3 Add the saved **Accept new meeting requests** switch and effective status explanation to the dialog; keep **Sign out** in the existing menu. Verify browser tests cover toggle persistence, paused/unready messages, menu sign-out and navigation.
- [ ] 2.4 Update the host-onboarding flow, page list and their Korean mirrors with the modal, draft/confirmed distinction and sign-out; verify `npm run check:docs` passes and the documents link to this change.

## 3. Integrated acceptance

- [ ] 3.1 Run a browser journey from host setup to confirmed weekly-window edit, pause, existing-request continuation, resume and sign-out; verify `npm run lint`, `npm run typecheck`, `npm test`, the relevant integration and browser tests, and `openspec validate host-settings-dashboard --strict` pass.
- [ ] 3.2 Record local acceptance and migration evidence; before any shared-project migration or production release, show the pending dry run and obtain the required deployment approval, then verify the shared state and update the acceptance record.

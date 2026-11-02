# Tasks

## 1. Manual guest identity (QA 5)

- [ ] 1.1 Reproduce Enter and button submission on a ready host's public page, capture the safe response category and UI transition, and identify the failing boundary; verify a browser test fails before the fix without recording the guest's email in logs.
- [ ] 1.2 Fix the identified boundary in the identity card or command path while keeping `request.identify` and its retry identity; verify browser and integration tests cover Enter, click, invalid name/email, temporary failure, lost response, a single request and a single creation email.
- [ ] 1.3 Update the G1–G2 recovery rows in `documentations/user_experience/06_guest_booking_flow.md` and its Korean mirror with the observed error and retry behavior; verify both describe the same outcome and the focused documentation checks pass.

## 2. Guest calendar screenshot (QA 7)

- [ ] 2.1 Add the request-authorized, size-bounded image intake and extraction adapter with a fake provider; verify tests reject unsupported, oversized, malformed and wrong-request files, and confirm image bytes and raw extracted text are absent from stored request data and logs.
- [ ] 2.2 Add **Upload calendar screenshot**, preview, remove, pending and unavailable states to the Calendar card while keeping Google and manual paths; verify browser tests use the keyboard, cancel the image, and enter manual availability when extraction is unavailable.
- [ ] 2.3 Add the review of extracted busy/free interpretation, dates, timezone and editable windows, applying only confirmed windows with the current revision; verify tests cover ambiguity, stale revision, no automatic evaluation, and no image or private event contents in host or agent projections.
- [ ] 2.4 Document the optional screenshot path, its accepted PNG/JPEG/WebP and 10 MB limit, privacy behavior and manual fallback in the guest booking flow and Korean mirror; verify the documents link to this change and describe the production OCR dependency without claiming live extraction works.
- [ ] 2.5 Connect server-side OpenAI vision extraction under an explicit environment flag and the shared durable spending allowance; verify mocked structured outputs, request-scoped attempt limits, no raw event text in saved state, the public privacy notice in both languages, and a controlled synthetic-image live call before enabling OCR remotely.

## 3. Candidate readability (QA 8)

- [ ] 3.1 Show five offered candidates initially in saved evaluation order, each with date and timezone, and reveal more from the same result in batches; verify component/browser tests cover 0, 1, 5 and more than 5 candidates, the remaining count, keyboard reveal and no extra evaluation.
- [ ] 3.2 Keep unresolved travel and missing-link states distinct and preserve proposal review after selecting a revealed option; verify a browser test selects a later candidate and reaches the exact proposal without recording agreement.
- [ ] 3.3 Update the G6–G7 presentation in the guest booking flow and Korean mirror; verify the documentation distinguishes **Show 5 more** from **Find other times** and the focused checks pass.

## 4. Ink onboarding QA (QA 9)

- [ ] 4.1 Coordinate shared token and component ownership with issues #43 and #49, then apply their ink styles to the host setup and guest onboarding cards without a second palette; verify the theme tests use the ink values and no onboarding surface depends on obsolete Thyme tokens.
- [ ] 4.2 Review host setup and guest identity, Calendar, review, candidate, error and pending states at 375/390/800/1280px, 200% zoom, keyboard-only, reduced motion and forced colors; fix visible regressions and verify Playwright screenshots and interaction checks show readable content, focus and no horizontal page scrolling.
- [ ] 4.3 Update `DESIGN.md`'s known gaps and its Korean mirror only for surfaces that actually migrated; verify the stated implementation status matches the rendered app and the documentation checks pass.

## 5. Integrated acceptance

- [ ] 5.1 Run the full guest journey from first message through manual identification, optional screenshot review with the fake extractor, candidate reveal, selection and explicit agreement, plus host setup visual checks; verify `npm run lint`, `npm run typecheck`, `npm test`, the relevant integration and browser tests, and `openspec validate onboarding-qa --strict` pass, recording any provider-dependent evidence still pending.

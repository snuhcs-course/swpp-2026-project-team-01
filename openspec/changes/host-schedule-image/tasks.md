# Tasks

## Implementation

- [x] Add the English expansion button, validated image input, preview, reading status and editable weekly review to the host Calendar card.
- [x] Add a host-authorized OCR endpoint, model adapter, no-storage response and host allowance reservation.
- [x] Show image-derived hours as an unaccepted, revisioned suggestion in the usual weekly hours question while retaining Google Calendar setup and booking.
- [x] Update the public privacy notice and environment template.

## Verification

- [x] Run typecheck, lint and unit tests.
- [ ] Run local database integration tests for OCR authority and draft saving when Docker is available.
- [ ] Run host onboarding browser checks on phone and desktop with Node 24, including keyboard upload and a synthetic image.
- [ ] Before enabling OCR in a remote environment, perform a controlled synthetic-image provider call and verify the model key, budget, privacy notice and deployment flag.

# Tasks

## 1. Account projection and authority

- [x] 1.1 Retain the verified account-to-request association after closure while clearing the selected profile items; cover closure and other-account isolation.
- [x] 1.2 Add a signed-in workspace projection for received and matched sent requests, with a private link only for an authorized match and a live link; link successful manual identification through the verified account session, and cover drafts, expired links, and closed bookings.
- [x] 1.3 Add sent request times to the calendar projection and deduplicate their Google invitation; cover pending and confirmed states.

## 2. Interfaces and documentation

- [x] 2.1 Build the approved Requests cards and filters with English copy, contrasting filled and outlined blue direction tags, and red decision text; verify phone and keyboard behavior.
- [x] 2.2 Add the sent request source, state and filter to the calendar Dashboard.
- [x] 2.3 Update the visual design and relevant technical description, then validate this change and run applicable checks.

The integration cases are written but could not be executed locally because Docker or Podman is unavailable. Type checking, lint, unit tests, documentation checks, OpenSpec validation, and the web production build passed.

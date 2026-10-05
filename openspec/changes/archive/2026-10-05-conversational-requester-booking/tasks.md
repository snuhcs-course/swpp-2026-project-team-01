# Tasks

## 1. Safe conversational extraction and application

- [x] 1.1 Extend scheduling-intent extraction with revision-safe review data and verify model tests reject ambiguous, invalid, past, short, or authority-bearing output
- [x] 1.2 Return optional requester review data from messages and add an ownership-checked, revision-bound apply route; verify route tests cover unauthorized, stale, allowed-field, and no-automatic-decision behavior

## 2. Requester conversation lifecycle

- [x] 2.1 Replace the requester message surface with AI Elements conversation and prompt primitives while preserving the private host conversation; verify frontend typecheck and lint pass
- [x] 2.2 Add inline review/apply, evaluation, candidate selection, and exact-proposal agreement controls; verify no conversational action bypasses the existing guarded endpoints
- [x] 2.3 Add requester conversation browser fixtures for desktop and mobile, including explicit review and agreement states, and verify they pass without overflow or accessibility errors
- [x] 2.4 Document the website requester conversation and its decision boundaries, then verify links and named actions match the implementation

## 3. Integration verification

- [x] 3.1 Run targeted backend tests, web typecheck/lint/build, OpenSpec strict validation, and review the scoped diff for unrelated changes

# Proposal

Tracking issue: #378. It reverses one rule of `guest-assistant-story-fixes` (#280, PR #357).

## Why

When the host offers online or in person and a guest answers where to meet with a place ("역삼역으로요" to "어디서 만날까요?"), the guest assistant asks online or in person again, so the guest answers the same thing twice. The rule added for #280 said a place alone does not answer the form. The repository owner decided on 2026-11-23 in #378 that a clear answer about where to meet settles in person, and that the assistant asks the form only when the place comes up in passing or conflicts with a wish to meet online.

## What Changes

- The requester fragment: when the host offers either and the guest names a place as where they will meet, the assistant drafts in person with that place on the review card and asks no online-or-in-person question. A place outside the host's listed places still follows the rule for a different place (described first, drafted on insistence). The assistant asks the form with `missing_mode` only when the place is mentioned in passing or the same answer leans toward online.
- GU-50 and GU-A04 now expect an in-person details draft with the place instead of a form question; GU-A08 (a place in passing) and GU-A09 (a place with a wish to meet online) keep the form question covered.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: the guest assistant answers within its scope (the place-and-form rule).

## Impact

`agent/instructions/requester.ts`, `evals/requester/story-cases.ts`, documentation 13 and the decision log. No tool, schema or command change: a details draft already carries `mode` and `location`.

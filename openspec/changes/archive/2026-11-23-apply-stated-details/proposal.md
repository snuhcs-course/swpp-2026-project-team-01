# Proposal

Tracking issue: #411. Related: #241 (times found after **Apply these details**), #373 and #378 (a place given as where to meet settles in person, PR #388).

## Why

A guest who clearly states the meeting's details (purpose, length, online or in person, place) still gets the **Apply these details** review card, and has to press it, or say "yes" in a way the assistant takes as confirmation, before anything happens. Only an availability draft with explicit time fields, on a request that already had everything else, applied at once (guest-flow-completion U21). Asking the guest to confirm what they just said adds a step without protecting anything.

## What Changes

The repository owner decided on 2026-11-23, in the issue:

- What the guest stated in their own words applies at once, as explicit availability already did: purpose, length, online or in person, place, meeting link, travel mode, and the times and preferences they gave. `draft_request_review` applies them in the same call, returns which fields it applied (`appliedFields`), and finds times as soon as the request has its purpose, length and form. Thyme says in one line what it applied and that the guest can change it in words.
- The review card stays only for what the guest did not state: time-of-day bounds Thyme assumed (`inferredTime`, such as "afternoon" as 12:00–18:00), in person taken from a place the guest named rather than said (the new `inferredMode`, the #378 case), a value that differs from one the request already holds (a conflict, such as another length), and name or email, which keep their protected review. Times that must fit a length still on the card wait with it.
- A draft with both parts applies the stated part and leaves the rest as the one pending review; no times are searched while something waits on the card, so the offered times never ignore what the guest is still confirming.
- Clarification questions are unchanged.
- The guest web chat, email and messenger conversations share the one requester tool set, so they behave the same. The requester MCP's `update_request_details` already applies at once; its description now tells the client agent to pass what the person stated and confirm what it inferred first.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: conversational details the requester stated apply at once; only inferred, conflicting or contact values need **Apply these details**.

## Impact

`lib/server/request-reviews.ts` (`splitStatedPatch`, with unit tests), `lib/server/request-tools.ts` (`draftRequestReviewForTool`, the `inferredMode` input), `agent/tools/request.ts` (the `draft_request_review` description), `agent/instructions/requester.ts`, `lib/server/agent-requester-tools.ts` (the `update_request_details` description), the request-tools and request-reviews integration tests, `evals/requester/story-cases.ts`, and documentation 04, 12 and 13. No schema, migration, command or web change: the draft and apply commands are reused as they are, and the guest thread already shows an applied review as an answered card.

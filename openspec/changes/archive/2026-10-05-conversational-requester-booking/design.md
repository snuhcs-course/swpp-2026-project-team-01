# Design

## Context

See [proposal.md](./proposal.md). The request detail page already has a shared message stream plus separate guarded endpoints for details updates, evaluation, candidate proposal creation, requester agreement, and host approval. Model extraction currently produces advisory data but the response only tells the requester to use the form.

## Goals / Non-Goals

**Goals:**

- Turn requester messages into a revision-bound review object that remains inert until explicitly applied.
- Put the existing evaluation, candidate selection, and agreement operations beside the conversation.
- Preserve request-token ownership, expected-revision checks, feasibility validation, and exact-proposal confirmation.
- Use the requested AI Elements primitives for the requester conversation and prompt.

**Non-Goals:**

- Letting model output call lifecycle operations or authorize decisions.
- Changing the host approval or booking boundary.
- Giving the model private host rules, calendars, notes, or travel diagnostics.
- Replacing the existing manual details editor.

## Decisions

### Return a transient, revision-bound review with the message response

The message endpoint returns the updated request plus an optional review object containing only allowed extracted fields and the revision it reviewed. The review is intentionally transient: the message remains durable, while applying a machine interpretation requires the current page state and an explicit action.

Persisting model output as authoritative request state was rejected because it would blur the difference between a message and a requester-reviewed change. Adding a new draft table was rejected because the review has no independent authority or long-lived workflow state.

### Apply allowed fields through a dedicated guest route

The apply route authenticates the request token, requires the current reviewed revision, reloads current public details, accepts only purpose, mode, location, and explicit-offset windows, and preserves requester identity, email, duration, and display timezone. It delegates normalization and revision enforcement to the existing details command.

Sending a complete client-built details object to the generic details route was rejected because the conversational action should not be able to rewrite identity or duration fields that the model never reviewed.

### Keep lifecycle actions deterministic and explicit

Evaluation, proposal creation, and requester agreement continue through their existing endpoints. The conversation renders buttons for these operations from current request state. Agreement requires a checked statement containing the exact current proposal version and details. Free text never maps directly to an operation.

### Validate model output as hostile input

The model receives only public scheduling fields. The extractor uses a closed JSON schema and rejects unknown properties, invalid lengths, offset-free timestamps, past windows, reversed windows, and windows shorter than the meeting duration. Ambiguous input returns clarification with no actionable review.

### Reuse official AI Elements for the website conversation

The requester conversation uses the generated conversation, message, prompt input, and suggestion primitives while preserving current product typography, spacing, and status components. Structured review and decision cards use existing shadcn components because they represent application state rather than free-form assistant prose.

## Risks / Trade-offs

- [A transient review disappears on refresh] → The original message remains visible and can be restated; no unreviewed extraction becomes durable state.
- [A model can phrase a misleading clarification] → The server supplies authority-safe action copy and treats the model text as explanatory only; controls derive exclusively from validated request state.
- [Concurrent messages invalidate a review] → The apply route requires the exact reviewed revision and rejects stale input.
- [Duplicate controls can confuse requesters] → Conversation actions use the same endpoint and proposal version as the existing detail cards, with identical action labels and state updates.

## Migration Plan

Deploy the API and web changes together. No schema migration is required. Rollback removes the optional review response and conversation controls while leaving the existing request lifecycle and stored messages intact.

# Proposal

## Why

Requester scheduling currently treats conversation as an unstructured message log and sends people back to separate forms for every meaningful action. The website should let a requester describe and refine the meeting in conversation, while retaining explicit review, feasibility, agreement, and host-approval boundaries.

## What Changes

- Return validated, revision-bound scheduling suggestions from requester messages for explicit review.
- Let requesters apply reviewed purpose, mode, location, and availability changes without altering identity, duration, or authority fields.
- Surface availability evaluation, candidate selection, and exact-proposal agreement as explicit conversation actions.
- Use AI Elements conversation and prompt primitives in the requester website.
- Reject ambiguous or stale extracted suggestions and keep free-text messages incapable of agreeing, approving, or booking.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `meeting-requests`: Extend account-free intake and constrained interpretation so a requester can complete the existing guarded scheduling lifecycle through website conversation.

## Impact

- Requester request-detail UI and its message response handling.
- Request message, draft-application, evaluation, proposal, and agreement API routes.
- Scheduling-intent model schema and validation.
- The existing `meeting-requests` capability; booking authority and host approval remain unchanged.

Related product direction: [product requirements](../../../documentations/02_product_requirements.md) and [request and booking runtime](../../../documentations/technical_specification/07_request_and_booking_runtime.md).

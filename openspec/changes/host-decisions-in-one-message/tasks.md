# Tasks

## 1. Decisions

- [x] 1.1 Record D1–D3 in the proposal, the delta spec and the [decision log](../../../documentations/technical_specification/08_decision_log.md#host-decisions-in-one-message).

## 2. Tools

- [x] 2.1 Add the optional `request` to `approve_proposal` and `decline_request`, resolved with `switch_conversation`'s matching among the host's own requests, and `proposalVersion` to `list_host_requests`. Verify unit tests for the matching and the target choice.

## 3. Instructions

- [x] 3.1 Tell the assistant in the host messenger fragment and the tool descriptions to apply each clear decision to the request it names, ask only about unclear ones, and report each outcome apart.
- [x] 3.2 Append host-review story eval cases for two decisions in one message and for an unclear decision beside a clear one, with a start state of two requests awaiting approval. Not run here: they call the paid model.

## 4. Release

- [ ] 4.1 Teammate review.
- [ ] 4.2 Run the appended eval cases with the real model and record the result in documentation 13.
- [ ] 4.3 After `host-imessage-channel` is archived, archive this change.

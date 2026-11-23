# Tasks

## 1. Replacement suggestions

- [x] 1.1 Merge the superseded pending suggestion's changes into the assistant's new suggestion in `suggestChangesCommand`, dropping the other mode's place or link (`replacementChanges`), and return the stored changes. Verify unit tests for `replacementChanges` and an integration test that the assistant's replacement keeps the pending start while the editor's replaces it.
- [x] 1.2 Say in `propose_shared_changes`, its result and the host-review fragment that the pending changes stay and how to undo one.

## 2. Related host review fixes (#272, #274, #276)

- [x] 2.1 Reply in the language of the host's latest message: English examples in the messenger fragment and the host tool descriptions, a language note in `read_request` and `list_host_requests`.
- [x] 2.2 Report `share_changes` as submitted for checking, not sent.
- [x] 2.3 Draft the exact time the host asks for, even outside the requester's windows.
- [x] 2.4 Append story cases for the four fixes and record them in documentation 13.

## 3. Documents

- [x] 3.1 Update `propose_shared_changes` in the agent configuration.

## 4. Release

- [ ] 4.1 Teammate review.
- [ ] 4.2 Run the host review story set (`FMAT_EVAL_AUDIENCE=host_review npx eve eval host-review/story`) for RV-02, RV-05, RV-06, RV-07, RV-22, RV-P5, RV-X10, RV-X14 and the appended cases, and record the result in documentation 13.
- [ ] 4.3 Archive this change, closing #275.

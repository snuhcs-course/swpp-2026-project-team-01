# Design

## 1. Merging the pending suggestion

`suggestChangesCommand("assistant")` supersedes the pending suggestion with `update … returning changes` inside the same transaction that inserts the new one, so the changes it merges are the ones it supersedes. `replacementChanges(pending, next)` lays `next` over `pending`; when `next.mode` is `online` it drops `pending.location`, and when it is `in_person` it drops `pending.linkPlan`. At most one suggestion per request is open (`shared_change_drafts_one_open_idx`), so there is one pending suggestion to merge or none.

`suggestChangesCommand("host")`, which the editor and the host MCP tool run, stores its input unchanged: the editor starts from the current proposal's values and sends what differs from them, so a field it leaves out means the proposal's value, not the pending suggestion's.

## 2. What the assistant is told

`propose_shared_changes` returns `changes`, the stored suggestion, and says it includes any pending change the host did not change. The tool input and the host-review fragment say a pending suggestion's other changes stay and that undoing one means passing the value the host wants.

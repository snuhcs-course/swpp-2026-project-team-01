# Design

## 1. Merging the pending suggestion

`suggestChangesCommand("assistant")` supersedes the pending suggestion with `update … returning changes` inside the same transaction that inserts the new one, so the changes it merges are the ones it supersedes. `replacementChanges(pending, next)` lays `next` over `pending`; when `next.mode` is `online` it drops `pending.location`, and when it is `in_person` it drops `pending.linkPlan`. Without `next.mode`, a `next.location` counts as `in_person` and a `next.linkPlan` as `online`: it drops the other mode's pending field and stores that mode, because sharing takes the mode from the suggestion, or else from the proposal, and would otherwise discard the place or link the host just gave. A `next` that names both a place and a link without a mode keeps the pending mode. Whatever mode the merged suggestion ends with, it then drops the other mode's field, from `pending` or from `next`, so a stored suggestion never pairs a mode with the other mode's place or link; only while no mode is known at all does it keep both, and sharing then uses the one that the proposal's mode needs. This last rule closes a review finding on #356: a `next` with a place and a link, or with a mode and the other mode's detail, could store a contradicting suggestion. At most one suggestion per request is open (`shared_change_drafts_one_open_idx`), so there is one pending suggestion to merge or none.

`suggestChangesCommand("host")`, which the editor and the host MCP tool run, stores its input unchanged: the editor starts from the current proposal's values and sends what differs from them, so a field it leaves out means the proposal's value, not the pending suggestion's.

## 2. What the assistant is told

`propose_shared_changes` returns `changes`, the stored suggestion, and says it includes any pending change the host did not change. The tool input and the host-review fragment say a pending suggestion's other changes stay and that undoing one means passing the value the host wants.

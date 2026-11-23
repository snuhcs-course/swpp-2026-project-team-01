# Design

## 1. Where the split happens

`splitStatedPatch(details, patch, inferred)` in `lib/server/request-reviews.ts` is a pure function: it returns the stated part (`applied`), whether that part changes anything the request holds (`changes`), and the part that waits on the card (`held`). Held:

- `contactName`, `contactEmail` and `timezone`: protected review, as before.
- The four time fields when `inferredTime` is set.
- `mode` and `location` when `inferredMode` is set.
- Any of `purpose`, `durationMinutes`, `mode`, `location`, `linkPlan` and `travelMode` whose value differs from a non-empty value the request holds. The same value, or a value for an empty field, is stated.
- The time fields when `durationMinutes` is held, so windows are never checked against a length the guest is changing.

New windows over earlier windows are not a conflict: replacing availability is how the guest changes times, and U21 already applied it at once.

## 2. The tool

`draftRequestReviewForTool` first drafts the whole patch as one review, so every check (future starts, fit to the merged length, the host's excluded times, contact rules) runs once on the whole draft and a rejected draft applies nothing. Then:

- Nothing stated, or a held part plus a stated part that changes nothing: the whole draft stays the pending review, as before.
- Nothing held: the draft is applied (`request.apply_review`, retry key `tool:{callId}:apply`) and times are found when the request is ready, as U21 did for times alone.
- Both: the stated part is drafted (`:stated`, superseding the whole draft) and applied, then the held part is drafted again (`:held`) at the new revision, so **Apply these details** can apply it. Times are not searched until the card is settled.

Each step has its own retry key, so a retried tool call replays the same outcome. The superseded whole draft is invisible: the guest thread leaves superseded reviews out and shows the applied one as an answered card, as it did for U21.

## 3. Why not apply in the instructions alone

The assistant could call `apply_request_review` after every explicit draft, but the decision would then depend on the model each turn, which is what #411 reports failing. Deciding in the tool keeps the rule the same in every conversation channel.

## 4. Rejected

- Applying conflicting values at once: the owner kept the card for anything that conflicts with what the request holds.
- Searching times while an inferred value waits: the times would ignore the guest's own assumed window or the length they are changing.
- Dropping the instruction to draft once nothing is missing: one draft still applies everything together and finds times in the same call; clarification questions stay as they are.

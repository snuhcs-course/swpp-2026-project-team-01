# Tasks

## Evaluation

- [x] Find the nearest open times before and after the requested windows when nothing fits, within the deadline, and store them in the requester projection.
- [x] Cover the stored nearest times, their absence when a time fits, and no event text in them in the evaluation integration tests.

## Guest assistant and card

- [x] Return `nearestTimes` and the nearest-times message from the guest's tools; cover them, the place variant and a week with nothing open in the request tools integration tests.
- [x] Tell the assistant to offer them in the same reply with no reason, and to draft a picked one as availability.
- [x] List them on the candidate times card.
- [x] Append a guest evaluation case (G-R01) and record it in the guest defense evaluation document.

## Documents and review

- [x] Update the product requirements (FR-10) and the guest booking flow (G6).
- [x] Regenerate the Korean mirrors of the changed documents.
- [x] Review with the team, then archive the change into `openspec/specs/meeting-feasibility/spec.md` and close #201.

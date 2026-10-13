# Specification status after reconstruction reset

Date: 2026-10-13. Application implementation is absent.

`specs/` retains the agreed behavioral baseline. Retaining a specification does not claim it is implemented in this checkout. Follow the [PRD](../documentations/02_product_requirements.md) and resolve conflicts before implementing a capability.

`changes/reconstruct-runtime-foundation/` is the fresh first-slice proposal. Its artifacts are planning only and its implementation tasks remain unchecked. The [implementation plan](../documentations/technical_specification/04_implementation_plan.md) sequences later bounded changes.

`changes/archive/` contains completed historical records of the removed implementation. `retired/2026-10-13/` contains unfinished plans superseded by this reset, without completion or spec promotion. Historical links, paths, checkmarks and test claims describe the old snapshot; retrieve matching source/docs from Git commit `02e5a8e` when investigating them. These folders are outside the active documentation link audit.

Implementation requires a new explicit request. Validate active artifacts with OpenSpec CLI 1.14.0 and sync/archive each bounded change only after fresh implementation and verification.

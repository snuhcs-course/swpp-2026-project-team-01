# Application verification

These directories reserve the replacement test locations; no application tests are implemented yet.

- `integration/`: shared domain, eve/web runtime, authorization and channel boundaries.
- `e2e/`: complete browser journeys against the rebuilt application.

Keep unit tests beside their modules and database tests in `supabase/tests/`. The current root checks validate documentation and retained infrastructure tooling only. Add executable test commands as implementation lands; do not count empty directories as coverage.

See the [implementation plan](../documentations/technical_specification/04_implementation_plan.md).

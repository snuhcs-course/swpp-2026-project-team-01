# Tasks

## 1. Deployment admission

- [x] 1.1 Add shared deployment admission at all messaging worker and transport entry points; verify preview/development/custom/ambiguous denial before RPC/network access and production/local compatibility, and document configuration and limits.

## 2. Integrated verification and rollout

- [x] 2.1 Verify built preview HTTP denial, application/provider regressions, integrations, SQL invariants, both builds and runtime checks; update the implementation evidence and plan.
- [x] 2.2 Deploy reviewed source to the identified production project, verify unchanged production guards and environment metadata, then sync/archive verified behavior and record remaining release gates.

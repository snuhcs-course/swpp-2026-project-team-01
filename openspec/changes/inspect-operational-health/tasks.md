# Tasks

## 1. Contracts and private projection

- [ ] 1.1 Define strict signal/input/output contracts and explicit-project operator configuration; verify redaction, unknown fields, sample limits and unchanged invitation target checks, and document the inspection boundary.
- [ ] 1.2 Implement the service-only read-only snapshot in desired SQL and a reviewed migration; verify all categories, ordering/bounds, permissions, null/invalid limits, no mutations and the full local rebuild with SQL tests; document signal semantics.

## 2. Operator command and acceptance

- [ ] 2.1 Implement the environment-bound JSON command with sanitized failures and no provider/recovery calls; verify actual CLI execution against local service credentials, ordinary credential denial and target mismatch, and add the operations runbook.
- [ ] 2.2 Run relevant application/integration/build checks, deploy the reviewed migration to the identified production target, compare definition/privileges and verify a rollback-only fixture plus read-only production command. Record evidence, update the plan and archive only after every requirement passes.

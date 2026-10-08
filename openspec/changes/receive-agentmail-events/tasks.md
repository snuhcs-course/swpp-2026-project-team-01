# Tasks

## 1. Durable receiver

- [x] 1.1 Add private registry/receipt/delivery desired schema and atomic service RPC; generate/review migration and verify rebuild, grants, identical/concurrent replay, changed identities, disabled/replaced receivers and one-job publication with SQL and integration tests.
- [x] 1.2 Connect the verified transport to a bounded HTTP receiver; test commit-before-ack, lost/failed commit, missing config, unsupported events and sanitized responses. Update setup and architecture documentation without enabling live delivery.

## 2. Deployment evidence

- [ ] 2.1 Run checks and both builds, deploy the reviewed migration and receiver, verify remote rollback isolation plus production denial/regression checks, and update the implementation plan with live ownership/routing gates still open.

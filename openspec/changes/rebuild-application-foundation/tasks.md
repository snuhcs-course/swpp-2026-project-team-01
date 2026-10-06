# Tasks

## 1. Baseline and ownership

- [ ] 1.1 Record current resource inventory, task ownership and all AC-01–AC-28 verification obligations; verify links and strict OpenSpec validation.
- [ ] 1.2 Reconcile settled expiry/language and proposed OTP documentation references with current specs; verify no settled behavior is weakened.

## 2. Shared foundation

- [ ] 2.1 Implement typed principals, scoped operation contracts, revision/idempotency guards and safe errors; verify cross-host/request denial, forged actors, conflicting retry keys and stale revisions.
- [ ] 2.2 Implement application-owned session bindings and guard every exposed runtime route/tool, including revocation; verify two-host/two-request isolation, shared/private switching and replay/restart recovery.
- [x] 2.3 Restore CI typecheck, application tests and separate production builds with pinned dependencies; document and execute clean install/build checks.
- [ ] 2.4 Verify retained migrations on the disposable local database and implement required additive schema changes; verify atomic command/work commits and service-only access.

## 3. Web foundation and integration

- [ ] 3.1 Implement authenticated `/app` and account-free protected booking route shells, safe returns and request credential exchange; verify authorization, CSRF, reload and no private shared cache.
- [ ] 3.2 Integrate existing admission/request contracts with authorized application operations and document their adapters; verify direct bypass, stale action and closed-receipt tests.
- [ ] 3.3 Complete foundation acceptance evidence and update owning documentation; verify runtime compatibility evidence separately and leave incomplete release scenarios pending.

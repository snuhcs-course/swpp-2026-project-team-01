# Tasks

## 1. Native provider boundary

- [ ] 1.1 Add native contact sharing to the installed Photon transport; verify exact saved route, reachability, reauthorization after preflight, zero automatic retries, sanitized uncertainty and environment denial with provider tests. Document acknowledgement limits in provider setup.

## 2. Durable authorized intent

- [ ] 2.1 Add strict request/status contracts and a private RLS-protected intent with atomic audit/publication, one intent per link and exact retry behavior; generate/review an additive pg-delta migration and verify unauthorized/cross-host/concurrent requests in SQL and integration tests. Document the backend boundary.
- [ ] 2.2 Implement bounded claiming, current session/admission/link/receiver checks, dispatch marking, fenced completion and expired-owner recovery; verify crashes before/after dispatch, revoked authority, changed routes, retry exhaustion and stale finish without duplicate sharing. Rebuild the full local migration chain and run database tests/advisors.

## 3. Worker and browser integration

- [ ] 3.1 Wire a protected internal worker and recurring recovery, with environment checks before claims and independent provider checks; verify lost wakeup, process termination, post-preflight revocation and no repeat send after uncertain results. Add sanitized operational visibility and document recovery.
- [ ] 3.2 Add same-origin protected browser request/status operations and an accessible optional contact action on the current linked card; verify keyboard/mobile layout, duplicate clicks, lost responses, reload, link replacement and truthful accepted/uncertain copy in browser tests. Update frontend, UX, PRD and application setup documentation.

## 4. Deployment and integrated acceptance

- [ ] 4.1 Run relevant app, database, integration, runtime and browser suites, strict OpenSpec validation and documentation checks; record evidence and mark only verified implementation-plan increments complete.
- [ ] 4.2 Review remote migration dry run against the selected project, deploy schema and production application, and verify authenticated endpoint guards, independent release alias/health and inactive receiver preservation. Record deployment and rollback evidence without sending to an unauthorized recipient.
- [ ] 4.3 With an explicitly authorized recipient, verify the native card on the saved private route and recipient-controlled saving on a recorded iPhone OS/provider profile. Record actual name/number behavior without inferring it from RPC acknowledgement; archive/sync only when all change requirements are verified.

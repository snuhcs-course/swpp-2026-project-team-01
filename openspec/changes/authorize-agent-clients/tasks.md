# Tasks

## 1. Protocol and durable authority

- [x] 1.1 Implement strict resource/redirect/scope/PKCE parsing and bounded asymmetric token/key handling without exposing routes. Verify malformed/duplicate inputs, foreign/expired/altered tokens, key rotation and authority callbacks; update owning setup/architecture docs and both builds.
- [x] 1.2 Implement private client/consent/grant/code/refresh records, fixed budgets, current host/request authority checks and atomic rotation/revocation through additive migrations. Verify local rebuild, grants/RLS, concurrency, expiry-after-lock and replay tests; document lifecycle and limits.

## 2. Browser and protocol integration

- [x] 2.1 Reserve protocol route names after checking existing handle conflicts, then wire registration, discovery, JWKS, authorization, token and revocation routes to durable authority. Verify standard form transport, exact resource/client/callback/PKCE binding, strict errors, input budgets and no secret leakage; update API/setup docs.
- [x] 2.2 Implement accessible explicit host/requester consent and revocation at `/connect/authorize`, preserving safe Google return and account-free requester binding. Verify grant/deny, wrong browser, lost responses, reload and keyboard/mobile behavior; update UX docs.
- [ ] 2.3 Add the internal agent credential adapter with per-operation scopes and current grant/underlying authority rechecks. Verify cross-host/request denial, closed/rotated/revoked access, no secret forwarding and no synthetic meeting approval; document MCP/CLI integration boundaries.

## 3. Deployment and compatibility

- [ ] 3.1 Provision release signing keys privately, deploy reviewed migrations/code and run real controlled browser/terminal authorization, token refresh and revoke with negative resource/audience/PKCE cases. Record public/private HTTP guards and cleanup, mark only verified plan steps, then archive/sync this change. Keep separate MCP/CLI and seven-client acceptance gates open until individually implemented and verified.

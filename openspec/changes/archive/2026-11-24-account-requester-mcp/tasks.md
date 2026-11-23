## 1. Implementation

- [x] 1.1 Extend explicit account OAuth consent and common MCP requester routing.
- [x] 1.2 Reuse creation and requester commands with verified account ownership and retry safety.
- [x] 1.3 Update public entry instructions and owning API documentation.
- [x] 1.4 Name the request scopes in the `/mcp` `401` challenge, derived from the tool list, so a fresh connection can consent to them (2026-11-20). Verify a unit test that the challenge covers every tool's scope and matches the resource metadata, and the host MCP integration test.

## 2. Verification

- [x] 2.1 Test multiple hosts, repeat meetings, retries, ownership, scopes, closure and anonymous compatibility.
- [x] 2.2 Run typecheck, lint, unit/integration tests, build and OpenSpec/documentation checks; record unavailable checks.

Local validation: Node 24.22.3; typecheck and lint passed (existing warnings); 885 unit tests and the account/requester/host/OAuth/entry integration suites passed; full eve + Next.js production build passed; documentation links and all 48 OpenSpec items passed. Named-client production acceptance and deployment were not run.

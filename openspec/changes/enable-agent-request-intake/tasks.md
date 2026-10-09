# Tasks

## 1. Contracts and private authorization

- [x] 1.1 Implement strict intake target/detail/clarification/result contracts and explicit scope/principal types; verify missing/ambiguous data, actor/host injection and existing-token compatibility.
- [x] 1.2 Add private consent/intake state, fixed host/reserved request identity, bounded admission and current grant checks through desired SQL and reviewed migrations; verify local rebuild, service-only privileges, expiry and revoke races.
- [ ] 1.3 Extend OAuth consent/code/refresh and token validation for intake authority without weakening existing host/request grants; verify exact resource/client/PKCE binding, deny, reuse and no scope widening.

## 2. Creation and continuation

- [ ] 2.1 Implement current-ready-host preflight plus atomic one-request creation/binding and retry recovery; verify concurrent same/different inputs, lost committed responses, host changes and revocation during provider I/O.
- [ ] 2.2 Resolve bound intake credentials into existing requester operations under current SQL authority; verify all catalog operations deny foreign requests/host roles and inherit rotation, closure and expiry.
- [ ] 2.3 Implement private same-browser continuation without model/terminal disclosure of request proof; verify wrong browser, copied ID, CSRF, lost reply, replay and expiry, preserving existing receipt limits.

## 3. Agent and browser surfaces

- [ ] 3.1 Add consent UI and authenticated MCP intake discovery/calls with sanitized bounded input/output; verify actual SDK and protected browser integration with sufficient/missing details and no booking-page form entry.
- [ ] 3.2 Add CLI intake login/create/continuation using private credential storage; verify real loopback authorization, no secrets in argv/output, uncertain retries and logout/revocation.
- [ ] 3.3 Update public skill instructions and owning PRD/architecture/setup/CLI docs; test both entry documents and truthful fallback without claiming untested client compatibility.

## 4. Deployment and acceptance

- [ ] 4.1 Run database, integration, runtime, browser, application and build checks; review code and deploy reviewed schema/app to the selected production target, then verify controlled creation/continuation and clean synthetic fixtures without outbound messages.
- [ ] 4.2 Record AC-15/21/24 bootstrap evidence and remaining full-workflow/named-client gates; update the implementation plan and archive only after every task above passes.

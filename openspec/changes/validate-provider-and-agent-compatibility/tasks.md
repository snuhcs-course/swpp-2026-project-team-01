# Tasks

## 1. Decisions and reproducible probes

- [x] 1.1 Record runtime, web/npm/shadcn, model, guest recovery, expiry, language, online-link, and host-confirmation decisions; verify the compatibility report names exact defaults and limitations.
- [x] 1.2 Add sanitized read-only provider probes and captured results; verify Supabase Auth/JWKS/OAuth discovery, AgentMail inbox access, Photon project/line access, Seoul Routes modes, and synthetic OpenAI schema results with `python3 scripts/p0/probe_providers.py --routes --model`.
- [x] 1.3 Record official OAuth/MCP, Photon transport, Calendar scope, AgentMail webhook/idempotency, and structured-output contracts; verify every selected behavior links its primary source and distinguishes candidate versions from runtime-tested versions.
- [x] 1.4 Record installed/available versions and individual status for Dots, Muse, Instinct, ChatGPT, Codex, Claude, and Claude Code; verify no untested client is marked compatible and all clients retain authenticated web confirmation as baseline.

## 2. Actual client and conversation compatibility gates

- [ ] 2.1 Enable the intended Supabase OAuth/DCR configuration and test a minimal application MCP tool in an actual browser client and terminal client; verify discovery, registration, redirects, token audience, refresh, revocation, and application-owned grants with captured evidence. Isolated browser/terminal harnesses passed code/refresh/revoke and read-only MCP calls with a client-bound audience hook; actual Codex CLI login, bound diagnostic tool call, post-revocation application-grant denial and logout passed in `scripts/p0/oauth-probe-native-results-2026-10-05.json`. Native-client refresh and product role/proposal journeys remain untested. `scripts/p0/oauth-probe-results-2026-10-05.json` also captures default-audience rejection and missing requested-resource enforcement. Production configuration and complete named-client tool journeys remain open.
- [ ] 2.2 Exercise requester and host roles in all seven named clients; verify permissions, current-proposal confirmation, stale decisions, and denied/revoked access with actual client versions recorded.
- [ ] 2.3 Exercise Photon SDK authentication and a controlled conversation through the selected Node/Bun bridge; verify runtime compatibility, routing, delivery, and explicit web confirmation continuation.
- [x] 2.4 Exercise AgentMail signature verification, reply threading, and uncertain-send recovery with dedicated identities; verify raw-body signatures, replay rejection, and idempotency-window handling. Two distinct product-controlled inboxes passed exact received-parent replies, inbox-local threading, same-key send/reply recovery and changed-payload 409. Six actual signed sent/delivered/received callbacks passed signature/replay/restart checks; task-owned webhook deletion and receiver/tunnel shutdown were verified. Frozen-payload and conservative 24-hour deadline guards are tested; actual elapsed provider key expiration is not claimed. Evidence: `scripts/p0/agentmail-distinct-probe-results-2026-10-05.json` and `scripts/p0/agentmail-paired-webhook-results-2026-10-05.json`.

## 3. Calendar and phase evidence

- [ ] 3.1 Complete actual host and requester Google consent/refresh and controlled Calendar reads/writes; verify separate scopes, callback binding, reconnect behavior, and exact deployment redirect URLs.
- [x] 3.2 Validate Routes coverage for intended geography and travel modes using controlled physical itineraries; verify missing estimates are unresolved and both adjacent directions fit with host margins. Public Seoul landmark evidence is in `scripts/p0/travel-evaluator-results-2026-10-05.json`: 12 live Routes calls through the actual evaluator, both directions, 10-minute margins, ample/tight gaps, unresolved DRIVE/WALK, and separately labelled synthetic manual allowances.
- [x] 3.3 Record P0 exit evidence and blockers in the owning implementation/provider documentation; verify fixture probes are not presented as actual client, human-consent, messaging, or Calendar booking success.

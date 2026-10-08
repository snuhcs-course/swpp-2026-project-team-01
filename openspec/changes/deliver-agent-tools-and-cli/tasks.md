# Tasks

## 1. Shared catalog and protected transport

- [x] 1.1 Define the typed catalog for the seven existing agent operations, with strict schemas, permissions, annotations and retry/handoff descriptions; verify mapping, role isolation and input rejection tests and document its internal status.
- [x] 1.2 Pin the official SDK and mount stateless `/mcp` with bearer verification, metadata challenge, origin checks, bounded uploads and sanitized results; verify protocol initialization, tool listing/calls, invalid tokens/origins/bodies and current revocation through SDK integration tests, and update architecture/setup documentation.
- [x] 1.3 Deploy the verified transport to the selected release project; verify real browser-granted requester calls, resource/scope/target rejection and revoked denial, recording production evidence and retaining named-client gates.

## 2. Complete scheduling coverage

Host discovery and audience-safe runtime history now pass local SQL, signed-token, cursor, revocation and real eve restart coverage. Production deployment is recorded in the rebuild evidence ledger.

- [x] 2.1 Add bounded host request discovery and audience-safe conversation reads through the transactional boundary; verify pagination, cursor ownership, cross-host/request denial and revocation races, with schema/migration and tool documentation.
- [x] 2.2 Add requester availability and negotiation operations using existing domain version/retry semantics; verify stale and conflicting mutations, requester isolation and equivalent browser outcomes, and document each tool's authority.
- [x] 2.3 Add candidate/current-proposal review and booking-status operations plus protected browser handoffs for human-only decisions and provider consent; verify no implicit approval/booking and consistent current-version review, with interface documentation.
Local signed MCP host setup now covers draft-to-human-confirmation and logout with a controlled Calendar adapter; requester availability/proposal/human-review state transitions now also pass signed MCP coverage with controlled providers. Complete booking and live provider acceptance remain outstanding.

- [ ] 2.4 Exercise complete host setup and requester scheduling through the catalog; verify remaining setup confirmation/handoff coverage, all domain migrations and production behavior before claiming workflow completion.

## 3. Thin CLI and entry journeys

The internal official-SDK transport and bounded command parser pass discovery, calls, authority denial, redirect and output-sanitization tests. Private POSIX storage now verifies isolation, atomic persistence, cross-process refresh coordination and durable uncertain outcomes. The runnable repository command now wires browser PKCE login, private persistence, MCP and logout; local listener/command/SDK tests pass. Live production journeys remain in task 4.1.

- [x] 3.1 Implement JSON tool discovery/invocation over the same MCP resource, with bounded input, stable errors/exits and no credentials in argv/output; verify real SDK round trips and document runnable commands.
- [x] 3.2 Implement browser PKCE login and private origin-separated credential storage, coordinated refresh and revoke/logout; verify wrong callback/state/issuer, parallel refresh, uncertain replies, permissions, cleanup and revoked calls, and document recovery.
Both public documents now include pinned source CLI commands and browser fallback, with local endpoint tests. Positive live host-specific and personal-agent entry acceptance remain open.

- [ ] 3.3 Update both public skill journeys to actual MCP/CLI setup and browser fallbacks; verify rendered Markdown, public-only projections and missing-client paths, then deploy and test both paste-to-agent entry paths.

## 4. Acceptance and release evidence

- [ ] 4.1 Verify real host/requester CLI and MCP journeys on the deployed resource, including refresh, revocation, denial and current-proposal human review; record results and synchronize individual named-client evidence with the compatibility change without inferring untested clients.
- [ ] 4.2 Run strict OpenSpec, application, integration, browser and build checks; review the code and archive only after all requirements above have verified evidence, updating the implementation plan while preserving unrelated release gates.

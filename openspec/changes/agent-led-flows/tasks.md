# Tasks

## 1. Decisions

- [x] 1.1 Record D1–D4 in the proposal and the design.
- [ ] 1.2 Add the decisions to the [decision log](../../../documentations/technical_specification/08_decision_log.md).

## 2. Guidance

- [x] 2.1 Add `nextStep` for every `nextAction` to `get_setup` (`lib/server/setup-tools.ts`), and `next` to `confirm_setup` and `agree_to_proposal`, with the words in [design 2](design.md#2-guidance-in-tool-results). Verify unit tests for each state and both results.
- [x] 2.2 Add "Start with get_host_status" to the host server instructions in `lib/server/agent-mcp.ts`. Verify the instructions test.

## 3. Setup values

- [x] 3.1 Require `hostWords` on `update_setup_field` and `confirm_setup` (`lib/server/agent-host-tools.ts`), unstored, with the descriptions in [design 3](design.md#3-setup-values-the-host-agreed-to). Verify unit tests for missing, blank and overlong words, and an integration test that sets meeting mode, place and travel mode and confirms setup through MCP.

## 4. Chat linking

- [x] 4.1 Add the `connect-link` token seal and open helpers. Verify unit tests for round trip, wrong context and tampering.
- [x] 4.2 Add `start_chat_link` (host) and `start_updates_link` (requester), running the existing create commands through `runAsGrant`. Verify unit tests for inputs and scopes, and integration tests for each role, an unconfigured channel, the hourly limit and a closed request.
- [x] 4.3 Add `chat` to `get_host_status` and `updates` to the requester's `get_request` from the existing status readers. Verify integration tests before and after linking.
- [x] 4.4 Build `/connect/link/{token}` and its status and confirm routes under `apps/web/app/connect/link/`, reusing the link card pieces, with the `return=link` sign-in return. Verify integration tests for confirm, cancel, an attempt no longer open, another host's session and a requester token for another attempt, and one Playwright journey per role.
- [x] 4.5 Update the `host:write` and `request:write` words in `lib/contracts/agent-access.ts` and on the consent page.

## 5. Entry documents

- [x] 5.1 Raise the instruction version to 5 and add the client connection section and the agent's steps to both documents (`lib/server/entry-documents.ts`). Verify the entry document unit and integration tests.

## 6. Documents

- [x] 6.1 Update the [agent clients notes](../../../documentations/technical_specification/09_agent_clients.md) (Claude Code steps, chat linking) and regenerate the `ko/` mirrors of every changed document.

## 7. Checks

- [x] 7.1 Run `npm run lint`, `npm run typecheck`, `npm test`, the changed integration test files and the new Playwright journeys, and `openspec validate agent-led-flows --strict`.

## 8. Release

- [ ] 8.1 Teammate review.
- [ ] 8.2 Run UAT U08-A and U08-B with Claude Code against the shared deployment, adjust the sheet's expected wording to what the agent says, and record the run in the [acceptance record](../../../documentations/technical_specification/07_acceptance_record.md).
- [ ] 8.3 After `agent-access` is archived, archive this change so its requirements apply to the archived specs.

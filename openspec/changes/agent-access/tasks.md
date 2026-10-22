# Tasks

Group 1 records the decisions and group 2 lays the schema; both are serial. Groups 3 to 5 are the plan's Phase 5 lanes A to C: Lane B needs Lane A's token verification, and Lane C needs Lane B's endpoint. Group 6 is the join and group 7 the release.

Before each group, read the [Phase 5 reference repository files](../../../documentations/technical_specification/06_implementation_plan.md#5-reference-repositories-per-phase) and name the files and revisions followed in the pull request. The proposal's [coverage table](proposal.md#modified-capabilities) lists which scenarios this change closes. Evidence goes to the [acceptance record](../../../documentations/technical_specification/07_acceptance_record.md) with command, date, revision and environment.

## 1. Decisions (serial, first)

- [x] 1.1 Record D1–D16 from the [proposal](proposal.md#decisions) in the proposal, the design, the delta specs and the [decision log](../../../documentations/technical_specification/08_decision_log.md#phase-5--agent-access), specify the one-future-request grant before any implementation, and update the owning documents they change (PRD FR-24, backend architecture, provider setup, CLI direction, page list). Verify `npm run check` passes.

## 2. Schema (serial)

- [x] 2.1 Add `agent_clients`, `agent_authorization_transactions`, `agent_grants`, `agent_authorization_codes`, `agent_refresh_tokens` and `agent_protocol_attempts` ([design 1](design.md#1-records)) to `supabase/schemas/app/`, each with row-level security. Generate the migration with `supabase db schema declarative sync --no-apply`. Verify `supabase db reset --local` rebuilds the chain and `supabase/tests/` shows `anon` and `authenticated` reach no new table.

## 3. Authorization server (Lane A)

- [x] 3.1 Add discovery, registration and tokens ([design 2, 3 and 5](design.md#2-resources-and-discovery)): the metadata documents and key set, client resolution with metadata documents and dynamic registration, the signing key, codes, refresh rotation, revocation and the grant check. Verify unit tests for the token checks and redirect matching, and integration tests for each discovery document, registration and its bound, concurrent and replayed code redemption, refresh replay, a changed resource, a wrong verifier, revocation and missing signing configuration.
- [x] 3.2 Add `/connect/authorize`, `/connect/consent` and `/connect/decision` with the sign-in return ([design 7](design.md#7-consent-and-sign-in)), and **Connected agents** in `/app` ([design 10](design.md#10-connected-agents)). Verify integration tests for the validation order, allow, deny and narrowing, another browser, the sign-in return and a stale transaction, and Playwright for a signed-in host narrowing, allowing and then revoking, and denying, at 390 and 1280 pixels. The browser test signs the host in beforehand, because Google's leg cannot run in a browser test; the sign-in return is covered by the integration test.

## 4. MCP server and user CLI (Lane B)

- [x] 4.1 Add the dual-era MCP handler and the host tools ([design 4 and 6](design.md#6-mcp-server)). Verify integration tests for both eras' methods and errors, the tool list per scope, each host tool, another host's request, a retried and a conflicting mutation, host decision preparation and a suspended host.
- [ ] 4.2 Add `cli/` with `fmat` ([design 9](design.md#9-user-cli)). Verify unit tests for argument parsing and output, and an integration test that logs in headlessly against a local server, lists tools, calls one, retries a mutation with its printed key, and reports a refused refresh as a new login.

## 5. Requester bootstrap and client notes (Lane C)

- [x] 5.1 Specify the one-future-request grant (the `agent-client-authorization` delta "One future request grant") before implementing it, in task 1.1.
- [ ] 5.2 Add the requester resource, its consent choices, `create_request` and the requester tools ([design 8](design.md#8-requester-bootstrap)), and the booking page's agent list. Verify integration tests for creation, its exact retry, a second creation, an unready host, another host's booking link, the bound restriction, a stale proposal, agreement within delegation and a closed request read after booking, and Playwright for a requester consenting without an account.
- [ ] 5.3 Rewrite the entry documents' connection text and add the per-client notes ([design 11](design.md#11-per-client-acceptance)). Verify unit tests for the documents and that each named client has a row.

## 6. Join

- [ ] 6.1 Run both skill prompts through each named client in both roles and record the Phase 5 evidence list: AC-14, AC-15 and AC-19 to AC-25 for Dots, Muse, Instinct, ChatGPT, Codex, Claude and Claude Code. Locally, verify a scripted MCP client and the CLI on the same request against the local stack: consistent status and versions, one booking after a retried action, and no access after revocation.

## 7. Release

- [ ] 7.1 Generate `AGENT_TOKEN_SIGNING_KEY` for Production and Preview and set it on the Vercel project, show the shared project's dry run and push the migration through the deploy workflow or, with the user's explicit approval, `supabase db push --linked`, then deploy to production.
- [ ] 7.2 With the user's go-ahead, publish the CLI package.
- [ ] 7.3 Teammate review of D1–D16, then `openspec archive` after verification.

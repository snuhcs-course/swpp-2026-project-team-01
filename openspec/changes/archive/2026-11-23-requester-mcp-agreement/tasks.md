# Tasks

## Requester MCP

- [x] Add `change_agreement` with `request:decide`, running `changeAgreementCommand` as the request's requester, on the requester endpoint and the account connection.
- [x] Point refusals of `update_request_details`, `find_times` and `choose_time` while awaiting approval at `change_agreement`, and give `change_agreement`'s own stale refusal a "nothing to reopen" next step.
- [x] Return an outcome-specific `next` from `choose_time` and `agree_to_proposal`, so only a recorded agreement says the host must approve.
- [x] Cover the tool, the refusals and every outcome sentence in unit tests.

## Documentation

- [x] Update the testing baseline's G02 P-1 and G01 P-5 rows, the agent clients reference and the decision log, and regenerate their Korean mirrors.

## Integration

- [ ] Run `tests/integration/agent-mcp-requester.test.ts` and `tests/integration/agent-mcp-account-requester.test.ts` against the local stack on `main` (owner's run after merge).

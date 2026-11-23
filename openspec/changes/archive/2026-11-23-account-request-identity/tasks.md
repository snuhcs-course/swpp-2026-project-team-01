# Tasks

## 1. Server

- [x] 1.1 Add `readAccountRequester`, `createAccountRequest` and `linkAccountRequest` in `lib/server/account-requests.ts`: account name, Google-verified address as the confirmed contact, host timezone, the Calendars item decided and the Calendar step settled; no items without confirmed settings.
- [x] 1.2 Drop `name` and `email` from the account `create_request` input, make `timezone` optional, and return `requester` and `calendars`.

## 2. Documentation

- [x] 2.1 Update the account MCP instructions in `entry-documents.ts` and `09_agent_clients.md`, and regenerate the `ko/` mirror.

## 3. Tests

- [x] 3.1 Unit: the account `create_request` schema refuses a typed name or email and needs no timezone.
- [x] 3.2 Integration (`tests/integration/agent-mcp-account-requester.test.ts`): identity, confirmed contact, host timezone, the decided Calendars item and the settled Calendar step; an account without settings is linked with no items. Written but not run here (the local Supabase stack is shared on this machine); the owner runs the integration suite on `main`.

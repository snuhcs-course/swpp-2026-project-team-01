# Proposal

## Why

[PRD AC-15/21/24](../../../documentations/02_product_requirements.md#9-end-to-end-release-acceptance-scenarios) require personal agents to start an account-free request from a host link without manual booking-page entry. The current CLI requires an existing browser-created request. The [acceptance inventory](../../../documentations/technical_specification/07_acceptance_inventory.md) records this as missing functionality, not completed compatibility.

## What Changes

- Add explicit account-free browser consent for one future request to one publicly ready host, without collecting meeting details in the browser.
- Issue a limited application OAuth intake grant. The agent supplies authorized details, receives clarification for missing/ambiguous data, and creates one request through the existing readiness/domain boundary.
- Bind that grant permanently to the created request for existing requester operations; preserve revocation, expiry, replay and host/private denial.
- Add MCP/CLI discovery and commands plus truthful root/host instruction documents. Preserve `/mcp` authentication and separate protected human decisions.

## Capabilities

### New Capabilities

- `agent-request-intake`: consent-bound one-request bootstrap and delegated continuation without manual booking-page intake.

### Modified Capabilities

- `agent-client-authorization`: permit a host-bound future-request intake grant in addition to existing host/request consent; fence it before and after request creation.

## Impact

OAuth consent/contracts/tokens and private schema; shared public-intake and agent operation adapters; MCP catalog, CLI login/commands, browser consent, public skill documents and migrations/tests. The [existing authorization contract](../../specs/agent-client-authorization/spec.md) remains authoritative except for the explicit intake-grant delta. The active [catalog change](../deliver-agent-tools-and-cli/tasks.md) still owns complete workflows and named-client acceptance remains with compatibility. No anonymous protected MCP, product requester account, implicit Calendar permission, host approval or external message is introduced.

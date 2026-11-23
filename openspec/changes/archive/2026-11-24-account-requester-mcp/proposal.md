# Proposal

Tracking issue: #266

## Why

An account connected to `/mcp` must currently add a separate MCP server to request a meeting with each host. Reuse the account connection with explicitly consented requester permissions.

## What Changes

- Let account grants consent to request scopes on `/mcp`, without changing existing grants.
- Create multiple requests by host handle and manage sent requests by explicit request ID.
- Reuse verified account links in `requester_host_profiles`, never contact-email matching.
- Keep anonymous per-host MCP endpoints and their single-request boundary.

## Capabilities

### Modified Capabilities

- `agent-client-authorization`: account grants may explicitly cover account-linked sent requests.

## Impact

MCP routing, requester creation, OAuth scope descriptions, public entry instructions and integration tests. Reuse existing command and account-link infrastructure; no schema change. Extends [agent authorization](../../../specs/agent-client-authorization/spec.md) and the account-as-guest behavior described in [host-as-guest-session](../2026-11-23-host-as-guest-session/proposal.md). No unresolved product decisions.

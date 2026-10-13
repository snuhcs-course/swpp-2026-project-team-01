# Proposal

## Why

Application OAuth is live, but an authorized personal agent still cannot invoke a protected MCP tool or use a supported CLI. Deliver the Phase 8 interfaces over the existing domain boundary so host and requester journeys can be tested in each required client.

## What Changes

- Mount a stateless Streamable HTTP MCP resource with strict bearer authentication, discovery challenges, bounded input and sanitized structured tool results.
- Expose named tools over shared agent operations, extending domain coverage for setup, request discovery/continuation, conversation, availability, negotiation and booking status. Preserve explicit browser confirmation whenever attributable human authority is required.
- Add a thin JSON CLI using the same tools and application OAuth, with browser PKCE login, protected local credential storage, refresh and logout/revocation. No provider or database credentials reach clients.
- Update both public skill journeys with real connection instructions and recovery paths. Verify host and account-free requester isolation and production operation before claiming transport completion.

## Capabilities

### New Capabilities

- `agent-scheduling-tools`: Shared tool catalog, protected transport, CLI lifecycle and scheduling workflow coverage.

### Modified Capabilities

None. Existing authorization and public-entry contracts remain applicable.

## Impact

Touches `lib/contracts`, `lib/server/oauth`, new MCP adapters, `apps/web/app/mcp`, CLI scripts, public skill rendering and tests. Domain coverage can require reviewed declarative schema changes and generated migrations. Pin the official TypeScript MCP SDK; retain one domain authorization boundary.

Owning requirements: [implementation plan Phase 8](../../../documentations/technical_specification/04_implementation_plan.md#phase-8--deliver-skill-entry-mcp-cli-and-named-clients), [interfaces](../../../documentations/user_experience/03_interfaces.md), [authorization](../../specs/agent-client-authorization/spec.md), [public entry](../../specs/public-agent-entry/spec.md), and [application commands](../../specs/application-commands/spec.md).

Named-client compatibility is recorded individually in the existing [compatibility change](../validate-provider-and-agent-compatibility/tasks.md); passing an SDK fixture does not satisfy it. Live Google, email, iMessage, operational and release gates remain in their owning changes. Client-specific attributable confirmation remains unproven, so human-only decisions use protected browser review; do not substitute a tool boolean for approval. Root-domain promotion remains a separate release action.

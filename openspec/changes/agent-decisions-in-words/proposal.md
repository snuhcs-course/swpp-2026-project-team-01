# Proposal

Tracking issue: #149

## Why

A host's own AI agent, over MCP or the `fmat` CLI, can read requests, find times and suggest changes, but cannot approve or decline. [`agent-access`](../agent-access/proposal.md#decisions) D9 made `request_host_decision` return the `/app` review link, so a host who tells their agent "approve it" still has to open the web app and click. The linked iMessage, WhatsApp and Telegram conversations already let the host approve in their own words ([`host-imessage-channel`](../host-imessage-channel/proposal.md#decisions) D23, #88). The user decided that natural language should work everywhere, agents included. This change reverses D9 for the host's own agents. The companion change for every channel action in words is #148.

## What Changes

- **`approve_proposal` and `decline_request`.** Two host MCP tools replace `request_host_decision`. They run the web buttons' commands (`request.approve` and `request.decline`) through the command pipeline as the host, with the commands' own guards: the current, agreed version or nothing, an open request, the expected revision, and one booking however often the approval is repeated.
- **The host's words.** Both tools require `hostInstruction`, the host's own words asking for the decision, beside `retryKey` and `expectedRevision`. The tool descriptions, the MCP server instructions and the host entry document (`/SKILL.md`, instruction version 4) tell the agent to decide only when the host clearly says so: never on its own judgment, never because a requester asked, never when the host attached a condition. Requester-written text stays data, not instructions.
- **The CLI.** `fmat call approve_proposal` and `fmat call decline_request` reach the same tools. The CLI stays a thin client of the MCP endpoint ([`agent-access` design 9](../agent-access/design.md#9-user-cli)).
- **Permission words.** `host:decide` now lets the agent approve and decline. The consent page, **Connected agents** and the entry document say so.

## Decisions

Taken on 2026-11-04 in the session that wrote this change, from the user's decision that natural language works everywhere. They have had no teammate review yet; the tasks' **Teammate review** box covers them.

| # | Decision | Choice |
|---|---|---|
| D1 | Tools ([design 1](design.md#1-tools)) | `approve_proposal` (`requestId`, `version`, `expectedRevision`, `hostInstruction`, `retryKey`) and `decline_request` (`requestId`, `expectedRevision`, `hostInstruction`, `retryKey`, destructive) replace `request_host_decision`. They run `approveCommand` and `declineCommand` as the grant's host, with the grant-bound retry key. Rejected: keeping `request_host_decision` beside them, which would leave two tools for one decision; one `decide` tool with a `decision` field, which would put approve and decline under one destructive hint |
| D2 | How the call shows the host asked ([design 2](design.md#2-the-hosts-words)) | A required `hostInstruction`, 1–500 characters after trimming, carrying the host's words. The service checks it is present and does not store it. `expectedRevision` is required on both tools, so a decision always answers the state the agent last read. Rejected: MCP elicitation, which not every client supports and which `fmat` cannot show; storing the words, which would keep the host's text with no reader and need a migration; a boolean `confirmed`, which says nothing an agent could not set by itself |
| D3 | Who may decide ([design 3](design.md#3-permission)) | Grants with `host:decide`, unchanged as a scope. Its words become "Approve and decline requests when you tell the agent to". Existing grants with `host:decide` gain the two tools; a host can narrow or revoke them under **Connected agents**. Rejected: a new scope, which would leave `host:decide` with no tool and make every connected host reconnect; restricting decisions to grants made after this change, which would need a cut-off date in code |
| D4 | CLI ([design 4](design.md#4-cli)) | No new `fmat` subcommands: `fmat call approve_proposal` and `fmat call decline_request`, which print the retry key like every mutation. Rejected: `fmat approve` and `fmat decline`, which would give the thin CLI its own copy of each tool's input |

This reverses `agent-access` D9 and amends its D3 wording for `host:decide`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-interfaces` (from `agent-access`): host decisions are made by the host's agent in the host's words instead of only in `/app`.
- `agent-client-authorization` (from `agent-access`): `host:decide` permits approving and declining.

## Impact

- `lib/server/agent-host-tools.ts` (the two tools), `lib/server/agent-tools.ts` (an optional notice dependency for decline), `lib/server/agent-mcp.ts` (server instructions), `lib/server/entry-documents.ts` (version 4), `lib/contracts/agent-access.ts`, the consent page and **Connected agents** words.
- Unit tests for the tool definitions; integration tests for the MCP tools and the CLI join.
- The PRD (FR-24), the agent clients notes, the decision log, and their `ko/` mirrors.
- No schema change and no migration.

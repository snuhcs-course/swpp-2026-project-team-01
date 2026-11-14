# Find Me a Time — Personal-Agent Clients

Status: connection paths written; no named client has been run yet\
Date: 2026-11-14\
Companions: [`agent-access` design](../../openspec/changes/agent-access/design.md#11-per-client-acceptance), [CLI direction](05_cli.md), [acceptance record](07_acceptance_record.md)

This document records, for each named client of PRD FR-24, how it finds the Find Me a Time instructions, how it connects, and the result of its last run in each role. It is the per-client acceptance plan of AC-14, AC-15 and AC-19 to AC-25. A row says "not yet run" until a team member runs it and records the evidence in the acceptance record; nothing here claims that a client works before then.

## What every client gets

| Role | Instructions | MCP endpoint | Permissions |
|---|---|---|---|
| Host | `https://findmeatime.com/SKILL.md`, linked from `https://findmeatime.com` | `https://findmeatime.com/mcp` | `host:read`, `host:write`, `host:decide` |
| Requester | `https://findmeatime.com/{handle}/SKILL.md`, linked from `https://findmeatime.com/{handle}` | `https://findmeatime.com/{handle}/mcp` | `request:read`, `request:write`, `request:decide` |

Both endpoints speak MCP `2026-07-28` and the handshake revisions `2025-11-25`, `2025-06-18` and `2025-03-26`, over Streamable HTTP with OAuth. A client registers through a client ID metadata document or dynamic client registration, opens the consent page in the person's browser, and receives tokens bound to that one endpoint. A client that cannot use a remote MCP server can still read the instructions and send the person to the web page; the CLI `fmat` is the path for agents that only have a shell.

The entry documents (instruction version 5) tell the agent to ask before adding a server and never to handle a token. After connecting, the host's agent starts with `get_host_status`, follows `get_setup.nextStep` through Calendar connection, calendar choice and analysis, and proposes settings only with the host's agreement. `update_setup_field` and `confirm_setup` require the host's own words as `hostWords`; these words are not stored. After setup, it shares the booking link and tells the host to ask it to check requests: agents are not notified.

For chat linking, the host's agent calls `start_chat_link` (iMessage, WhatsApp or Telegram); the requester's agent calls `start_updates_link` (iMessage or WhatsApp) after its request exists. The tool returns a short-lived `/connect/link/{token}` browser link for one attempt. The person sends the code from their own phone, checks the masked sender and presses **Confirm and link** there. Host links require that host's sign-in; requester links authorize only that attempt without showing the booking link or request details. `get_host_status.chat` and `get_request.updates` report `none`, `pending` or `linked`. The agent never confirms a link. After a requester agrees to a time, the service's next step says that the host must still approve, nothing is booked yet, and the outcome arrives by email; the person can ask the agent to check again.

## Test environment

Decided in the [`agent-access` proposal](../../openspec/changes/agent-access/proposal.md#decisions) (D16):

- **Where:** production, `https://findmeatime.com`, after the `agent-access` change is deployed with its migration and `AGENT_TOKEN_SIGNING_KEY`.
- **Who:** a team host account that has finished setup, and a team-controlled requester inbox. Each client runs under a team member's own account at its current public version.
- **What to record per run:** the client and its version or date, the account plan, how it found the instructions (plain URL or the explicit `/SKILL.md` form), the registration mechanism the authorization server logged (metadata document or dynamic registration) and the redirect host, the permissions it requested, the host-role result (AC-14, AC-19, AC-20, AC-22, AC-23) and the requester-role result (AC-14, AC-15, AC-21, AC-22, AC-24), and the denied-consent and unavailable-host checks (AC-25).
- **Prompts:** "Let me use findmeatime.com for my scheduling" (host) and "Let me schedule a meeting with findmeatime.com/{handle}" (requester), first with enough context and then with a missing detail, as AC-23 and AC-24 describe.

## Clients

Each connection path below is what the client's own documentation offers for a remote MCP server; the first run confirms or corrects it.

| Client | Connection path to try | Host role | Requester role |
|---|---|---|---|
| Claude Code | `claude mcp add --transport http findmeatime https://findmeatime.com/mcp`, then `/mcp`, choose the server and authenticate in the browser; requester: `claude mcp add --transport http findmeatime-{handle} https://findmeatime.com/{handle}/mcp`. If the server is absent from `/mcp`, restart Claude Code and continue | Not yet run | Not yet run |
| Claude | A custom connector with the MCP endpoint URL | Not yet run | Not yet run |
| ChatGPT | A connector (developer mode) with the MCP endpoint URL | Not yet run | Not yet run |
| Codex | A Streamable HTTP MCP server in its configuration with the endpoint URL; otherwise the CLI through its shell | Not yet run | Not yet run |
| Dots | To be confirmed at the first run: remote MCP if offered, otherwise the instructions and web continuation | Not yet run | Not yet run |
| Muse | To be confirmed at the first run: remote MCP if offered, otherwise the instructions and web continuation | Not yet run | Not yet run |
| Instinct | To be confirmed at the first run: remote MCP if offered, otherwise the instructions and web continuation | Not yet run | Not yet run |

An unresolved client is a release blocker, as the [implementation plan](06_implementation_plan.md#phase-5--agent-access) says, not a footnote.

## What a run checks

- The agent finds the instructions from the plain URL; if it cannot, the run repeats with the explicit `/SKILL.md` form and records that.
- Connecting shows the consent page with the client's name and redirect host; **Deny** leaves nothing connected.
- Host role: the agent reads setup and requests, cannot see another host's request, and approves or declines only when the host tells it to in their own words, passing those words; asked to approve with a condition, it asks the host instead ([`agent-decisions-in-words`](../../openspec/changes/agent-decisions-in-words/proposal.md)).
- Requester role: the agent creates one request with the person's own details, asks for anything missing, chooses within what the person allowed, agrees only to a time they accept, and reports the meeting as booked only after the host approves and the service shows it booked.
- Revoking the connection under **Connected agents** stops the agent at its next call.

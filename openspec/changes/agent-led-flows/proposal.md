# Proposal

Tracking issue: #205 (part of #196, depends on #185)

## Why

UAT U08 is rewritten as two flows that start from a pasted prompt: U08-A, a requester's agent, and U08-B, a host's agent ([Week 12 UAT sheet](https://docs.google.com/spreadsheets/d/12FlSV9Diu3XOd4QemltEE-WyeO9sQ_G4RIobGJH7ey0/edit?gid=1002#gid=1002), rows 52–76). The test client is Claude Code, which can add an MCP server itself. Checked against `main` 34b9bc47, the agent cannot lead a person through those steps:

- The entry documents name the MCP endpoints but not how a client adds one, so nothing tells Claude Code to run `claude mcp add` and authenticate with `/mcp` (`lib/server/entry-documents.ts`).
- The host server instructions never say to start with `get_host_status`, the only tool with a readable next step (`lib/server/agent-mcp.ts`).
- `get_setup` returns only a code for the next step (`connect_calendar`, `choose_calendars`, `analyzing`, `review_suggestions`, `confirm_settings`, `ready`), with nothing telling the agent to wait while the analysis runs or what to tell the host (`lib/server/setup.ts` `deriveNextAction`, `lib/server/setup-tools.ts`).
- `update_setup_field` records every value as the host's answer, whichever action the agent sends (`lib/server/setup-commands.ts` `updateDraftCommand`). An agent can therefore accept a meeting mode, place or travel mode the host never agreed to. The web needs a card press for these, and a linked chat needs the host's own words.
- `confirm_setup` returns only `{ handle, links }`. Nothing tells the agent to say that the host should share the link and ask the agent to check for requests, because it is not notified of them.
- Neither MCP server can link a chat. The web links iMessage, WhatsApp and Telegram for hosts (`/app` channel cards) and iMessage or WhatsApp updates for requesters (**Get updates in iMessage** on the booking page). The agents have no tool for either (`HOST_TOOLS`, `REQUESTER_TOOLS`).
- After a requester's agent agrees to a time, nothing tells it what to say next: that the host must still approve, that the outcome arrives by email, and that the person can ask again later.

## What Changes

- **Client connection steps in the entry documents.** `/SKILL.md` and `/{handle}/SKILL.md` (instruction version 5) give each named client's way to add the endpoint, starting with Claude Code (`claude mcp add --transport http <name> <endpoint>`, then `/mcp` to authenticate). They also say what the agent can do once connected, chat linking included.
- **Guidance in tool results.** `get_setup` returns a readable `nextStep` for every setup state, including waiting during `analyzing`. `confirm_setup` returns a `next` that says to share the link and to ask the agent to check for requests. `agree_to_proposal` returns a `next` that says the request waits for the host's approval, the outcome arrives by email, and the person can ask the agent again later. The host server instructions say to start with `get_host_status`.
- **Setup values the host agreed to.** The agent may propose any setup value from what it knows about the host. `update_setup_field` and `confirm_setup` take the host's words agreeing to it (`hostWords`), and the service refuses a call without them.
- **Chat linking through the agent, finished in the browser.** A new host tool starts an iMessage, WhatsApp or Telegram link, and a new requester tool starts an iMessage or WhatsApp link for updates. Each runs the web's existing create command as the grant's actor and returns a one-time browser link to a new page, `/connect/link/{token}`. On that page the person sends the code from their own phone and presses **Confirm and link**, as with OAuth consent. The agent never confirms a link, and a requester's agent never receives the booking link. `get_host_status` and the requester's `get_request` report the chat link's state.

## Decisions

Taken on 2026-11-14 with the user in the session that wrote this change. They have had no teammate review yet; the tasks' **Teammate review** box covers them.

| # | Decision | Choice |
|---|---|---|
| D1 | Where a link started by an agent is confirmed ([design 4](design.md#4-the-link-page)) | A new page, `/connect/link/{token}`, opened from a signed, short-lived token that the tool returns. It confirms that one attempt and nothing else. A host must be signed in as the attempt's host; a requester is authorized by the token alone, for that one attempt. Rejected: reusing the `/app` card and the booking page, because a requester's agent cannot hand over the booking link (it never receives it) and the two roles would finish in different places; letting the agent confirm, because then the person never sees which number is being bound |
| D2 | How the agent sets up the host ([design 3](design.md#3-setup-values-the-host-agreed-to)) | The agent may propose any value from what it knows about the host. A value is applied only with the host's words agreeing to it: `hostWords`, 1–500 characters, required on `update_setup_field` and `confirm_setup`, checked for presence and not stored, like `hostInstruction` on decisions. Rejected: changing only the guidance, which leaves the server accepting a mode, place or travel mode the host never agreed to; refusing `use_suggestion` for these fields, which would stop the agent proposing what it already knows |
| D3 | Readable steps ([design 2](design.md#2-guidance-in-tool-results)) | The service, not the model, writes the next-step sentence for each setup state and after confirming setup or agreeing to a time. Rejected: leaving the wording to each client's model, because then the UAT's expected results could not name what the agent says |
| D4 | Test client ([design 1](design.md#1-entry-documents)) | Claude Code is named first in the entry documents. The other clients in the [agent clients notes](../../../documentations/technical_specification/09_agent_clients.md) keep their rows; this change adds no client-specific code |

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-interfaces` (from `agent-access`): readable next steps, setup values with the host's words, and chat linking through the agent.
- `public-agent-entry`: each named client's connection steps, with instruction version 5.

## Impact

- `lib/server/entry-documents.ts` (version 5), `lib/server/agent-mcp.ts` (server instructions), `lib/server/agent-host-tools.ts` (`get_setup`, `update_setup_field`, `confirm_setup`, `get_host_status`, a new link tool), `lib/server/agent-requester-tools.ts` (`agree_to_proposal`, `get_request`, a new link tool), `lib/server/setup-tools.ts` (the `nextStep` words), `lib/contracts/agent-access.ts` (the `host:write` and `request:write` words).
- A new page and route under `apps/web/app/connect/link/`, reusing the link card's pieces (`apps/web/app/_components/imessage/imessage-card.tsx`, `apps/web/app/_components/requester/cards.tsx`).
- The link commands in `lib/server/imessage-links.ts` and `lib/server/requester-imessage-links.ts` stay as they are; the new tools and the page run them.
- Unit and integration tests for the tools, the entry documents and the page.
- The agent clients notes, the decision log and their `ko/` mirrors. Requirements and Specifications U08 is left for later, as the user decided; Testing Documentation §5 and the terms of service still say an agent cannot approve or decline, which is outside this change.
- No schema change and no migration: the token is signed, and the attempt's existing state makes it single-use.

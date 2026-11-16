## ADDED Requirements

### Requirement: Client connection steps
Both entry documents SHALL give each named client's way to add the matching MCP endpoint, starting with Claude Code (`claude mcp add --transport http` with the endpoint, then `/mcp` to authenticate, restarting the client if the server does not appear), and a general step for other clients. They SHALL tell the agent to ask the person before adding the server and never to handle a token. The host document SHALL tell the agent to start with `get_host_status` once connected and SHALL list chat linking among what the agent can do; the requester document SHALL list starting an updates link once the request exists.

#### Scenario: Claude Code reads the requester document
- **WHEN** Claude Code fetches `/{handle}/SKILL.md`
- **THEN** the document gives the `claude mcp add --transport http` command with `{origin}/{handle}/mcp` and says to authenticate with `/mcp`

#### Scenario: Claude Code reads the host document
- **WHEN** Claude Code fetches `/SKILL.md`
- **THEN** the document gives the command with `{origin}/mcp`, says to authenticate with `/mcp`, and says to start with `get_host_status`

#### Scenario: Instruction version
- **WHEN** either document is fetched after this change
- **THEN** it states instruction version 5

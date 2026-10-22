## MODIFIED Requirements

### Requirement: Honest client continuation
Documents SHALL explain that fetching them does not install tools or authorize actions. They SHALL name the role's MCP endpoint and the user CLI as the connection paths, state that connecting needs the person's own consent in a browser, offer direct web continuation when client tools are absent, preserve account-free requester access, state that identity and Calendar consent are separate grants even when one Google screen requests both, and require current requester agreement and attributable host approval in the browser before confirmed booking.

#### Scenario: Client has no integration
- **WHEN** the agent can read the document but lacks authorized scheduling tools
- **THEN** instructions direct the user to the intended browser continuation without invented endpoints, claims of connection, credential copying or booking success

#### Scenario: Client can connect
- **WHEN** an agent that supports remote MCP reads a ready host's document
- **THEN** it finds that host's `/{handle}/mcp` endpoint, learns that the person must allow the connection in the browser, and is told never to ask for a booking link or other credential in chat

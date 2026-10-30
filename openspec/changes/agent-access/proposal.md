# Proposal

## Why

Phases 1 to 4 deliver the product on the web: a host signs in, sets up and approves; a requester talks to the assistant on the host's page and agrees to a time. The PRD's personal-agent requirement (FR-24) and AC-14, AC-15 and AC-19 to AC-25 ask for the same work through each person's own agent: Dots, Muse, Instinct, ChatGPT, Codex, Claude and Claude Code, for both roles. The [implementation plan](../../../documentations/technical_specification/06_implementation_plan.md#phase-5--agent-access) makes this Phase 5: an authorization server, a remote MCP server and a thin user CLI over the same domain operations, and an account-free bootstrap for requesters.

The [agent-client authorization](../../specs/agent-client-authorization/spec.md) specification already states the protocol's safety properties. What blocks implementation is four decisions the plan assigns to this phase (MCP protocol version and client registration, permission scopes, CLI name and packaging, and the per-client test environment), the requester bootstrap the PRD still calls a proposed delta, and a conflict with the host login callback. Since the foundation change, the MCP specification also moved on: revision `2026-07-28` is now current, makes the protocol stateless with per-request metadata, and deprecates dynamic client registration in favour of client ID metadata documents, while the named clients still speak the earlier, handshake-based revisions.

## What Changes

- **Authorization server.** OAuth 2.1 with S256 PKCE at `/connect/authorize` and `/oauth/token`, protected-resource metadata (RFC 9728) for each MCP endpoint, authorization-server metadata (RFC 8414), client ID metadata documents, dynamic client registration for clients without them, one pre-registered first-party client for the CLI, Ed25519-signed access tokens bound to one resource, atomic single-use codes, rotating refresh tokens whose replay revokes the family, revocation (RFC 7009), and a check of the grant and the underlying host or request authority on every call and refresh.
- **Consent.** `/connect/authorize` validates the request and opens the consent page `/connect/consent`, which names the client, its redirect host and the permissions, lets the person narrow them, and records **Allow** or **Deny**. A host signs in on the way without losing the transaction. A requester consents without an account.
- **Connected agents.** `/app` gains **Connected agents**: each grant with its client, permissions and last use, and **Revoke**. The booking page lists and revokes the agents connected to that request.
- **Remote MCP server.** `/mcp` for hosts and `/{handle}/mcp` for requesters of that host, over Streamable HTTP, statelessly, for both protocol eras. Tools per role and permission call the existing commands through the command pipeline, with the host and requester projections; mutations carry a retry key. Host approval and decline always end with the host's confirmation in `/app`; a requester agent with the decision permission may agree to the current proposal and withdraw, as the PRD's delegation (AC-15) asks.
- **Requester bootstrap.** A requester's agent connects to `/{handle}/mcp`; the consent page shows that host and offers **Start a new request** (a grant for one future request) or connecting a request the person already has by its booking link. `create_request` creates exactly one request: an exact retry returns it, any other creation is refused, and the grant is then permanently restricted to that request. The booking link goes to the requester's email, never to the agent.
- **User CLI.** `fmat`, a dependency-free Node client of the same MCP endpoints with JSON output and stable exit codes, browser and headless login, the operating system's credential store, and reauthorization when a token response is lost.
- **Entry documents and client notes.** `/SKILL.md` and `/{handle}/SKILL.md` describe the real connection paths; a per-client notes document records discovery and connection for each named client.

## Decisions

The plan assigns D1–D4 to Phase 5; designing them raised D5–D16. They were taken by the implementing session on 2026-10-22 under the user's instruction to log every decision and keep it changeable, and are listed in the [decision log](../../../documentations/technical_specification/08_decision_log.md#phase-5--agent-access). None has had teammate review yet; the plan's **Teammate review** box covers them. The [design](design.md) records the reasoning and the rejected options.

| # | Decision | Choice |
|---|---|---|
| D1 | MCP protocol version ([design 6](design.md#6-mcp-server)) | Dual-era on one endpoint: the current revision `2026-07-28` (per-request `_meta`, `server/discover`, no sessions) and the handshake revisions `2025-11-25`, `2025-06-18` and `2025-03-26` through a stateless `initialize` that mints no session. JSON responses only; tools only. Rejected: `2026-07-28` alone, which every named client that still speaks the handshake revisions would fail; `2025-11-25` alone, which a modern client would have to fall back from |
| D2 | Client registration ([design 3](design.md#3-clients-and-registration)) | Client ID metadata documents (advertised with `client_id_metadata_document_supported`), dynamic client registration (RFC 7591) kept for clients that lack them, and the pre-registered first-party client `fmat-cli`. Registration grants nothing. Rejected: dynamic registration only (deprecated in `2026-07-28`); metadata documents only (several named clients register dynamically) |
| D3 | Permission scopes ([design 4](design.md#4-permissions)) | Hosts: `host:read`, `host:write`, `host:decide`. Requesters: `request:read`, `request:write`, `request:decide`. Each resource accepts only its role's scopes; consent can narrow them. `host:decide` prepares approval or decline and returns the `/app` review; it never approves. `request:decide` lets the agent agree to the current proposal and withdraw. Rejected: one scope per tool (too fine to consent to); a single read-write scope (cannot keep decisions distinct) |
| D4 | CLI name, packaging and OS support ([design 9](design.md#9-user-cli)) | The command `fmat` from the package `@findmeatime/cli` in `cli/`, Node.js 20 or later, no dependencies, built to JavaScript; macOS (Keychain) and Linux (Secret Service) supported, Windows only with an explicit file store and untested. Publishing to npm is blocked on the user. Rejected: a Go or Rust binary (a second toolchain for a thin client); `findmeatime` as the command (long to type) |
| D5 | Two resources, one per role ([design 2](design.md#2-resources-and-discovery)) | Hosts use `{origin}/mcp`; requesters use `{origin}/{handle}/mcp`, so the authorization request itself names the displayed host. Tokens are bound to the exact resource. Rejected: one resource with a host parameter the client would have to add, which no named client does |
| D6 | Tokens ([design 5](design.md#5-tokens-and-grants)) | Ed25519 JWT access tokens (`typ: at+jwt`) for 10 minutes, signed with `AGENT_TOKEN_SIGNING_KEY` and published at `/.well-known/jwks.json`; opaque refresh tokens, rotated on every use, valid 30 days; codes valid 60 seconds. Rejected: opaque access tokens (every check a database read, which the grant check needs anyway, but the spec asks for a verified signature); RS256 (larger keys and tokens) |
| D7 | Sign-in during consent ([design 7](design.md#7-consent-and-sign-in)) | `/auth/sign-in?return=consent&transaction={id}` keeps the return in an HTTP-only cookie after checking that the transaction is live; `/auth/callback` checks it again and returns to `/connect/consent?transaction={id}`, otherwise to `/app`. No other destination exists. Resolves the foundation design's open question; `chat-workspaces` is modified |
| D8 | The consent page's address ([design 7](design.md#7-consent-and-sign-in)) | `/connect/authorize` is the protocol endpoint (a route that validates and sets the browser binding); the page is `/connect/consent`. Rejected: one URL for both, which Next.js allows only by rendering HTML from a route handler |
| D9 | Host decisions ([design 4](design.md#4-permissions)) | Approval and decline always need the host's own click in `/app`; `request_host_decision` checks the version is current and returns `/app?request={requestId}`. Rejected: approving from a client's elicitation, which a client could answer without the host |
| D10 | Requester delegation ([design 8](design.md#8-requester-bootstrap)) | With `request:decide` the requester's agent may agree to the current proposal and withdraw the request; the host still approves. Rejected: requiring the requester's browser for agreement, which AC-15 rules out |
| D11 | Closed requests ([design 5](design.md#5-tokens-and-grants)) | After a request closes, its grants read only the closed status and the receipt, and refresh only for that, until the booking link's closed-access lifetime ends; nothing else. The main spec's "cannot refresh access" is modified so an agent can report the confirmed booking (AC-15) |
| D12 | One future request ([design 8](design.md#8-requester-bootstrap)) | The bootstrap grant lives 24 hours unbound; `create_request` with its retry key creates and identifies the request and sends the creation email with the booking link; the same key returns the same request; any other key, or a second call after binding, is refused; the request counts toward the creation bounds of the consenting browser's source. Rejected: binding at consent (the person has not described the meeting yet) |
| D13 | Existing requests ([design 8](design.md#8-requester-bootstrap)) | The requester consent page also accepts the person's booking link to connect a request they already have, for that host only. Rejected: a connect button on the booking page, which cannot reach a client's authorization request |
| D14 | Headless login ([design 9](design.md#9-user-cli)) | `fmat login --no-browser` prints the authorization URL; the first-party client's redirect `{origin}/connect/code` shows the code to paste back. Rejected: the device authorization grant (RFC 8628), a second grant type and page for one client |
| D15 | Redirect URIs ([design 3](design.md#3-clients-and-registration)) | Exact match of scheme, host, path and query; only `https` or loopback `http`. For loopback redirects (`127.0.0.1`, `[::1]` and `localhost`) the port may differ, as OAuth 2.1 requires for native clients. Rejected: exact ports for loopback (breaks native clients that pick a free port); port freedom for IP literals only, the first choice, revised on 2026-10-29 because it refused Claude Code, which registers `http://localhost/callback` |
| D16 | Per-client test environment ([design 11](design.md#11-per-client-acceptance)) | Production `https://findmeatime.com` after this change is deployed, a team host account and a team requester inbox, each client at its current public version under a team member's own account; each run records the client and version, the discovery path, the registration mechanism observed and both roles in the acceptance record. Blocked on the user |

## Conflicts resolved here

| Conflict | Resolution |
|---|---|
| **Fixed sign-in return.** [`chat-workspaces`](../../specs/chat-workspaces/spec.md#requirement-google-only-mvp-host-login) fixes the `/auth/callback` return to `/app`; the [page list](../../../documentations/user_experience/04_page_list.md) asks `/connect/authorize` to preserve its transaction across sign-in, and the [foundation design](../application-foundation/design.md#open-questions) left this open | D7: one server-checked alternative return, to a live consent transaction; MODIFIED in `chat-workspaces` |
| **Who reaches the consent page.** The page list's P10 requires an authenticated host; the PRD and the agent-client spec require account-free requester consent | P10 serves both: host resources require sign-in, requester resources never do; the page list is corrected |
| **Refresh after closure.** [`agent-client-authorization`](../../specs/agent-client-authorization/spec.md#requirement-current-grant-enforcement-and-revocation) denies refresh after a request closes; AC-15 asks the agent to report the confirmed booking, which closes the request | D11: MODIFIED; closed-status read only |
| **Registration.** The plan and provider setup expect dynamic registration; MCP `2026-07-28` deprecates it for client ID metadata documents | D2: both, with metadata documents preferred |
| **Proposed delta in the PRD.** PRD FR-24 calls the one-future-request grant a proposed delta | Specified here (ADDED "One future request grant"); the PRD links to it |
| **Browser continuation.** The PRD keeps the bootstrap's human continuation "private to the consenting browser", but the browser leaves for the client's redirect before any request exists | D12: the continuation is the booking link in the creation email to the requester's own address, never returned to the agent; the PRD sentence is corrected |

## Capabilities

### New Capabilities

- `agent-interfaces`: the remote MCP server and the user CLI as interfaces over the shared domain operations: endpoints and protocol eras, tools per role and permission, projections, retry identity, structured results and errors, human confirmation for host decisions, CLI login, storage, output and exit codes. Today the behavior is spread across PRD FR-24, the CLI direction document and the backend architecture, with no capability spec holding the contract.

### Modified Capabilities

- `agent-client-authorization`: discovery and registration (D2, D5, D15), the permission scopes (D3), the one-future-request grant (D12, D13), connected-agent inspection and revocation, consent for both roles (D7), and closure (D11).
- `chat-workspaces`: the sign-in return to a live consent transaction (D7).
- `public-agent-entry`: the documents describe the MCP endpoints and the CLI and keep the web continuation.

This change also closes scenarios that the main specs already state, without changing their text:

| Specification | Closed in this change | Deferred, and where |
|---|---|---|
| [`agent-client-authorization`](../../specs/agent-client-authorization/spec.md) | "Changed resource"; "Wrong verifier or callback"; "Requester grants access"; "Client claims human approval"; "Foreign or altered token"; "Concurrent code redemption"; "Refresh replay"; "Missing signing configuration" | Per-client evidence (blocked, below) |
| [`public-agent-entry`](../../specs/public-agent-entry/spec.md) | "Client has no integration" with the real connection paths | Named-client discovery (blocked) |
| [`application-commands`](../../specs/application-commands/spec.md) | "Client supplies another actor" and "Identical retry" over MCP and the CLI | None |

## Archive order

The changes of Phases 3 and 4 are not archived yet. This change's deltas touch requirements neither modifies (Phase 4 modifies no `chat-workspaces` login requirement), so the three can archive in any order; archiving in delivery order keeps the main specs' history readable.

## Impact

- **New code:** `lib/server/agent-*.ts` (protocol, clients, consent, tokens, grants, MCP server, host and requester tools), `lib/contracts/agent-access.ts`, the routes under `apps/web/app/{connect,oauth,mcp,.well-known}` and `apps/web/app/[handle]/mcp`, the **Connected agents** dialog in `/app` and its list on the booking page, and `cli/`.
- **Changed code:** `google-sign-in.ts` accepts the consent return; `entry-documents.ts` describes the connection paths; `request-start.ts` shares its draft insert with agent creation; the proxy matcher skips protocol routes.
- **Schema:** `agent_clients`, `agent_authorization_transactions`, `agent_grants`, `agent_authorization_codes`, `agent_refresh_tokens` and `agent_protocol_attempts`, generated through pg-delta.
- **Configuration:** `AGENT_TOKEN_SIGNING_KEY`, an Ed25519 private key per environment.
- **Systems:** none new. A migration on the shared project `anelszynxtvxoxqvzgqt`, a production deploy, publishing the CLI and every named-client run are left to the user (decision log, "Blocked on the user").
- **Documents:** the plan's Phase 5 boxes, PRD FR-24 and its delta note, [backend architecture](../../../documentations/technical_specification/01_backend_architecture.md#mcp-oauth-and-cli), [provider setup](../../../documentations/technical_specification/03_provider_setup.md#protected-mcp-oauth-compatibility), [CLI direction](../../../documentations/technical_specification/05_cli.md), the [page list](../../../documentations/user_experience/04_page_list.md), a new per-client notes document, the decision log and the acceptance record, with their Korean mirrors.
- **Tracking:** issue [#47](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/47).

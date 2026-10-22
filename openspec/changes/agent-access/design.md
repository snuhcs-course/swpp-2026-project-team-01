# Design

## Context

See [proposal.md](proposal.md). Phases 1 to 4 left these pieces to build on:

- the command pipeline (`lib/server/commands.ts`), which derives the actor from verified credentials, freezes retry identity per actor and saves outcomes, and every host and requester command behind it: setup drafts and confirmation, the host request card commands, and the requester's details, evaluation, choice, agreement, withdrawal and booking check;
- the host projection (`readHostRequest`, `listHostRequests`) and the requester projection (`readRequesterView`), each filtered before serialization;
- the requester request start (`request-start.ts`): the draft insert with its hashed and sealed booking link, identification, which sends the creation email with the booking link, and the creation bounds per keyed source address;
- Supabase Auth sign-in with a fixed `/auth/callback` return to `/app`, the same-origin refusal, the keyed source hash and the token sealing key;
- the public entry documents and their content negotiation.

Before designing each module, read the reference files the [plan names for Phase 5](../../../documentations/technical_specification/06_implementation_plan.md#5-reference-repositories-per-phase): the eve chat template's "Authorization Flow For Connections" (Connect and Skip), the personal-agent template's integrations page, `ConnectorCard.vue` and `useConnector(s).ts` (a connected list with revoke), OpenInstinct's `auth-route.test.ts` (route tests for auth endpoints), and the vendored `mcp-builder` skill (stateless JSON Streamable HTTP, tool naming, annotations, structured results, actionable errors). None of them implements a resource-bound authorization server, so the [agent-client authorization contract](../../specs/agent-client-authorization/spec.md) and the MCP specification govern it. The pull request names the revisions.

## Goals / Non-Goals

**Goals:** a host connects an MCP client or the CLI, grants limited permissions, works through setup and requests with them, and revokes the connection; a requester's agent starts from a public link, gets one request without an account, negotiates within its delegation and reports the booking; every credential is bound to one resource, one client and one grant, and stops working the moment its grant or the underlying authority does.

**Non-goals:** Calendar connection, calendar selection and the setup analysis through agents (they stay in the browser, which the documents say); host approval or decline without the host's click in `/app`; MCP resources, prompts, subscriptions, sampling or elicitation; the iMessage and email channels (Phases 6 and 7); publishing the CLI or any named-client run (blocked on the user).

## Decisions

### 1. Records

| Table | Holds | Authoritative for |
|---|---|---|
| `agent_clients` | The client ID (`fmat-cli`, `dcr_…` for a registered client, or the HTTPS URL of a metadata document), kind (`first_party`, `registered`, `metadata_document`), name, client URI, redirect URIs, the registration's source hash, the metadata document's fetch and expiry times, `disabled_at` | Which redirect URIs a client may use; registration grants nothing |
| `agent_authorization_transactions` | ID, client, redirect URI, the client's `state`, the S256 code challenge, the resource, role, the displayed host and handle for requester resources, the requested scopes, the hash of the browser binding, the source hash, `expires_at` (10 minutes), the decision and its time | One authorization request between `/connect/authorize` and the person's decision |
| `agent_grants` | ID, client, role, host account (the grantor for hosts, the request's host for requesters), request (null while a bootstrap grant is unbound), `bootstrap`, the creating retry key, scopes, resource, source hash, `created_at`, `bound_at`, `last_used_at`, `expires_at` (24 hours for an unbound bootstrap grant), `revoked_at` and reason | The consented access, checked on every call and refresh |
| `agent_authorization_codes` | The code's SHA-256, grant, client, redirect URI, code challenge, resource, scopes, the refresh family it produced, `expires_at` (60 seconds), `consumed_at` | Single-use code redemption |
| `agent_refresh_tokens` | The token's SHA-256, grant, family, client, resource, scopes, `expires_at`, `consumed_at`, `revoked_at` | Refresh rotation and replay detection |
| `agent_protocol_attempts` | Kind, the hashed key it counts, time | Registration, authorization, token and tool-call bounds |

Every table has row-level security and no client grants, like the rest of `app`. A grant goes with its client, host account or request; codes and refresh tokens go with their grant.

### 2. Resources and discovery

Each listed origin is its own issuer. For the origin a request was addressed to:

| URL | Serves |
|---|---|
| `{origin}/mcp` | The host MCP endpoint; resource `{origin}/mcp` |
| `{origin}/{handle}/mcp` | The requester MCP endpoint for that host; resource `{origin}/{handle}/mcp` |
| `/.well-known/oauth-protected-resource/mcp`, and `/.well-known/oauth-protected-resource` as the root fallback | Host resource metadata: `resource`, `authorization_servers: [origin]`, `scopes_supported` (the host scopes), `bearer_methods_supported: ["header"]`, `resource_name` |
| `/.well-known/oauth-protected-resource/{handle}/mcp` | Requester resource metadata for a ready host; a neutral 404 otherwise |
| `/.well-known/oauth-authorization-server` | Issuer, `authorization_endpoint` `/connect/authorize`, `token_endpoint` `/oauth/token`, `registration_endpoint` `/oauth/register`, `revocation_endpoint` `/oauth/revoke`, `jwks_uri` `/.well-known/jwks.json`, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code", "refresh_token"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`, `revocation_endpoint_auth_methods_supported: ["none"]`, `scopes_supported` (all six), `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported: true` |
| `/.well-known/jwks.json` | The public Ed25519 key only |

An unauthenticated or invalid call to an MCP endpoint answers `401` with `WWW-Authenticate: Bearer resource_metadata="…", scope="…"` naming that endpoint's metadata and role scopes; a valid token lacking a scope answers `403` with `error="insufficient_scope"` and the scopes the operation needs. All of these answer `Cache-Control: no-store` except the two metadata documents and the key set, which may be cached for five minutes. Public clients authenticate with `none`; there are no client secrets.

### 3. Clients and registration

- **First party.** `fmat-cli`, defined in code and upserted on first use, with the redirect URIs `http://127.0.0.1/callback`, `http://[::1]/callback` and `{origin}/connect/code`.
- **Client ID metadata documents.** A `client_id` that is an `https` URL with a path is fetched on the authorization request: the host must be a name (no IP literal, no `localhost` or single-label name), every address it resolves to must be public, the fetch follows no redirect, stops at 5 seconds and 5 KB, and requires JSON whose `client_id` equals the URL exactly and which has `client_name` and `redirect_uris`. The document is cached for its `max-age`, at least 5 minutes and at most 24 hours.
- **Dynamic registration.** `POST /oauth/register` (RFC 7591) accepts `client_name`, `redirect_uris`, optional `client_uri`, `grant_types`, `response_types`, `token_endpoint_auth_method: "none"` and `application_type`, and returns a `dcr_` client ID. It is bounded per source and service-wide (section 12) and grants nothing: the client still needs a person's consent.
- **Redirect URIs** are `https` URLs, or loopback `http` URLs on `127.0.0.1`, `[::1]` or `localhost`, without fragments. Matching is exact on scheme, host, path and query; for the loopback IP literals the port may differ (OAuth 2.1, native clients). The consent page shows the redirect host and warns when every redirect is local.

### 4. Permissions

| Scope | Role | Lets the agent |
|---|---|---|
| `host:read` | Host | Read setup status, requests in the host projection and booking status |
| `host:write` | Host | Change the setup draft and confirm settings, evaluate, suggest, share or dismiss changes, allow a host trip, waive the weekly limit, check a booking |
| `host:decide` | Host | Prepare an approval or a decline: the tool checks the named version is the current one awaiting approval and returns the `/app?request={requestId}` review, where only the host's own click decides (D9) |
| `request:read` | Requester | Read the host's public profile and the request in the requester projection |
| `request:write` | Requester | Create the one request (bootstrap only), change details, find times, allow a trip, choose a time, check the booking |
| `request:decide` | Requester | Agree to the current proposal and withdraw the request (D10) |

A resource accepts only its role's scopes; any other scope, a missing scope or an unknown one is `invalid_scope`. Consent may narrow the requested scopes but never widen them; refresh may narrow them further. `tools/list` returns only the tools the token's scopes permit, in a fixed order, so a narrowed grant never shows a tool it cannot call.

| Tool | Scope | Runs |
|---|---|---|
| `get_host_status` | `host:read` | Eligibility, readiness, handle, booking and instructions links, and the next step in `/app` |
| `get_setup` | `host:read` | The setup state without the live calendar list |
| `update_setup_field` | `host:write` | `setup.update_draft` |
| `confirm_setup` | `host:write` | `setup.confirm_settings`, with the calendar list read live as the setup route does |
| `list_requests` | `host:read` | The inbox |
| `get_request` | `host:read` | The host projection |
| `evaluate_request` | `host:write` | `request.host_evaluate` |
| `suggest_changes`, `share_changes`, `dismiss_changes` | `host:write` | The shared-changes commands, as the host |
| `allow_host_trip`, `waive_weekly_limit` | `host:write` | The exception commands |
| `check_booking` | `host:write` | `booking.check` |
| `request_host_decision` | `host:decide` | The review link for approve or decline, no command |
| `get_host` | `request:read` | The displayed host's public profile |
| `create_request` | `request:write` | The bootstrap creation (section 8) |
| `get_request` | `request:read` | The requester projection without the thread or any link |
| `update_request_details` | `request:write` | `request.update_details` |
| `find_times` | `request:write` | `request.evaluate`, waiting up to 15 seconds for the result |
| `allow_trip` | `request:write` | `request.allow_trip` |
| `choose_time` | `request:write` | `request.choose_candidate` |
| `agree_to_proposal` | `request:decide` | `request.agree` |
| `withdraw_request` | `request:decide` | `request.withdraw` |
| `check_booking` | `request:write` | `booking.check` |

Every mutation takes `retryKey` (8 to 200 characters) and, where the command checks it, `expectedRevision`. The pipeline's retry key is `mcp:{grantId}:{retryKey}`, so one grant's retries replay their own outcomes and never another interface's.

### 5. Tokens and grants

- **Access tokens** are JWTs signed with Ed25519 (`alg: EdDSA`, `typ: at+jwt`, `kid` the RFC 7638 thumbprint) with `iss`, `aud` (the exact resource), `sub` (`host:{id}` or `grant:{id}`), `client_id`, `scope`, `jti`, `iat`, `nbf`, `exp` (10 minutes) and `grant_id`. Verification rejects any other algorithm or header key, a wrong issuer, audience, type, time or a changed claim. They carry no login, continuation or provider credential.
- **The key** is `AGENT_TOKEN_SIGNING_KEY`, a base64 PKCS#8 Ed25519 private key. When it is absent or malformed, `/oauth/token` answers `temporarily_unavailable` and the key set is empty; nothing generates a key.
- **Codes** are 32 random bytes, stored hashed, valid 60 seconds. Redemption is one `update … where consumed_at is null returning`; a second redemption issues nothing and revokes the family the first produced.
- **Refresh tokens** are 32 random bytes, stored hashed, valid 30 days, rotated on every use with the same family. A consumed or revoked token presented again revokes the whole family. Refresh preserves the resource, client and grant and may only narrow scope; it never extends the grant.
- **Every call and refresh** rechecks: the grant is not revoked or expired, its client is not disabled, the token's grant matches, and the underlying authority holds: an active host account for host grants; for requester grants the bound request still belongs to the grant's host. An open request allows the role's tools; a closed one allows only `get_request`, which then returns the closed status and receipt, and refresh for that, until the booking link's closed-access lifetime ends (D11). An unbound bootstrap grant allows `get_host` and `create_request` until it expires.
- **Revocation** (`/oauth/revoke`, RFC 7009) accepts a refresh or access token and revokes its grant; it answers `200` for unknown tokens. **Revoke** in `/app` or on the booking page revokes the grant and its refresh tokens.

### 6. MCP server

One handler serves both endpoints, statelessly, in the in-house module `lib/server/agent-mcp.ts` (D1; rejected: the TypeScript SDK, whose server transport is built for Node's request objects and sessions, and which would pin one protocol era).

- `POST` only; `GET` and `DELETE` answer `405`. A present `Origin` header that is not a listed origin answers `403`. The body is one JSON-RPC message of at most 64 KB.
- **Modern requests** carry `_meta["io.modelcontextprotocol/protocolVersion"]`. The handler checks that it equals the `MCP-Protocol-Version` header, that `Mcp-Method` equals the method and, for `tools/call`, that `Mcp-Name` (after Base64 sentinel decoding) equals the tool name (`-32020` and `400` otherwise), and that `clientCapabilities` is present (`-32602`). An unsupported version answers `400` with `-32022` and the supported list. Methods: `server/discover`, `tools/list`, `tools/call`, `ping`; results carry `resultType: "complete"` and `_meta["io.modelcontextprotocol/serverInfo"]`. An unknown method answers `404` with `-32601`.
- **Legacy requests** use `initialize`, which answers the requested version when it is one of `2025-11-25`, `2025-06-18` or `2025-03-26` (else `2025-11-25`) with the tools capability and server information, and mints no `Mcp-Session-Id`; `notifications/initialized` and other notifications answer `202`; later requests carry the version in `MCP-Protocol-Version` (absent means `2025-03-26`). Methods: `tools/list`, `tools/call`, `ping`.
- **Tool results** carry `structuredContent` and the same JSON as one text block. A command failure is a tool result with `isError: true` and the stable category, message and next action (for example `"Refresh with get_request and use the current version"`), never a protocol error. Unknown tools are `-32602`.

### 7. Consent and sign-in

1. `GET /connect/authorize` validates, in order: no repeated parameter; `response_type=code`; a known or fetchable client; a `redirect_uri` the client registered. Until the redirect URI is validated, errors render a plain error page and never redirect. After it, errors (`invalid_request`, `invalid_scope`, `unsupported_response_type`) redirect to the client with `state` and `iss`. Then: `code_challenge` (43 to 128 characters) with `code_challenge_method=S256`; `resource` equal to a host or ready-host requester resource of this origin; `scope` naming only that role's scopes. It records the transaction with a random browser nonce, sets the nonce in an HTTP-only, `SameSite=Lax` cookie scoped to `/connect`, and redirects to `/connect/consent?transaction={id}`.
2. `/connect/consent` (P10) shows the client name, its redirect host, a warning when every redirect is local, the role and the permissions with plain descriptions as checkboxes, and **Allow** and **Deny**. For a host resource it requires a signed-in, eligible host; otherwise it offers **Sign in with Google**, which goes to `/auth/sign-in?return=consent&transaction={id}`. For a requester resource it shows the host's display name (quoted, as data) and handle and requires no sign-in (section 8).
3. `POST /connect/decision` requires the same origin, the browser binding cookie, a live, undecided transaction and, for hosts, the same signed-in host. **Allow** creates the grant with the checked scopes and a code, and redirects to the client with `code`, `state` and `iss`; **Deny** records the decision and redirects with `error=access_denied`. Either way the transaction is spent.

The sign-in return (D7): `/auth/sign-in` accepts `return=consent` with a transaction ID, checks that the transaction is live and undecided, and stores it in an HTTP-only cookie scoped to `/auth` for 10 minutes. `/auth/callback` reads the cookie, clears it, checks the transaction again and returns to `/connect/consent?transaction={id}`; anything else returns to `/app`. A query string never chooses the destination.

### 8. Requester bootstrap

The requester resource names the host, so the consent page shows it. It offers two choices:

- **Start a new request with {host}** creates a bootstrap grant bound to the host, with the consenting browser's source hash, valid 24 hours until bound.
- **Connect a request I already have** takes the person's booking link. It must name an open request of the same host; the grant is then bound to it at once. The link is used only for this lookup and is never stored with the grant or shown to the agent.

`create_request` (bootstrap grants only) takes `retryKey`, the requester's name, email, timezone and language, and the meeting details the agent already has (purpose, duration, mode, location or link plan, windows). In one transaction, under the grant's row lock: if the grant is bound, it returns the bound request when the retry key matches and refuses otherwise (`already_created`); else it rechecks the host, counts the creation against the source's creation bounds, inserts the request with its booking link and requester discussion exactly as a guest start does, identifies it (which sends the creation email with the booking link to that address), applies the details with the same validation as the details card, and binds the grant. Creation grants no agreement, approval, contact confirmation or Calendar consent.

### 9. User CLI

`cli/` holds the package `@findmeatime/cli` with the command `fmat`, written in TypeScript with Node.js built-ins only and built to `cli/dist/fmat.js` for Node.js 20 or later.

| Command | Does |
|---|---|
| `fmat login --host` / `fmat login --handle <handle>` | Authorization with PKCE as `fmat-cli`: opens the browser on a loopback callback, or with `--no-browser` prints the URL and reads the code shown at `/connect/code`; stores the tokens |
| `fmat status` | The stored connection: origin, resource, scopes, expiry; never a token |
| `fmat tools` | `tools/list` |
| `fmat call <tool> [--input <json> \| --input-file <path>] [--retry-key <key>]` | `tools/call`; mutations get a fresh retry key unless one is given, which is printed so the exact call can be repeated |
| `fmat logout` | Revokes the refresh token and deletes the stored credential |

Every command prints one JSON object on stdout (`ok`, `result` or `error` with `category`, `message` and `nextAction`) and nothing else; diagnostics go to stderr. Exit codes: 0 success, 1 tool error, 2 usage, 3 authorization needed, 4 the outcome is unknown (a lost response: repeat with the printed retry key), 5 service or protocol error. A refresh that fails with `invalid_grant`, or whose response was lost, deletes the stored credential and asks for `fmat login` again (exit 3), never a silent new grant. Credentials live in the macOS Keychain (`security`) or the Linux Secret Service (`secret-tool`); elsewhere `--credential-store file` (or `FMAT_CREDENTIAL_STORE=file`) writes a `0600` file in the user's configuration directory. `FMAT_ORIGIN` points the CLI at another origin, for local runs.

### 10. Connected agents

`/app` gains **Connected agents** in the menu: a dialog listing the host's grants, each with the client name, the redirect host, the permissions in words, when it was connected and last used, and **Revoke**, which asks once before revoking (inline confirmation). The booking page's menu gains the same list for the request's grants. Lists come from `GET /api/agent-grants` (host) and `GET /api/requests/{bookingId}/agent-grants`; revocation is a command (`agent.revoke_grant`) through the pipeline on either surface. Empty lists say how to connect an agent.

### 11. Per-client acceptance

`documentations/technical_specification/09_agent_clients.md` records, per named client and role: how it discovers the instructions (plain URL or explicit `/SKILL.md`), how it connects (remote MCP with metadata document or dynamic registration, or the CLI through a shell), the redirect host it uses, what it does with `host:decide`, and the date, version and result of the last run (D16). Until a run is recorded, each row says "not yet run". The skill documents are written to work for any client that can fetch a URL and, failing that, to send the person to the web continuation.

### 12. Limits and errors

| Bound | Limit |
|---|---|
| Dynamic registration | 10 per source per hour, 500 per day service-wide |
| Authorization requests | 30 per source per hour |
| Token requests | 60 per client per minute |
| Metadata document fetches | 30 per client ID per hour |
| Tool calls | 120 per grant per minute |

A bound past its limit answers `429` (`slow_down` at the token endpoint, a tool error at the MCP endpoint) with `Retry-After`. Protocol errors use the OAuth error codes with a fixed description and `Cache-Control: no-store`; nothing echoes a token, code, verifier or booking link, and logs record the category, the client ID and a correlation ID only.

### 13. Tests

| Layer | Covers |
|---|---|
| Unit (beside modules) | JWT signing and verification (wrong key, issuer, audience, type, expiry, changed claim, `alg: none`); PKCE; redirect matching including loopback ports; scope parsing; the metadata-document address checks; MCP header validation and Base64 sentinels; the entry documents; CLI argument parsing and output |
| Integration (`tests/integration/`) | Discovery documents; registration and its bounds; the authorization request's validation order; consent allow, deny and narrowing for hosts and requesters; the sign-in return; code redemption once, concurrently and replayed; refresh rotation and replay; revocation; every MCP method in both eras; each tool's scope; another host's request; a stale proposal; an identical and a conflicting retry; host decision preparation; bootstrap creation, its exact retry, a second creation and the bound restriction; a closed request; host suspension; the CLI against a local server |
| Database (`supabase/tests/`) | `anon` and `authenticated` reach no new table |
| Browser (`tests/e2e/`) | A host connects a client through consent with sign-in on the way, sees it under **Connected agents** and revokes it; a requester consents to a new request without an account; keyboard use at 390 and 1280 pixels |

## Risks / Trade-offs

- **Named clients differ.** Each client chooses its own discovery, registration and scope behavior, and several still speak the handshake revisions. Mitigation: dual-era endpoint, both registration paths, the explicit `/SKILL.md` fallback, and per-client runs recorded before any compatibility claim.
- **Metadata document fetches.** The authorization server fetches URLs that clients name. Mitigation: public-address checks, no redirects, tight time and size limits, a fetch bound per client ID. DNS can change between the check and the fetch; the risk is a request to an internal address with no credentials and no response shown.
- **Localhost impersonation.** Any program can claim a loopback redirect. Mitigation: the consent page shows the redirect host and warns for local-only clients; codes need the PKCE verifier.
- **A requester's agent creates a request.** An agent could create one request per consent. Mitigation: consent is a person's click in a browser, creation counts toward that browser's source bounds, and the grant binds to one request.
- **The CLI's file store.** Without a keychain the tokens sit in a file. Mitigation: only with an explicit flag, mode `0600`, short-lived access tokens.

## Migration Plan

One declarative sync generates the migration for the six tables. `supabase db reset --local` must rebuild the chain. The shared project receives it through the deploy workflow if its secrets are set, otherwise by `supabase db push --linked` after a shown dry run and only with the user's approval, which this change leaves blocked. Each environment needs its own `AGENT_TOKEN_SIGNING_KEY` before agents can connect; without it the token endpoint reports unavailable configuration and nothing else changes. Rollback: the tables are additive; reverting the deployment leaves existing grants unusable.

## Open Questions

- Teammate review of D1–D16.
- Which registration path and scope behavior each named client uses in practice; the per-client runs answer it.
- Whether a client should be able to step up from `host:read` to `host:write` without a new consent screen; today every step-up is a new consent.

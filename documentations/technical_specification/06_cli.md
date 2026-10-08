# Find Me a Time CLI

The repository CLI supports browser authorization, JSON MCP discovery/calls and logout on macOS/Linux with Node 24 and the repository dependencies installed (`npm ci`). It calls the same protected service as personal-agent MCP clients. Local protocol/workflow tests and [controlled production requester CLI acceptance](05_rebuild_evidence.md#live-requester-cli-acceptance--2026-10-09) pass. Host CLI, complete current-proposal journeys and individual named-client acceptance remain tracked in [the implementation plan](04_implementation_plan.md#phase-8--deliver-skill-entry-mcp-cli-and-named-clients).

## Commands

Run from the repository root. `--silent` keeps npm's banner out of JSON stdout.

```sh
npm run --silent fmat -- --help
npm run --silent fmat -- login host
npm run --silent fmat -- login requester --request REQUEST_UUID
```

Login opens the system browser and waits up to ten minutes on an ephemeral `127.0.0.1` port. Hosts sign in with Google and need admission; requesters use the browser holding their private request access. The requester request hint is optional when the browser can select the intended request. Review the read/write/decision permissions and grant or deny access. Decision permission provides human review, not meeting approval.

Successful login prints a JSON object with `connection` (the grant UUID), `origin`, `actor` and `scope`. Keep that connection ID for later commands. It is an identifier, not a bearer credential.

```sh
npm run --silent fmat -- tools CONNECTION_UUID
npm run --silent fmat -- call CONNECTION_UUID fmat_get_request < request-input.json
npm run --silent fmat -- logout CONNECTION_UUID
```

For `fmat_get_request`, `request-input.json` contains:

```json
{"requestId":"REQUEST_UUID","input":{}}
```

Replace placeholder UUIDs with real values. Discovery returns each tool's current schema; use that schema when constructing other inputs. Mutation tools require an idempotency UUID outside `input`. Keep the same key and identical input after an uncertain reply; changed input needs a new key only after checking current state. Human confirmations and provider consent remain in the protected browser workspace.

The default origin is `https://release.findmeatime.com`. Put an override before the command and use the same origin for that connection every time:

```sh
npm run --silent fmat -- --origin http://localhost:3000 login host
npm run --silent fmat -- --origin http://localhost:3000 tools CONNECTION_UUID
```

HTTPS origins and loopback HTTP origins are accepted. Paths, embedded credentials, query parameters and redirect overrides are rejected. Tokens are never accepted through command arguments or an environment-token fallback.

## Output and limits

Successful commands emit JSON on stdout. Failures emit a sanitized JSON `error` on stderr without raw provider/SDK messages or credentials.

| Exit | Code | Action |
| --- | --- | --- |
| 0 | Success | Inspect the structured result. |
| 2 | `INVALID_INPUT` | Check command syntax, UUIDs and the tool schema. |
| 3 | `LOGIN_REQUIRED` | Start a new browser login for the intended origin/request. |
| 4 | `INSUFFICIENT_SCOPE` | Reconnect and explicitly grant the needed permissions. |
| 5 | `TOOL_FAILED` | Read current state and review the tool input. |
| 6 | `REMOTE_FAILURE` | A dispatched mutation may have completed. Check state and preserve its retry key. |
| 7 | `STORAGE_UNSAFE` | Check ownership/permissions of the private credential directory. The CLI does not silently repair it. |
| 8 | `CONNECTION_BUSY` | Wait for the other command. After a process crash, sign in as a new connection. |
| 9 | `LOGOUT_INCOMPLETE` | Retry logout; local invocation is disabled until revocation is confirmed. |

Tool input is one JSON object, at most 12 KiB, read within five seconds. MCP calls have a 30-second deadline and 512 KiB response bound. OAuth HTTP calls have a 15-second deadline and 32 KiB JSON bound. Redirects do not forward credentials. Tool calls and code/refresh exchanges are not automatically replayed.

## Credential lifecycle and recovery

Credentials live under `~/.config/findmeatime/`, separated by a hash of the origin and the grant UUID. Directories require current-user ownership and mode 0700; files require mode 0600. Symlinks, extra file links, corrupt data and unsafe permissions fail closed. Do not copy these files into the repository or send them to an agent.

Refresh is coordinated across terminal processes. Before dispatch, the connection is durably marked unusable. A verified successful response atomically replaces its credentials. If the reply is lost, sign in again; the old refresh token is never replayed. Review/revoke the old grant in the service's browser permissions screen when needed.

Logout first disables local invocation, then revokes remotely and removes the file. If the network fails, the disabled file remains so an explicit logout retry can complete revocation. A crashed process's lock is never guessed stale or stolen. Use a new login connection and revoke the old grant in the browser rather than manually resuming an uncertain refresh.

The callback listener closes after success, denial, timeout, cancellation or launcher failure. It returns only a generic status page and never displays authorization codes or tokens. `Ctrl-C` cancels a pending login. On systems without a working desktop browser launcher, use the service's browser workflow; headless copy/paste authorization is not implemented.

## Operator tooling

Invitation administration uses the separate server-credential command `npm run --silent invitations --`. It is not an MCP tool or a capability granted to host/requester agent clients. See [host invitation operations](03_provider_setup.md#host-invitation-operations) for issue/status/revoke/recover commands, environment binding and private output. This operator command exits 0 on success or 1 with sanitized JSON on failure; the personal-agent CLI exit-code table above does not apply.

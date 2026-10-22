# CLI Direction

Status: administrator CLI implemented for suspension and restoration; user CLI `fmat` decided in the `agent-access` change

Date: 2026-10-19

The user CLI is `fmat`, decided in the [`agent-access` change](../../openspec/changes/agent-access/design.md#9-user-cli) and described under [User CLI](#user-cli) below. The administrator CLI is described after it.

## Separate authority

| Interface | Audience | Required capabilities and authority |
|---|---|---|
| User CLI | Hosts, requesters and authorized personal agents | Role-scoped onboarding/configuration, request discovery/intake/continuation, availability, negotiation and status through shared domain operations |
| Administrator CLI | Authorized team operators | Environment-bound host suspension and restoration, private diagnostics and permitted audited recovery through distinct operator authority |

The administrator CLI is a separate entry point/authentication boundary, not an elevated mode of the user CLI. A user credential never grants service/database access. Follow [design principles](../03_design_principles.md#3-provide-separate-user-and-administrator-clis).

## User connection and behavior

Protected host access uses resource-bound OAuth with explicit consent, PKCE, current scope checks, refresh and revocation. Requester bootstrap and continuation remain account-free and limited to one permitted request. Public skill discovery grants no credentials. Provider/Calendar tokens remain with the service.

CLI and MCP expose the same domain semantics without separate scheduling state. Structured output identifies operation/resource, revision/proposal where relevant, status, error and next action. Current human approval remains required; return protected review when attributable confirmation cannot be established. Freeze mutation identity across exact retries and give lost token exchange/refresh responses an explicit reauthorization path.

## User CLI

Decided in the [`agent-access` proposal](../../openspec/changes/agent-access/proposal.md#decisions) (D4, D14) on 2026-10-22. The package is `@findmeatime/cli` in `cli/`, with the command `fmat`; it needs Node.js 20 or later and has no dependencies. Publishing it to npm waits for the user; until then run it from a checkout with `npm run fmat -- <command>`. It is a client of the MCP endpoints, so every command reaches the same domain operations as the web and keeps no scheduling state.

| Command | Effect |
|---|---|
| `login --host` or `login --handle <handle>` | Connects as the first-party client `fmat-cli` to the host resource or to one host's requester resource, after the person allows it in the browser. `--no-browser` prints the URL and reads the code shown at `/connect/code` |
| `status` | The stored connection: origin, resource, permissions and expiry, never a token |
| `tools` | The tools the connection's permissions allow |
| `call <tool> [--input <json>] [--input-file <path>] [--retry-key <key>]` | Calls one tool. A mutation without `--retry-key` gets a new key, which the output prints so the exact call can be repeated |
| `logout` | Revokes the connection and deletes the stored credential |

Every command prints one JSON object on stdout, with `ok` and either `result` or `error` (`category`, `message`, `nextAction`). Exit codes: 0 success, 1 tool error, 2 usage, 3 authorization needed, 4 unknown outcome (repeat with the printed retry key), 5 service or protocol error. A lost or refused token refresh deletes the stored credential and asks for `fmat login` again. Credentials go to the macOS Keychain or the Linux Secret Service; elsewhere only `--credential-store file` writes a `0600` file. `FMAT_ORIGIN` points the CLI at another origin, such as `http://localhost:3000`. Windows is untested.

Tests cover login cancellation, wrong resource, expiry, revoked grants, foreign requests, stale proposals and lost responses. Do not advertise old `npm run` commands.

Administrator suspension and restoration commands land with host accounts so operators have abuse control from the first open sign-in.

## Administrator CLI

Decided in the [`host-onboarding` design](../../openspec/changes/host-onboarding/design.md#14-administrator-cli) on 2026-10-19. The CLI is `scripts/admin.ts`, named `fmat-admin` and run as `npm run admin -- <command>` from a checkout; it is not published as a package.

| Command | Effect |
|---|---|
| `show --host <handle-or-id>` | Prints the account's status, handle and readiness |
| `suspend --host <handle-or-id> --reason <text>` | Suspends hosting and the public profile; saved setup is kept |
| `restore --host <handle-or-id> --reason <text>` | Restores the account; the public profile returns if setup is complete |

Every command takes `--operator <name>` and exactly one environment:

- `--local` uses `DATABASE_URL` and refuses any host other than the local stack.
- `--project <ref>` uses the Supabase Management API with the operator's own `SUPABASE_ACCESS_TOKEN`, so operator authority is membership in the Supabase organization that owns the project.

Mutations print the target and need `--yes` or a typed confirmation. Each records the operator, action, host, reason, environment and time beside the status change. No host, requester or agent credential reaches this path. Complete user/MCP parity and separate operator diagnostics/recovery land in later changes. The [PRD acceptance scenarios](../02_product_requirements.md#9-end-to-end-release-acceptance-scenarios) own the evidence that closes them.

# CLI Direction

Status: administrator CLI implemented for suspension and restoration; no executable user CLI

Date: 2026-10-19

No executable user CLI exists yet; its packaging, names, login/storage strategy and concrete commands are specified with their owning future changes. The administrator CLI is described below.

## Separate authority

| Interface | Audience | Required capabilities and authority |
|---|---|---|
| User CLI | Hosts, requesters and authorized personal agents | Role-scoped onboarding/configuration, request discovery/intake/continuation, availability, negotiation and status through shared domain operations |
| Administrator CLI | Authorized team operators | Environment-bound host suspension and restoration, private diagnostics and permitted audited recovery through distinct operator authority |

The administrator CLI is a separate entry point/authentication boundary, not an elevated mode of the user CLI. A user credential never grants service/database access. Follow [design principles](../03_design_principles.md#3-provide-separate-user-and-administrator-clis).

## User connection and behavior

Protected host access uses resource-bound OAuth with explicit consent, PKCE, current scope checks, refresh and revocation. Requester bootstrap and continuation remain account-free and limited to one permitted request. Public skill discovery grants no credentials. Provider/Calendar tokens remain with the service.

CLI and MCP expose the same domain semantics without separate scheduling state. Structured output identifies operation/resource, revision/proposal where relevant, status, error and next action. Current human approval remains required; return protected review when attributable confirmation cannot be established. Freeze mutation identity across exact retries and give lost token exchange/refresh responses an explicit reauthorization path.

## Future command design and acceptance

Define commands only after their domain operation exists; record JSON schemas, errors/exit codes, pagination, headless/interactive login, OS support, secure storage and private output. Test login cancellation, wrong resource, expiry, revoked grants, foreign requests, stale proposals and lost responses. Do not advertise old `npm run` commands.

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

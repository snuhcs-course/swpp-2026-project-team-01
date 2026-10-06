> Historical baseline: application code and executable probes were removed on 2026-10-07. Commands below are not runnable from this checkout; source remains in Git history and the private removal checkpoint.

# Actual Codex CLI OAuth diagnostic probe

This bounded probe uses Codex CLI 0.154.0 against the existing isolated
`fmat-p0-oauth-probe` Auth stack on port 55321 and the loopback MCP server on
port 8788. It grants only identity scopes to the exact synthetic
`p0-oauth-fixture@findmeatime.invalid` account. It never touches production,
personal Google accounts, Calendar, or human messaging recipients.

Start and provision the isolated stack using the [baseline guide](oauth-probe-README.md).
Keep the updated `mcp-probe-server.mjs` running with the isolated publishable
key. Existing browser/terminal baseline files are preserved.

```bash
node scripts/p0/oauth-probe-codex.mjs initialize
node scripts/p0/oauth-probe-codex.mjs start-login
node scripts/p0/oauth-probe-codex.mjs login-status
```

The helper persists a task-unique MCP server name, captures the actual installed
CLI version, and creates a new private mode-0600 log for each login attempt.
The installed CLI requires lowercase `dcr`. Login requests exactly
`openid,email,profile,offline_access`. A live prior login or pending/active
registry conflict blocks a second attempt. Failed captures remain intact.

Use the emitted name and private log path in the next commands:

```bash
node scripts/p0/oauth-probe-native.mjs stage --name NAME --login-log .local/p0-oauth/LOG
node scripts/p0/oauth-probe-hook.mjs allow-native --name NAME
```

Stage validates the exact isolated authorization endpoint, one exact MCP
resource, the loopback callback, identity scopes, and the persisted task name.
The hook verifies that the DCR client exists in the isolated Auth database
before assigning its fixed audience. This prototype still does not enforce
RFC 8707 requested-resource selection and is not production authorization.

Open the authorization URL privately in the controlled browser and sign in
with the existing synthetic fixture credentials. Inspect the identity scopes
and loopback callback, then approve the synthetic probe. Do not print the URL,
codes, state, passwords, or tokens. Chrome may block the final callback receipt
after the CLI receives the code; do not bypass that block. Check `login-status`
for the CLI's actual success instead.

```bash
node scripts/p0/oauth-probe-native.mjs activate --name NAME
node scripts/p0/oauth-probe-codex.mjs exec allowed
node scripts/p0/oauth-probe-codex.mjs evidence allowed
node scripts/p0/oauth-probe-native.mjs revoke --name NAME
node scripts/p0/oauth-probe-codex.mjs exec revoked
node scripts/p0/oauth-probe-codex.mjs evidence revoked
node scripts/p0/oauth-probe-codex.mjs logout
```

Activation verifies the live isolated Auth user, exact issuer/subject/email and
expiry, and exact granted identity scopes before activating the application's
`diagnostic.read` grant. Revocation deletes the OAuth grant, verifies its
absence, and disables the application grant.

Each exec is ephemeral, bounded to 55 seconds, and runs outside repository
ancestry with a read-only shell sandbox and `--ignore-user-config`. Its only
configured MCP server has `enabled_tools=["diagnostic.read"]` and an explicit
per-tool approval for that diagnostic. Global approval policy is preserved.
The tool accurately advertises read-only, non-destructive, idempotent behavior.
The per-tool configuration is documented in the [official Codex configuration
reference](https://learn.chatgpt.com/docs/config-file/config-reference).

Evidence comes from actual structured `mcp_tool_call` JSONL events and checks
the diagnostic issuer, audience, client, fixture subject and application grant.
Model prose is not proof. Started/completed records represent one call.
Approval-policy denial is distinct from application-grant denial; initialization
failure before a tool call is reported with no invented tool event. Preserve
all private captures. Global skill-context-budget warnings were emitted during
the measured runs; the actual completed diagnostic calls remained verifiable.

[Captured native evidence](oauth-probe-native-results-2026-10-05.json) records
one successful diagnostic call and one post-revocation denial, no other completed
tools, credential removal, zero remaining fixture OAuth grants and shutdown of
the isolated stack/server. This first capture predates the separate natural-expiry
refresh measurement below. Full product requester/host roles, production resource
enforcement and browser named-client journeys remain untested. P0 tasks 2.1 and
2.2 stay open.

```bash
node --test scripts/p0/oauth-probe-native.test.mjs
supabase stop --workdir .local/p0-oauth --project-id fmat-p0-oauth-probe
```

Stop only the owned loopback server and isolated stack, preserving volumes and
all other local projects. Do not use `--all` or `--no-backup` for this cleanup.

## Natural-expiry refresh check

Use a fresh task-unique client for this separate measurement. Back up the private
isolated `config.toml`, stop only `fmat-p0-oauth-probe`, set its `auth.jwt_expiry`
to 300 seconds, and restart that isolated stack. Verify its live Auth container
uses `GOTRUE_JWT_EXP=300`. This follows the five-minute minimum recommended by
the [Supabase session guide](https://supabase.com/docs/guides/auth/sessions).
Do not shorten production or normal local-stack sessions.

```bash
node scripts/p0/oauth-probe-codex.mjs initialize --new-run
```

New-run initialization refuses a live previous login or a pending/active client.
It saves the previous run in a private immutable snapshot before creating a
fresh name. Complete the same DCR, identity-only synthetic consent and activation
steps above. Then:

```bash
node scripts/p0/oauth-probe-codex.mjs exec allowed
node scripts/p0/oauth-probe-codex.mjs evidence allowed
node scripts/p0/oauth-probe-refresh.mjs snapshot before
```

Preserve the first exec capture path. The server writes a private per-client
token-observation file only after verifying the signature, issuer, audience,
client, expiry and exact fixture subject. It records token hashes and signed
issue/expiry times, never bearer tokens. Wait past the first observation's actual
`expiresAt`; verify the owned server remains live while waiting. Do not edit
Codex credentials, run another login, refresh this client's token through a
helper, or advance clocks. After natural expiry:

```bash
node scripts/p0/oauth-probe-codex.mjs exec allowed
node scripts/p0/oauth-probe-codex.mjs evidence allowed
node scripts/p0/oauth-probe-refresh.mjs snapshot after
node scripts/p0/oauth-probe-refresh.mjs prove --before BEFORE_FILE --after AFTER_FILE
```

The proof requires exactly two successful diagnostic observations with a newer
verified access token after expiry, the same OAuth session/client/fixture/scopes,
updated session refresh state, and a matching `token_refreshed` audit timestamp.
GoTrue 2.197.0's database-token path rotates a linked parent/child token row while
its session counter remains null. The snapshot verifies that relationship,
revocation and issue times without returning token or parent values. A supported
counter-based path instead requires the counter to advance. Audit entries are
fixture-scoped; the exact OAuth session record independently binds the refresh
to this client. Database timestamps are explicitly normalized to UTC. A new
login, unchanged token, different session, ambiguous or invalid dates, or missing
refresh evidence fails the proof. See the versioned [OAuth handler](https://github.com/supabase/auth/blob/v2.197.0/internal/api/oauthserver/handlers.go)
and [token service](https://github.com/supabase/auth/blob/v2.197.0/internal/tokens/service.go).

Capture both actual MCP calls separately from the refresh proof. Revoke the
fixture's OAuth/application grant, log out the exact task-unique Codex server,
stop the owned server and isolated stack, and restore the backed-up configuration.
If the fixture's browser session has also expired, authenticate only that same
synthetic identity for cleanup after capturing the after-snapshot. Never use a
personal account or another OAuth client to supply evidence.

[Captured natural-expiry evidence](oauth-probe-native-refresh-results-2026-10-05.json)
records two successful actual Codex calls, verified same-session refresh and complete
cleanup. The first verifier failed because it assumed a counter update and parsed
a timezone-less field as local time. Its original captures are preserved; the
corrected verifier uses provider row-rotation evidence and a new UTC-normalized
read-only snapshot. This closes the isolated Codex refresh gap, while P0 tasks
2.1 and 2.2 remain open for their full production/client requirements.

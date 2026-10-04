# Disposable local OAuth/MCP probe

This harness targets one disposable Supabase stack and one synthetic `.invalid`
user. It does not use the repository's normal local stack, remote Supabase
projects, personal accounts, or Calendar data.

## Isolated stack

Use Supabase CLI 2.119.0. Copy only the repository's configuration into a fresh
ignored probe workspace, then edit only the copy. Application migrations,
schemas, runtime secrets and linked-project metadata are not needed:

```sh
mkdir -p .local/p0-oauth/supabase
cp supabase/config.toml .local/p0-oauth/supabase/config.toml
```

Set these values in `.local/p0-oauth/supabase/config.toml`:

```toml
project_id = "fmat-p0-oauth-probe"

[api]
port = 55321

[db]
port = 55322
shadow_port = 55320

[auth]
site_url = "http://127.0.0.1:8788"

[auth.oauth_server]
enabled = true
authorization_url_path = "/oauth/consent"
allow_dynamic_registration = true
```

Start only the services needed by Auth and its gateway/database dependencies,
then write status output to an ignored mode-0600 file without printing keys:

```sh
supabase start --workdir .local/p0-oauth \
  --exclude realtime,storage-api,imgproxy,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
(umask 077; supabase status --workdir .local/p0-oauth -o json > .local/p0-oauth/status.json)
node scripts/p0/oauth-probe.mjs provision-fixture
```

Fixture provisioning requires exactly `http://127.0.0.1:55321` and the dedicated
`p0-oauth-fixture@findmeatime.invalid` identity. The hook helper additionally
requires database port 55322 and the exact Docker database container for project
`fmat-p0-oauth-probe`.

## Default-audience baseline

Start the query-free callback, consent, and MCP server without echoing the
publishable key:

```sh
P0_SUPABASE_PUBLISHABLE_KEY="$(jq -r .PUBLISHABLE_KEY .local/p0-oauth/status.json)" \
  node scripts/p0/mcp-probe-server.mjs
```

In another terminal, create a DCR/PKCE journey. Open only the returned local
authorization URL and approve only the synthetic fixture identity scopes:

```sh
node scripts/p0/oauth-probe.mjs discover
node scripts/p0/oauth-probe.mjs begin --journey terminal
node scripts/p0/oauth-probe.mjs complete --journey terminal
node scripts/p0/mcp-probe-client.mjs --journey terminal --expect-denied
node scripts/p0/oauth-probe.mjs revoke --journey terminal
```

Use `browser` in place of `terminal` for the independent browser baseline, or
open `http://127.0.0.1:8788/client/browser` to start it. Authorization codes are
stored only in ignored mode-0600 files and callbacks redirect immediately to a
query-free receipt URL.

## Fixed client-to-resource hook prototype

Install the disposable SQL only in the guarded isolated database:

```sh
node scripts/p0/oauth-probe-hook.mjs install
```

Add this block only to `.local/p0-oauth/supabase/config.toml` and restart that
isolated stack so Auth loads the hook:

```toml
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/p0_probe/custom_access_token_hook"
```

Begin a fresh journey, map that new DCR client to the one fixed MCP resource,
and then approve the synthetic fixture consent:

```sh
node scripts/p0/oauth-probe.mjs begin --journey terminal
node scripts/p0/oauth-probe-hook.mjs allow --journey terminal
node scripts/p0/oauth-probe.mjs complete --journey terminal
node scripts/p0/mcp-probe-client.mjs --journey terminal
node scripts/p0/oauth-probe.mjs revoke --journey terminal
node scripts/p0/mcp-probe-client.mjs --journey terminal --expect-denied
```

Run the bounded negative suite while the server is running:

```sh
node scripts/p0/oauth-probe-negatives.mjs
```

The negative suite uses actual signed fixture tokens to check a regular token's
wrong audience, an unallowlisted OAuth client, client mismatch, and application
grant denial. It also proves the trust boundary: this hook is a fixed
client-to-audience mapping. It does not enforce the OAuth `resource` request,
because the hook event does not expose that parameter. A mapped client that asks
for a different resource still receives the allowlisted MCP audience; application
authorization must remain separate.

On a successful run, negative journey metadata is saved privately as
`.local/p0-oauth/oauth-negative-unallowlisted.json` and
`.local/p0-oauth/oauth-negative-wrong-resource.json`; the completed browser and
terminal journey files are restored so their post-revocation denial state stays
available for read-only verification.

Stop only the disposable stack when finished. Preserve its volumes when evidence
needs to remain available:

```sh
supabase stop --workdir .local/p0-oauth
```

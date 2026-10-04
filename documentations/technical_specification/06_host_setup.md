# Host admission and Google Calendar setup

Date: 2026-10-05. This guide covers P2 operator invitations, verified host setup, and browser-bound Calendar consent. Requesters remain account-free. See [implementation plan](04_implementation_plan.md), [compatibility evidence](05_compatibility_report.md), and [backend architecture](01_backend_architecture.md).

## Operator invitations

Run [manage-invitations.mjs](../../scripts/manage-invitations.mjs) only from a trusted operator environment. It calls the service-only `public.fmat_command` RPC; public, anon, and ordinary authenticated clients cannot invoke that boundary. The mandatory `--operator-id` identifies the operator in the audit record. It is an audit identity supplied by the trusted privileged operator, not a public authorization credential.

For remote administration, load the ignored root `.env` with `SUPABASE_PROJECT_REF`, its exact `https://<reference>.supabase.co` origin, and a server-only `SUPABASE_SECRET_KEY` or legacy `SUPABASE_SERVICE_ROLE_KEY`. Pass the intended reference explicitly; it must match both environment configuration and `supabase/.temp/project-ref`. The command rejects publishable/anon/user keys and mismatched hosts or link caches before making an RPC. Keep these keys out of browser configuration and terminal history. [Supabase API key privileges](https://supabase.com/docs/guides/getting-started/api-keys).

```sh
node --env-file=.env scripts/manage-invitations.mjs issue \
  --project-ref <linked-reference> --operator-id <operator-identity> \
  --email <recipient-email> --app-origin https://findmeatime.com

node --env-file=.env scripts/manage-invitations.mjs revoke \
  --project-ref <linked-reference> --operator-id <operator-identity> \
  --invitation-id <issued-invitation-uuid>
```

Issue generates a 256-bit random token and sends only its SHA-256 hash to the database. The RPC binds it to the normalized recipient email and expires it within seven days; the CLI leaves one minute of clock-skew margin. Successful issue prints the invitation UUID, recipient, expiry, one-time token, and `/host/setup` URL. The URL intentionally omits the token; the recipient pastes it into setup after verified sign-in. The tool writes no secret files and sends no invitation message. Keep its output private and deliver the credential only through a separately authorized operator process.

The recipient must sign in with the same verified email. Redemption atomically consumes the invitation and admits that account. Same-account retries return saved admission. Wrong recipients, expired/revoked tokens, and reuse by another account fail. Revocation blocks further redemption; it does not revoke an already admitted host. Host access revocation is a separate administrative operation.

The CLI does not automatically repeat an uncertain RPC. If a response is lost, inspect the operator audit and invitation records before issuing another token. A new issue command intentionally creates a new invitation.

## Controlled local setup

Use Supabase CLI **2.119.0** and the disposable local database. Local operator mode obtains the local origin/key from `supabase status -o json` internally; it never uses remote `.env` credentials.

```sh
supabase --version
supabase start
node scripts/manage-invitations.mjs issue --local \
  --operator-id local-controlled-test --email host@example.test
```

Use `http://localhost:5173` consistently for the app and consent callbacks. Mixing `localhost` and `127.0.0.1` changes cookie ownership. The Vite `/api` proxy targets the local API on port 54321; omit `VITE_API_ORIGIN` so browser API calls stay on the app origin.

Put these settings in ignored local environment files, using actual local values from Supabase status:

| File | Settings |
|---|---|
| `apps/web/.env.local` | `VITE_SUPABASE_URL=http://127.0.0.1:54321`, local `VITE_SUPABASE_PUBLISHABLE_KEY`; no privileged key |
| Root `.env.local` for functions | `APP_ORIGIN=http://localhost:5173`, local `FMAT_SUPABASE_SECRET_KEY`, persisted `WORKER_SECRET`, persisted `TOKEN_ENCRYPTION_KEY`, controlled Google client credentials, `EXTERNAL_SENDS_ENABLED=false` |

Supabase injects local `SUPABASE_URL` into served functions. The explicit local `FMAT_SUPABASE_SECRET_KEY` prevents accidentally choosing a remote privileged key. `WORKER_SECRET` requires at least 32 characters. `TOKEN_ENCRYPTION_KEY` is base64 for exactly 32 cryptographically random bytes. Generate each once, preserve it in ignored secret storage, and reuse it on subsequent runs. Do not generate a new encryption key on restart or deployment: previously stored grants would become unreadable. Key rotation requires an explicit migration of encrypted credentials.

```sh
supabase functions serve --env-file .env.local --no-verify-jwt
npm run dev --workspace apps/web -- --host localhost --port 5173 --strictPort
```

Allow the actual host Auth return URL `http://localhost:5173/host` in the local Supabase Auth redirect configuration. Read the controlled magic link from local Mailpit, then paste the invitation in `/host/setup`. This local sign-in is distinct from Google Calendar authorization. A local test recipient cannot complete Google consent unless it is an actual controlled Google test identity allowed by that OAuth project.

Complete confirmed rules/timezone, connect Calendar, select conflict calendars, and choose a currently writable booking destination. An admitted but incomplete host remains unpublished. A read-only calendar is not a booking destination, and reconnecting requires reconfirming selections.

To revoke a local invitation:

```sh
node scripts/manage-invitations.mjs revoke --local \
  --operator-id local-controlled-test --invitation-id <issued-invitation-uuid>
```

## Same-origin Calendar consent

The production Google redirect URI is **`https://findmeatime.com/api/google/callback`**. The local controlled URI is **`http://localhost:5173/api/google/callback`**. Register exact URLs on the intended Google OAuth web client. Set the deployed `APP_ORIGIN=https://findmeatime.com`; Supabase Auth host-sign-in returns must also allow `https://findmeatime.com/host`.

Browser consent starts through same-origin `/api`. Production Vercel rewrites that prefix to Supabase, and local Vite proxies it; responses retain the app-origin binding cookie. The ten-minute cookie is HttpOnly, SameSite=Lax, scoped to `/api/google/callback`, and Secure in production. State is single-use, expires, and is bound to the initiating browser plus host or protected request. Calling the Supabase function origin directly from the browser would place the cookie on the wrong origin and break callback binding.

Current grants are distinct:

| Principal | Requested Google scopes | Authority |
|---|---|---|
| Host | `openid`, `email`, `calendar.readonly`, `calendar.events` | Read selected host context and create events only through the selected writable booking calendar after current agreement/approval |
| Requester | `openid`, `email`, `calendar.freebusy` | Availability for one authorized request; no host admission, host context, or event creation |

Calendar scope names above use the `https://www.googleapis.com/auth/` prefix. Requester `calendar.freebusy` supplies availability on the requester's own calendar and is accepted by Google's free/busy query API. Validate the exact granted scope during live consent. [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [free/busy query scopes](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query).

Offline consent supplies encrypted refresh credentials stored only server-side. A missing/expired refresh token, `invalid_grant`, revoked consent, or failed required read produces a reconnection action; none become an empty calendar. Optional requester denial still permits explicit manual availability. Calendar consent grants neither requester agreement nor host approval.

Google OAuth apps configured as External/Testing generally receive seven-day refresh-token lifetimes for Calendar scopes. Inspect publishing/verification status before claiming production continuity, and demonstrate actual consent and refresh with controlled identities. A credential inventory or fixture test cannot prove this. [Google OAuth web flow](https://developers.google.com/identity/protocols/oauth2/web-server), [refresh-token expiration](https://developers.google.com/identity/protocols/oauth2).

## Verification evidence

On 2026-10-05, the CLI was exercised against the running local Supabase API and real `fmat_command` RPC. A controlled verified local Auth identity redeemed its email-bound invitation and repeated redemption successfully. The stored token hash matched the generated token's SHA-256, expiry was within seven days, and `issued_by` matched the explicit operator. Wrong-recipient redemption failed; revoke succeeded; subsequent redemption failed. No messages were sent. Syntax/help, missing operator, wrong remote reference, publishable key, and legacy anon-key rejection were checked.

This does not prove a deployed remote issue/revoke call, human Google consent/refresh, M1 end-to-end readiness, or P5/P6 integration. Those require their own current deployment evidence.

Production Google callbacks were subsequently saved and re-read in the intended client console: the exact production and localhost5173 callbacks above are registered, preserving the original Supabase Auth callback. This proves registration, not human consent or Calendar reads.

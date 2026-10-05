# Host admission and Google Calendar setup

Date: 2026-10-05. This guide covers P2 operator invitations, verified host setup, and browser-bound Calendar consent. Requesters remain account-free. See [implementation plan](04_implementation_plan.md), [compatibility evidence](05_compatibility_report.md), and [backend architecture](01_backend_architecture.md).

## Operator invitations

Run [manage-invitations.mjs](../../scripts/manage-invitations.mjs) only from a trusted operator environment. It calls the service-only `public.fmat_command` RPC; public, anon, and ordinary authenticated clients cannot invoke that boundary. The mandatory `--operator-id` identifies the operator in the audit record. It is an audit identity supplied by the trusted privileged operator, not a public authorization credential.

Use Node.js 24 or later; the CLI shares the runtime's TypeScript Cloudflare adapter through native type stripping. For remote administration, load the ignored root `.env` with `SUPABASE_PROJECT_REF`, its exact `https://<reference>.supabase.co` origin, and a server-only `SUPABASE_SECRET_KEY` or legacy `SUPABASE_SERVICE_ROLE_KEY`. Pass the intended reference explicitly; it must match both environment configuration and `supabase/.temp/project-ref`. The command rejects publishable/anon/user keys and mismatched hosts or link caches before making an RPC. Keep these keys out of browser configuration and terminal history. [Supabase API key privileges](https://supabase.com/docs/guides/getting-started/api-keys).

Remote issue sends through Cloudflare by default. Configure `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`, and `CLOUDFLARE_EMAIL_FROM=no-reply@findmeatime.com` as described in [provider setup](03_provider_setup.md). Missing or invalid sender configuration fails before invitation creation. Add `--no-email` to remote issue only when explicitly choosing manual delivery. Local issue and all revocations never send email.

```sh
node --env-file=.env scripts/manage-invitations.mjs issue \
  --project-ref <linked-reference> --operator-id <operator-identity> \
  --email <recipient-email> --app-origin https://findmeatime.com

node --env-file=.env scripts/manage-invitations.mjs revoke \
  --project-ref <linked-reference> --operator-id <operator-identity> \
  --invitation-id <issued-invitation-uuid>
```

Issue generates a 16-character invitation code from 80 random bits, formatted as `XXXX-XXXX-XXXX-XXXX`, and sends only its SHA-256 hash to the database. The RPC binds it to the normalized recipient email and expires it within seven days; the CLI leaves one minute of clock-skew margin. After confirmed remote issuance, Cloudflare receives one message containing the code, expiry, `/host/setup` URL, and instructions to sign in with the same verified email. The URL intentionally omits the code; the recipient enters it in setup after verified sign-in. Redemption accepts lowercase or space-separated entry and treats `O` as `0` and `I`/`L` as `1` before hashing. Previously issued long tokens remain redeemable during rollout.

Issue prints the invitation UUID, recipient, expiry, one-time `code`, setup URL, and `emailDelivery` result. Keep this output private. Before a send, the CLI writes the credential, frozen message, sender, and dispatch intent to ignored `.local/invitations/<invitation-id>.json` with file mode `0600` inside a `0700` directory. These receipts contain live credentials and must not be committed or shared as diagnostics. `sent` means provider acceptance with a message reference, not inbox arrival or redemption. `rejected`, `uncertain`, and `not-sent` exit unsuccessfully while retaining the issued credential in output for recovery; `manual` indicates a send-free operation.

The recipient must sign in with the same verified email. Redemption atomically consumes the invitation and admits that account. Same-account retries return saved admission. Wrong recipients, expired/revoked codes, and reuse by another account fail. Revocation blocks further redemption; it does not revoke an already admitted host. Host access revocation is a separate administrative operation.

The CLI does not automatically repeat an uncertain RPC or email send. If a response is lost, inspect the operator audit, invitation records, private receipt, and provider activity before taking further action. Email failure does not revoke or reissue the invitation. A new issue command intentionally creates a new invitation; it is not a resend command.

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

Host sign-in and Calendar consent are separate steps. The current Calendar scope sets are defined in [the Google provider](../../supabase/functions/_shared/providers/google.ts):

| Principal | Requested Google scopes | Authority |
|---|---|---|
| Host | `openid`, `email`, `calendar.readonly`, `calendar.events` | Read selected host context and create events only through the selected writable booking calendar after current agreement/approval |
| Requester | `openid`, `email`, `calendar.freebusy` | Availability for one authorized request; no host admission, host context, or event creation |

Calendar scope names above use the `https://www.googleapis.com/auth/` prefix. Requester `calendar.freebusy` supplies availability on the requester's own calendar and is accepted by Google's free/busy query API. Validate the exact granted scope during live consent. [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [free/busy query scopes](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query).

In the Google console scope picker, email-address access appears as `https://www.googleapis.com/auth/userinfo.email`. The authorization request can use the OpenID Connect scope `email`, as the current code does. This identifies the account's email address; mailbox contents require separate Gmail scopes. `openid` identifies the Google account. [Google scope catalog](https://developers.google.com/identity/protocols/oauth2/scopes), [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

The host's `calendar.readonly` scope permits calendar and event reads; `calendar.events` permits event reads and writes, including modifications beyond creating a meeting. The application enforces the selected booking calendar and current agreement/approval checks. Those restrictions are application policy, not a creation-only Google permission. The broader `calendar` scope is not requested.

Offline consent uses `access_type=offline` and `prompt=consent` in [the consent builder](../../supabase/functions/_shared/modules/onboarding/oauth.ts); these are request parameters, not additional scopes. Refresh credentials are encrypted and stored only server-side. A missing/expired refresh token, `invalid_grant`, revoked consent, or failed required read produces a reconnection action; none become an empty calendar. Optional requester denial still permits explicit manual availability. Calendar consent grants neither requester agreement nor host approval.

Google OAuth apps configured as External/Testing generally receive seven-day refresh-token lifetimes for Calendar scopes. Inspect publishing/verification status before claiming production continuity, and demonstrate actual consent and refresh with controlled identities. A credential inventory or fixture test cannot prove this. [Google OAuth web flow](https://developers.google.com/identity/protocols/oauth2/web-server), [refresh-token expiration](https://developers.google.com/identity/protocols/oauth2).

### Requester event details and travel: proposed extension

The 2026-10-05 discussion identified requester travel as a reason to extend availability-only access: a free interval does not establish that the requester can travel from the preceding event to the proposed meeting and then to the next event. The current [PRD travel requirements](../02_product_requirements.md#travel-time-checks) limit travel evaluation to the host and explicitly exclude requester event locations. Requester travel remains a proposed behavior change; update the owning requirements through OpenSpec before implementing it.

For optional requester travel evaluation, the proposed grant is `openid`, `email`, `https://www.googleapis.com/auth/calendar.events.readonly`, and `https://www.googleapis.com/auth/calendar.calendarlist.readonly`. Event reads provide the neighboring times and locations; calendar-list reads let the requester select calendars. Retrieve only the fields needed for evaluation, keep private event context out of host and agent responses, and ask the requester for missing or ambiguous location information. Titles, descriptions, and attendee lists are not required merely to calculate travel. Preserve manual availability and an availability-only path for requesters who decline detail access.

This requires an event-reading and travel-evaluation implementation, consent handling, and tests. Changing only the scope list does not update the current requester free/busy reader. These proposed scopes have not replaced the implemented requester grant above. Scope definitions: [Google Calendar authorization](https://developers.google.com/workspace/calendar/api/auth).

### Gmail message contents: separate optional integration

Access to a user's existing Gmail mailbox would require separate scopes:

| Function | Google scope |
|---|---|
| Read message bodies and threads | `https://www.googleapis.com/auth/gmail.readonly` |
| Send or reply from the user's Gmail account | `https://www.googleapis.com/auth/gmail.send` |

Reading and replying requires both scopes. `gmail.metadata` does not provide message bodies. Google classifies `gmail.readonly` as restricted and `gmail.send` as sensitive; public deployment must satisfy the applicable OAuth verification requirements, including a security assessment when restricted data is stored or transmitted through servers. [Gmail scope definitions and verification](https://developers.google.com/workspace/gmail/api/auth/scopes).

The current service email design uses provider-managed inboxes, documented in [provider setup](03_provider_setup.md) and [the technical specification](../03_technical_specification.md). It does not require access to users' Gmail mailboxes. Gmail scopes were discussed as an optional extension; no Gmail consent flow or mailbox integration was implemented in this update.

## Verification evidence

On 2026-10-05, invitation delivery was extended to Cloudflare using `no-reply@findmeatime.com`. Automated tests cover one confirmed send with a private receipt already saved, manual/local/revoke exclusions, missing sender configuration before issuance, rejected issuance, lost and suppressed send outcomes, and receipt-write failures. `npm run check` passed typechecking, lint, 113 Deno tests, 11 Node tests, and the production build. The root-domain DNS, SMTP sender acceptance without message submission, Auth settings, and deployed runtime sender were verified separately in [provider setup](03_provider_setup.md). No live invitation or Auth email was sent during this migration, so inbox delivery remains unverified.

On 2026-10-05, the operator reported completing Google OAuth scope configuration after the Calendar and Gmail scope discussion. This records user-reported console setup completion. The exact saved scope list was not independently re-read, and app verification, end-user consent, token refresh, and live Calendar/Gmail API access remain unverified by this report. Console configuration alone does not change the scopes requested by the application.

On 2026-10-05, the CLI was exercised against the running local Supabase API and real `fmat_command` RPC. A controlled verified local Auth identity redeemed its email-bound invitation and repeated redemption successfully. The stored token hash matched the generated token's SHA-256, expiry was within seven days, and `issued_by` matched the explicit operator. Wrong-recipient redemption failed; revoke succeeded; subsequent redemption failed. No messages were sent. Syntax/help, missing operator, wrong remote reference, publishable key, and legacy anon-key rejection were checked.

These local checks do not prove human Google consent/refresh, M1 end-to-end readiness, or P5/P6 integration. Those require their own current deployment evidence.

A subsequent operator-issued invitation for the user-designated controlled host succeeded against the linked production RPC. A separate read-only database check verified exactly one matching invitation, recipient binding, the SHA-256 of the privately saved token, the operator audit identity, an unused/unrevoked state, and an expiry within seven days. [Sanitized production issue evidence](../../scripts/p0/host-invitation-live-results-2026-10-05.json) contains only verification booleans and no recipient, invitation identifier, or token. The token remains in ignored private storage; no invitation message was sent. Production revocation, host redemption, and Calendar consent remain unverified; the M1 gate stays open.

Production Google callbacks were subsequently saved and re-read in the intended client console: the exact production and localhost5173 callbacks above are registered, preserving the original Supabase Auth callback. This proves registration, not human consent or Calendar reads.

## Conversational setup

The primary `/host/setup` surface is a durable website conversation built with the official AI Elements Conversation, Message, PromptInput and Suggestion components, adapted to the existing Base UI shadcn preset `b6rtA2Hmi`. Authenticated, admitted hosts can describe scheduling preferences, inspect current settings and a concrete review artifact, then explicitly save it from the conversation. The structured controls remain available in a secondary settings surface for precise calendar choices and model failures. Signing in and redeeming an invitation precede private chat access; Google consent still opens in the browser.

The host workspace has no persistent sidebar. Its compact menu opens the setup conversation, meeting inbox, and sign-out. Setup progress and the next action stay inside the scrollable transcript; the settings icon opens the exact-value editor. The transcript height is bounded at phone widths to keep the message composer reachable without scrolling the whole page.

One private host conversation owns the transcript, conversation revision, draft revision and settings review. Reloading or returning from consent reads that state from the server. Text interpretation updates a draft only; it cannot approve a meeting or create an event. Incomplete or ambiguous settings produce a question. Unsupported rules and model failures leave saved rules unchanged. Sensitive credentials, linking proofs and URL fragments are filtered from transcripts and model input. Calendar choices use actual authorized calendar IDs, and duplicate names or insufficient write permission require the protected website controls.

Choose **Confirm and save proposed settings** on the current review. A different chat turn or saved rules version invalidates that review, including a turn received on the other channel. Readiness still requires admission, confirmed rules, an active Google grant, selected conflict calendars and a writable booking destination. Shareable links appear only after those checks pass.

### Private iMessage linking and recovery

Website chat remains available while the Photon bridge is disabled. Its enabled flag defaults false; credentials alone do not enable it. When the persistent runtime is operational, **Link iMessage** creates a short-lived challenge in the authenticated browser. The host sends the displayed `LINK` instruction in a private iMessage conversation, returns to the website, checks the masked sender and explicitly confirms the binding. Sending the instruction alone does not opt in. Challenges expire, are single-use, and cannot bind another browser account, sender or group conversation.

An unlinked sender can instead start in iMessage and receive a short-lived browser continuation. After browser authentication and admission, a fresh challenge must be sent from that same private sender and confirmed in the browser. The continuation does not grant private data access, and long-lived credentials are never put in a URL.

Linked hosts resume the same draft and transcript in either channel. In iMessage, `CONFIRM` followed by the exact current review number saves that review; a plain “yes” does not. Google consent and protected calendar selection continue in the authenticated website. **Unlink iMessage** revokes the binding and blocks future private processing or dispatch; relinking requires new proofs. Unknown delivery outcomes remain uncertain and are never blindly resent.

See the [bridge runtime and new-server deployment guide](../../apps/photon-bridge/README.md) and [pending capability change](../../openspec/changes/conversational-host-setup/proposal.md). Fly CLI `0.4.111` is authenticated and one 512 MB Machine runs in Tokyo. Configuration, secret injection, restart recovery and readiness checks are recorded in the [live deployment evidence](../../scripts/p0/fly-bridge-live-results-2026-10-05.json). Production linked-host onboarding remains pending; the website can fall back when the bridge is unavailable.

## Real host setup evidence (2026-10-05)

The controlled host completed invitation redemption, browser-bound Google consent, actual authorized calendar listing, calendar selection and confirmed rules. The authenticated browser showed all five setup steps complete and the public booking profile returned ready. A read-only production query verified recipient-bound redemption, the saved OAuth exchange, encrypted active host credentials, required host scopes and selected calendars without exposing tokens or calendar content. [Sanitized M1 evidence](../../scripts/p0/host-setup-live-results-2026-10-05.json). A later controlled requester completed browser Google free/busy consent and agreed to the exact second proposal in the live request; host approval and event creation had not occurred at that checkpoint. Natural-expiry refresh and disconnect/reconnect remain separate unchecked gates.

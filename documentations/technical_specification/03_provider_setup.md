# Provider setup

Configure the rebuild for the [implementation plan](04_implementation_plan.md). This document owns credentials, deployment origins and provider setup; capability specs own behavior, and the plan owns integration acceptance gates. The initial eve/web runtime is deployed; scheduling and provider integrations remain under implementation.

Keep credentials in the ignored root `.env` with file mode `0600`. Share names through [`.env.example`](../../.env.example), never values. Provision deployment secrets separately; local environment files do not configure remote services. Keep server and operator credentials out of browser bundles, model context and logs.

## Reconstruction deployment origin

Use **`https://release.findmeatime.com`** with Supabase project **`mriseqztcwmezvtawnbo`**. Domain attachment, DNS, callbacks and HTTPS readiness require deployment verification.

Runtime deployment verified on 2026-10-07: Vercel team `justdodos-projects`, project `findmeatime-release` (`prj_eCihziUF85AHPkfnFCNhBtdYlfnk`), Node 24. The main checkout is linked to this release project. Root-domain hosting remains in the existing `findmeatime` project. Production config includes `APP_ORIGIN=https://release.findmeatime.com`, `OPENAI_MODEL=gpt-6-luna`, the selected Supabase URL/keys and the server-only OpenAI key. Google client credentials and the preserved token-encryption key are now configured as production-only secrets. Other provider credentials and callbacks must be configured as their protected adapters land. Local development uses `APP_ORIGIN=http://localhost:3000`.

Cloudflare serves the DNS-only `A release.findmeatime.com 76.76.21.21` record requested by Vercel's inspection on that date. All 13 preexisting DNS records were preserved, including mail records; Cloudflare nameservers remain authoritative. HTTPS `/`, `/api/health` and `/eve/v1/health` return 200, and anonymous session creation returns 401. The app health response deliberately reports `releaseReady: false`.

Deploy from the linked repository root with `vercel deploy --prod --scope justdodos-projects`; inspect the project first. `vercel.ts` composes independently built web/eve services. `.vercelignore` excludes credentials and generated local state; inspect uploads with `vercel deploy --prod --dry --json` before changing that boundary. See the [evidence ledger](05_rebuild_evidence.md) for current limitations.

- Attach the subdomain to the intended Vercel project. Obtain exact DNS requirements with `vercel domains inspect release.findmeatime.com`, then apply DNS-only records through Cloudflare. Preserve root-domain, mail and unrelated records.
- Set the application origin and Supabase Auth Site URL to the release origin. Allow `https://release.findmeatime.com/auth/callback` as the application return; the provider-side Supabase Auth callback is a separate URL belonging to the selected project.
- Register direct Calendar consent at `https://release.findmeatime.com/connections/google/callback` and the approved local counterpart.
- Generate invitations, public booking links, private `/booking/[bookingId]` continuations and public skill links from the configured origin.
- Register webhooks against the verified deployed receiver. The native eve Photon route, if selected by the runtime spike, is `/eve/v1/photon`; the AgentMail route is `/api/providers/agentmail` (disabled until registry/consumer readiness). Identify and fence existing consumers before changing delivery routing.
- Keep the transactional sender `no-reply@findmeatime.com`; the web subdomain does not change the email sender domain.

Verify DNS, TLS, the expected deployment, Auth/Calendar returns, generated links and signed webhook delivery. See [domain operations](../../AGENTS.md#domain-and-dns).

## Selected rebuild Supabase project

Use **FindMeATime2**, project **`mriseqztcwmezvtawnbo`**: [project dashboard](https://supabase.com/dashboard/project/mriseqztcwmezvtawnbo). The CLI link was restored and matched against `SUPABASE_PROJECT_REF` and `SUPABASE_URL` on 2026-10-07. The initially empty project now has all twenty-five migrations through `20261007003213_calendar_model_projection`. A subsequent dry run reports no pending migrations, and the remote security advisor reports no issues. Reconfirm the target before each remote operation.

Verify schema, Auth, SMTP and provider configuration against this project independently. Follow the [schema workflow](../../AGENTS.md#supabase-schema-changes), review migration SQL and run `supabase db push --dry-run` before a remote push. Never reset a remote database for local setup.

## Messaging environment isolation

The [preview messaging change](../../openspec/changes/archive/2026-10-09-fence-preview-messaging/tasks.md) adds a server-side deployment check before application delivery claims and provider calls. Cloudflare invitation/contact/recovery/booking workers, Photon code/reply dispatchers and AgentMail replies reject Vercel preview, development and custom environments with sanitized `CONFIGURATION_UNAVAILABLE` responses, even when provider credentials are present. Direct transport calls enforce the same check. Rejection preserves delivery records and does not establish failure, uncertainty or successful delivery.

Keep [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables) enabled. When any Vercel marker is present, messaging requires exact `VERCEL_ENV=production` and, if supplied, `VERCEL_TARGET_ENV=production`; missing, empty or contradictory metadata fails closed. There is no preview-send override. Do not manually set these markers to impersonate production. Standalone processes without Vercel markers retain existing behavior for local fixtures and explicitly authorized operator work.

Continue using separate local, preview and production databases and credential scopes. Keep production provider secrets and dispatch Vault entries out of previews. This application messaging guard does not isolate database access, Calendar writes, model calls or Supabase-managed SMTP. Disabling every system marker removes deployment identification; configuration verification must confirm system variables remain enabled. The guard is deployed from source `e892779`; [deployment evidence](05_rebuild_evidence.md#deployed-preview-messaging-guard--2026-10-09) records built preview denial, enabled system variables and production HTTP verification.

## Development skills and CLIs

Use Node.js 24 and npm 11. The repository pins Supabase CLI **2.119.0** and OpenSpec CLI **1.14.0**; verify installed versions before schema or specification work. Read the relevant [project skills](../../AGENTS.md#shared-skills), including the [Photon skill](../../.agents/skills/photon-cli/SKILL.md) and [AgentMail skill](../../.agents/skills/agentmail-cli/SKILL.md).

Check each CLI's help before provider operations. Provider CLIs do not automatically load this repository's `.env`; load only the required variables. Separate operator credentials used for provisioning from narrowly scoped application credentials.

## OpenAI model access through eve

Use eve's direct OpenAI provider, `openai(...)` from `eve/models/openai`, with server-side `OPENAI_API_KEY` and an explicit `OPENAI_MODEL`. The initial verified model is `gpt-6-luna`; `npm run verify:model` checks a synthetic structured tool call through the installed eve provider. Direct API calls use the intended OpenAI API organization's billing and applicable credits; ChatGPT/Codex subscription usage does not fund this API-key path.

A Gateway model string is a different routing choice. Verify direct provider routing, secret loading, model access and handling of authentication, rate-limit and exhausted-credit errors before claiming readiness. Failed model operations must not record scheduling success or approval. See [eve model configuration](https://github.com/vercel/eve/blob/d97f2a689299f7de74227b77450359c571a02dc9/docs/agent-config.md#L20-L48) and [OpenAI spend limits](https://developers.openai.com/api/docs/guides/spend-limits).

## Cloudflare Email Service

**Cloudflare Email Service is the selected transactional email provider** for host invitations, contact verification, recovery and booking confirmations. Retained custom SMTP supports applicable Supabase Auth notifications; Google-only MVP login does not send sign-in emails. Runtime configuration uses `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN` and `CLOUDFLARE_EMAIL_FROM=no-reply@findmeatime.com`. Scope the token to Email Sending in the intended account and verify the sending domain's required DNS records.

Supabase Auth SMTP uses `smtp.mx.cloudflare.net`, port `465`, implicit TLS, username `api_token` and the Email Sending token as password. The retained configuration tool supports a redacted preview and explicit application:

```sh
node --env-file=.env scripts/configure-email-smtp.mjs
node --env-file=.env scripts/configure-email-smtp.mjs --apply
```

The tool requires matching project reference, URL and CLI link. Apply mode also requires operator-only `SUPABASE_ACCESS_TOKEN`, rejects an overriding Send Email Auth Hook and verifies settings by readback. Configuration readback does not prove inbox delivery; verify controlled transactional messages through the deployed application. Google login requires its own browser acceptance.

On 2026-10-07, the selected project's Auth Site URL, release/local `/auth/callback` allowlist and Cloudflare SMTP were configured through authenticated Supabase CLI 2.119.0. A sparse config in an ignored work directory declared only `[auth].site_url`, `additional_redirect_urls` and `[auth.email.smtp]`; the SMTP password references `env(CLOUDFLARE_EMAIL_API_TOKEN)`. `supabase config diff --workdir <sparse-workdir> --project-ref mriseqztcwmezvtawnbo --output-format json` previews declared changes, and `supabase config push` with the same target/workdir applies them. Load the token into that process environment without printing it. CLI authentication can use its existing login; the repository SMTP script separately requires a Management API token.

Inspect the diff before pushing: undeclared remote-only settings must remain untouched, including Google Auth and MFA. Do not push the full local-development config to production. Readback found no declared differences; this confirms callback/SMTP configuration, while controlled production transactional inbox delivery remains unverified. Local provider fixtures do not establish Cloudflare delivery.

References: [Cloudflare Email Service](https://developers.cloudflare.com/email-service/), [Cloudflare SMTP](https://developers.cloudflare.com/email-service/api/send-emails/smtp/), [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## AgentMail

AgentMail owns requester conversational inboxes and threads. Configure `AGENTMAIL_API_KEY`, `AGENTMAIL_POD_ID` and `AGENTMAIL_INBOX_ID` for the intended application resources. Use narrowly scoped `inbox_read`, `message_read` and `message_send` permissions; reserve provisioning and webhook administration for operator credentials.

Store the receiver signing secret as `AGENTMAIL_WEBHOOK_SECRET`; it is distinct from the API key. Verify signed ingestion, sender binding, request/thread mapping, deduplication, replies and uncertain-send recovery under the [compatibility gates](04_implementation_plan.md#compatibility-gates).

Inspection on 2026-10-07 with installed CLI 1.9.0 confirms that the configured development inbox is readable. The configured runtime key cannot list webhooks (`403 missing_permission`, missing `webhook_read`). Use an appropriately scoped operator credential to establish consumer ownership and webhook configuration; do not broaden the runtime key or send private Auth links into an inbox whose consumers are unverified.

References: [AgentMail quickstart](https://docs.agentmail.to/quickstart), [webhook verification](https://www.agentmail.to/docs/webhook-verification).

## Photon

Configure `PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET` for the intended project. These local names map to the SDK's `projectId` and `projectSecret`. The application-owned receiver is `POST /api/providers/photon`, using server-only `PHOTON_WEBHOOK_ID` and `IMESSAGE_WEBHOOK_SECRET`. The corresponding project/receiver must also be enabled in private `fmat.photon_receivers`; an absent, disabled or mismatched registry returns 503 and stores nothing.

The installed eve 0.71.3 native-adapter spike (`tests/providers/photon-native.test.ts`) verifies its signature path but observes HTTP 200 before downstream processing completes. A downstream rejection cannot change that already-returned HTTP 200. Its send API also supplies no application-owned retry identity. The installed low-level SDK 2.2.0 is separately checked against a loopback gRPC server using its shipped protobuf definitions: the frozen message ID reaches the wire, retryable failures dispatch once, and reconciliation reads the exact provider reference. Use the application receiver and durable domain work before dispatching to eve, with a separate application-owned outbound intent. A separate process is not currently justified. Recheck these observations when upgrading eve.

The receiver bounds the body to 32 KiB and a five-second read deadline, rejects malformed declared lengths/invalid UTF-8, and stops on caller cancellation without waiting for a stalled source cancellation. It checks the original bytes and five-minute signature window, rejects transferred receiver IDs and conflicting route copies, and accepts only private inbound text. It stores minimized sender/space/line/message evidence and a job atomically before HTTP acknowledgment. IDs remain opaque; project/message deduplication survives retries and rejects changed payloads. An inbox receipt grants no host, session, settings or booking authority. Jobs carry only the private inbox reference. Subsequent processing must recheck current link/admission and preserve receipt order before using the existing authorized conversation runtime.

Do not register/enable this receiver until linking, outbound recovery and consumer ownership are verified. The current deployment can contain this transport foundation while the registry remains empty. Live ingress, host linking and delivery are still unverified; local fixtures verify receipt, linking and linked setup execution; they do not establish live provider acceptance. See [Photon event format](https://photon.codes/docs/webhooks/events) and [signature verification](https://photon.codes/docs/webhooks/verifying-signatures).

Verify target eligibility and actual sender routing for each controlled recipient. Do not infer an iMessage handle from Google email or assume one public sender number for shared-pool conversations. Validate Node runtime compatibility and recovery before deciding whether a separate bridge is necessary.

References: [Photon CLI skill](../../.agents/skills/photon-cli/SKILL.md), [routing](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing), [target policy](https://photon.codes/docs/spectrum-ts/troubleshooting/imessage#target-not-allowed-for-this-project).

### First message and host onboarding

The implemented browser card offers **Connect iMessage** after settings confirmation inside authenticated chat: enter a private number, receive a six-digit code in that conversation, then enter it in a protected browser input to confirm the link. Keep code values out of model context, transcripts and logs. Neither requesting a code nor receiving an inbound message establishes host authority, notification consent or proposal approval.

Verify live delivery and shared-pool eligibility before enabling the flow. Offer web continuation when linking fails. The [host setup conversation](02_frontend_architecture.md#host-setup-conversation) and [pending OpenSpec change](../../openspec/changes/conversational-host-setup/proposal.md) own the UX and authorization contract. See [Photon deliverability guidance](https://photon.codes/docs/best-practices/imessage-deliverability).

### Display name, contact cards, and profile sync

The proposed optional **Add to contacts** action uses the verified sender route for that user's private conversation. The user chooses whether to save it. Contact saving does not establish identity or consent.

The [contact-sharing change](../../openspec/changes/offer-imessage-contact-card/tasks.md) uses the installed Photon SDK's `chats.shareContactInfo` on the exact saved private route. It checks reachability, invokes the caller's current-authority/durable-dispatch guard immediately before the call, and disables automatic retries. A successful RPC means accepted only; an error after dispatch remains uncertain. The SDK supplies no message identity or reconciliation handle for this action. One durable intent per link records current authorization, bounded pre-dispatch retries and irreversible dispatch uncertainty. The protected contact worker and minute recovery schedule are implemented; see the [operational runbook](08_operational_diagnostics.md#native-imessage-contact-sharing). Browser controls, production rollout and live-device acceptance remain pending; no user-facing contact action is enabled yet.

Verify provider profile-sync support and device-side display before claiming that the product name appears automatically. A delivered contact attachment alone proves neither import nor displayed name. See [native contact sharing](https://photon.codes/docs/spectrum-ts/providers/imessage/messaging-features/contact-card-sharing) and [custom contacts](https://photon.codes/docs/spectrum-ts/content/contacts).

## Host invitation operations

Implement operator issuance and revocation against the [host-admission contract](../../openspec/specs/host-admission/spec.md) and [email-delivery contract](../../openspec/specs/email-delivery/spec.md). The repository CLI is `npm run --silent invitations --`; its operator label is audit attribution, while the configured service credential authorizes every database call.

The operator boundary identifies the intended project and operator, rejects public credentials and prevents ordinary hosts or guests from issuing invitations. Remote issuance uses configured Cloudflare delivery unless manual delivery is explicitly selected; local issuance and revocation do not send email.

Persist private dispatch intent before sending, keep one-time codes out of URLs/logs and reconcile uncertain outcomes without automatic resend or reissuance. Invitation revocation blocks redemption; revoking existing host access is a separate operation.

The [operator invitation change](../../openspec/changes/deliver-operator-invitations/proposal.md) now has an internal strict command contract and versioned HMAC/Base32 code derivation. `INVITATION_CODE_KEY` is a dedicated canonical base64-encoded 32-byte server secret, separate from Calendar credential encryption. The derived code is stable for the normalized recipient, project, operator, retry identity and delivery mode; only its hash and derivation context belong in server state. Preserve this key while deliveries are outstanding; a changed key must fail hash verification rather than silently replacing a code. The dedicated service-only `fmat_invitation_operator` lifecycle now owns issue/status/revoke, database-generated seven-day expiry and immutable delivery intent. Exact retries return the same invitation and current status; old generic issuance/revocation operations are denied. Manual intent creates no job, while remote Cloudflare intent creates one durable delivery job. The internal delivery worker and operator CLI with exclusive private manual output are implemented. The protected worker and scheduler are deployed on the selected release target; controlled recipient acceptance remains pending in the evidence ledger. Remote Cloudflare issuance records durable delivery intent.

### Operator commands

Supply `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and the intended `APP_ORIGIN` in the process environment. Issuance and code recovery additionally require `INVITATION_CODE_KEY`. Remote Cloudflare issuance validates `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_FROM` and `CLOUDFLARE_EMAIL_API_TOKEN` before creating an invitation. Status/revocation need neither the code key nor provider configuration. The CLI rejects public credentials and mismatched endpoints before RPC; the database checks the actual service credential. Do not pass credentials or codes as command arguments.

The examples assume the intended environment is already exported. Alternatively, invoke `node --env-file=/absolute/private/operator.env --import tsx scripts/invitations.ts` followed by the same arguments. Use a private environment file and keep it out of Git. Generate and retain a UUID retry key before issuance; retries must use the same project, issuing operator, recipient, mode and key.

```sh
npm run --silent invitations -- --help

# Local issuance is manual-only and queues no email.
# The output must be a new absolute path. Its directory must be owner-only 0700;
# the CLI can create one missing final directory under existing safe parents.
npm run --silent invitations -- issue --project local --operator dev-operator \
  --email host@example.test --key "<issue-uuid>" \
  --output /absolute/private/invitations/host.json

# Remote default is Cloudflare. Use only an authorized recipient.
npm run --silent invitations -- issue --project mriseqztcwmezvtawnbo \
  --operator "<audit-id>" --email "<authorized-recipient>" --key "<issue-uuid>"

npm run --silent invitations -- status --project mriseqztcwmezvtawnbo \
  --operator "<audit-id>" --invitation "<invitation-uuid>"
npm run --silent invitations -- revoke --project mriseqztcwmezvtawnbo \
  --operator "<audit-id>" --invitation "<invitation-uuid>" --key "<revoke-uuid>"

# Recover the same active invitation into a NEW private file; never resend.
npm run --silent invitations -- recover --project mriseqztcwmezvtawnbo \
  --operator "<audit-id>" --invitation "<invitation-uuid>" \
  --output /absolute/private/invitations/recovered.json
```

For remote manual issuance, add `--delivery manual --output /absolute/private/invitations/host.json`. Manual files contain the recipient, original expiry, setup URL and separate grouped code, with mode 0600. Shared directories, symlink paths, existing files and changed file identity are rejected; the CLI does not overwrite or silently fix permissions. Normal JSON reports IDs, original expiry and current status; it omits the code and private derivation context.

After a lost issuance reply, repeat the exact issue command with its retained key and a new private output path when needed. If issuance committed but writing failed, sanitized error JSON retains the retry key and, when known, invitation ID. Use `recover` for that ID or retry issuance with the same key; do not generate a new key to recover a lost result. An abrupt process kill may leave an empty or partial private artifact; inspect it locally and choose a new output path, since the CLI never overwrites an existing file. Recovery uses the original issuing context even when another authorized operator performs it. Revoked, expired, redeemed or changed-recipient invitations cannot be recovered. Recovery never renews expiry, changes delivery mode or invokes Cloudflare. Inspect the private artifact locally and deliver it only through the intended authorized channel; do not paste its code into chat, logs or URLs.

### Invitation delivery and recovery

`InvitationDelivery` uses the service-only `fmat_invitation_delivery` RPC. A 60-second job lease gates load, preparation, dispatch and result recording. The worker derives the original code in memory, verifies its stored hash, and renders frozen template version 1 with the original recipient, origin, expiry and Cloudflare account. Only the preparation basis and message fingerprint are stored. The setup URL contains no code; the email instructs the recipient to use their matching Google identity and redeem the separate code.

Before dispatch, the database rechecks revocation, redemption, expiry and the frozen context after acquiring locks. A changed signing key, account or fingerprint prevents sending; restore the original configuration for a pre-dispatch retry. Exhausted pre-dispatch jobs terminate as failed. Preserve the original key and template rendering for outstanding invitations.

Dispatch intent commits before the provider call. Lost dispatch acknowledgments, interruption after dispatch or expired ownership become uncertain without automatic resend, even when there is no proof that an HTTP request occurred. Accepted outcomes survive lost result acknowledgments and later revocation; revocation still blocks redemption. Status and revocation never trigger delivery. Inspect provider evidence before any explicit manual recovery, and do not reset a dispatch fence or issue a replacement as an automatic retry. The Node route `/api/internal/invitations/delivery` requires the existing constant-time-checked `RUNTIME_DISPATCH_SECRET` and claims one job per call. The private `fmat-invitation-delivery` schedule runs every minute only when a job is due or its lease has expired, using the existing dispatch URL/secret in Supabase Vault. Neither the route nor scheduler accepts caller-selected invitation content. Missing local Vault settings cause no network request. Configure the same dedicated `INVITATION_CODE_KEY` in the selected production runtime and private operator environment before activation; never generate a new key during a retry. Preview environments must not receive production credentials. Provider acceptance still does not prove inbox delivery; controlled mailbox acceptance remains a release gate.

## Google-only MVP host login

Use Supabase Auth Google OAuth with identity scopes `openid email profile`; request Calendar access later through the separate connection flow. Register `https://mriseqztcwmezvtawnbo.supabase.co/auth/v1/callback` on the Google web OAuth client. Supabase then redirects to the allowlisted application return `https://release.findmeatime.com/auth/callback`. Local live Google development additionally needs `http://127.0.0.1:54321/auth/v1/callback` on that client and `http://localhost:3000/auth/callback` in local Auth settings. Keep direct `/connections/google/callback` registrations for Calendar consent.

The sparse [hosted MVP Auth policy](../../supabase/auth-mvp.toml) declares Google enabled and email login disabled, without modifying SMTP, Site URL, callback allowlists, MFA or other provider settings. With CLI **2.119.0**, `[auth.email].enable_signup = false` maps to Management API `external_email_enabled = false`; do not disable global Auth signup, which would also prevent new Google users. Copy the policy to an ignored work directory as `supabase/config.toml`, load `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` into the CLI environment without printing them, then inspect `supabase config diff --workdir <workdir> --project-ref mriseqztcwmezvtawnbo --output-format json`. Apply with `supabase config push` against the same identified target and workdir, then repeat the diff and read `/auth/v1/settings` to verify Google enabled and email disabled. Never push the complete local fixture configuration to the hosted project.

The existing server-only PKCE verifier/session cookies remain HttpOnly, SameSite=Lax and Secure on HTTPS. Start accepts no email, provider override or return URL. An optional strict request-ID/audience target is saved in a ten-minute HttpOnly cookie and rebuilt as a local `/app` path after login or cancellation; the workspace reauthorizes it and loads current state. The cookie is consumed on callback, and agent-consent login clears it before setting its separate return binding. Callback failure/cancellation returns a readable Google retry state at `/app`; login alone does not redeem an invitation. Use the Google account with the invited email. Existing identity and invitation records are preserved; request authority is never inferred from email matching. Local tests seed a completed Google provider result and use real local Auth for PKCE and session verification; live Google account selection/consent still needs separate acceptance evidence.

Live browser check on 2026-10-09 is **blocked**: Google returned `redirect_uri_mismatch` for `https://mriseqztcwmezvtawnbo.supabase.co/auth/v1/callback`. The application/Supabase redirect is correct, but Google has not accepted it for the configured OAuth client. Add this exact callback to that client's authorized redirect URIs, preserving the separate Calendar callbacks, then retry from `/app`. The Google Cloud browser session currently requires operator sign-in before the configuration can be corrected. Earlier Auth settings and HTTP guard checks do not prove working Google login.

Run `npm run probe:google-login -- --origin https://release.findmeatime.com --project mriseqztcwmezvtawnbo` after callback changes. This opt-in, credential-free probe starts the normal Auth redirect and follows only the selected Supabase project and Google Accounts with bounded requests. It rejects callback mismatches and provider error redirects without logging authorization URLs, cookies or provider response bodies. Reaching account selection reports only an initial redirect pass with `liveLoginVerified: false`; complete browser consent and the application return still require separate verification. Ambiguous pages require browser inspection. [Google client configuration](https://support.google.com/cloud/answer/15549257?hl=en) requires an exact authorized redirect URI match.

References: [Supabase Google login](https://supabase.com/docs/guides/auth/social-login/auth-google), [Auth configuration API](https://supabase.com/docs/reference/api/v1-update-auth-service-config).

Verified on 2026-10-07 for code `02a8ba0`: the sparse policy changed one hosted Auth property; a fresh diff has no declared differences, and public Auth settings report `google: true`, `email: false`. The deployed login start redirects through the selected Supabase project to Google using only identity scopes and the intended callback. This verifies configuration and redirect wiring; it does not certify completed live account consent.

## Google Calendar consent configuration

Configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the server. Register `/connections/google/callback` on the release origin and `http://localhost:3000` for direct Calendar consent. Supabase Auth returns use `/auth/callback` instead. Preserve unrelated registered callbacks until their consumers are identified.

Begin consent through a same-origin endpoint with short-lived, single-use state bound to the initiating browser and verified host or protected request. Use HttpOnly, SameSite=Lax cookies, Secure in production, and a restricted return destination. Separate identity sign-in from Calendar consent.

| Principal | Requested Google scopes | Authority |
|---|---|---|
| Host | `openid`, `email`, `calendar.readonly`, `calendar.events` | Read selected host context; create events only in the selected writable destination after current agreement and approval. |
| Requester | `openid`, `email`, `calendar.events.freebusy`, `calendar.calendarlist.readonly` | Calendar chooser metadata and availability for one authorized request; no event details, host admission or event creation. |

Calendar scope names use the `https://www.googleapis.com/auth/` prefix. Verify requested and granted scopes through live consent. Host Calendar scopes are broader than creation-only permission; selected-calendar and approval restrictions are enforced by application policy. Requester event details, Gmail access and host conversational email require separate scope decisions.

Request offline access with `access_type=offline` and `prompt=consent`. Encrypt refresh credentials server-side and persist the encryption key in ignored secret storage; key rotation requires an explicit migration. Revoked or unusable grants and failed reads require reconnection, never an empty-calendar result. Optional requester consent denial permits manual availability.

The exact configured web client in Google Cloud project `findmeatime` was inspected on 2026-10-07. Both `https://release.findmeatime.com/connections/google/callback` and `http://localhost:3000/connections/google/callback` were added and saved, then verified by reopening the client. The three existing callbacks were preserved. Audience is External, publishing status is In production, and Google reports that verification is required (one user against a 100-user unverified cap). Registration does not prove a successful grant or refresh.

The new server adapter uses `google-auth-library` 11.1.0, S256 PKCE and a nonce-bound signed ID token with the configured client audience and verified email. AES-256-GCM binds pending verifier/nonce data to its state hash and token bundles to their host/request principal. `TOKEN_ENCRYPTION_KEY` must be exactly 32 bytes encoded as canonical base64; preserve the existing key across deployments. Missing, changed or corrupt keys fail closed. Start and save both check the original current Auth session or guest credential. Consent is limited to ten starts per principal per ten minutes; a new start or disconnect invalidates older unfinished attempts.

Demonstrate actual refresh continuity before completing Calendar acceptance; Testing-mode Calendar refresh tokens may be short-lived. References: [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [free/busy authorization](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query), [OAuth web flow](https://developers.google.com/identity/protocols/oauth2/web-server), [token expiration](https://developers.google.com/identity/protocols/oauth2).

## Local setup and verification

Use `http://localhost:3000` as the web origin and keep browser API calls same-origin. Keep local and remote privileged credentials separate and disable external sends in local fixtures.

Run `npm ci` and `npm run check` for documentation, application typechecks and unit tests. `npm run build` builds eve and Next.js separately; `npm run test:runtime` checks their production servers. See [local development](../../README.md#local-development) for environment and composed-server commands. Use the [Supabase schema workflow](../../AGENTS.md#supabase-schema-changes) to replay migrations, then run `npm run db:test` and `npm run test:integration` against the disposable local stack. Integration readiness requires the [implementation plan's checks](04_implementation_plan.md#compatibility-gates), beyond these repository checks.

## Runtime inbox recovery scheduler

The release database runs `fmat-runtime-dispatch` every minute. `fmat.wake_runtime_dispatch()` sends an HTTP request only when pending input is due and both Vault entries exist: `fmat_runtime_dispatch_url` (the verified origin plus `/api/internal/conversations/dispatch`) and `fmat_runtime_dispatch_secret` (64 lowercase hex characters). The same secret is the server-only `RUNTIME_DISPATCH_SECRET` on the selected Vercel production project. Use a dedicated random secret; never reuse provider keys or store secret literals in cron commands/migrations. Follow the [Supabase Cron/HTTP/Vault pattern](https://supabase.com/docs/guides/functions/schedule-functions).

The named `cron.schedule` definition also belongs in `supabase/schemas/11_runtime_dispatch.sql`. pg-delta tracks named jobs: omitting it from desired schema can emit `cron.unschedule` during an unrelated migration. Keep the original installer migration as history and review generated cron operations alongside grants and destructive SQL.

Provision Vault only after verifying the intended deployment, then verify the protected endpoint and an actual scheduled wake-up. Previews and disposable local databases leave these entries absent. Do not copy release Vault entries into a preview. To stop recovery during an incident, disable this named cron job; preserve inbox rows and their canonical session IDs. Restore the matching deployment/credential, re-enable the job, and inspect `dispatch_error`, `dispatch_attempts`, `next_dispatch_at` and turn status. A sent transport is not a completed turn. Do not replace a bound workflow to clear a stuck message; reconcile it explicitly. Rotate the Vault and Vercel values together and redeploy before resuming the job.

Requester selection requires the narrow Calendar-list scope in addition to availability. Existing grants issued with only `calendar.freebusy` must reconnect before listing/reads. Configure the consent screen for the requested scopes before live acceptance; registering a callback or having a secret does not verify the grant. [Google scope definitions](https://developers.google.com/workspace/calendar/api/auth) distinguish availability-only and list-only access from event reads/writes.

## iMessage code delivery worker

The linking backend uses `@photon-ai/advanced-imessage` 2.2.0 with pinned gRPC peers. `PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET` authenticate short-lived token issuance. Shared routing uses the provider's shared endpoint; set `PHOTON_LINE` only to select a dedicated sender when needed. Each persisted intent freezes its line and private recipient; missing/changed routing fails without choosing another sender. On 2026-10-07, the configured project's real token issuer returned a valid shared route. No recipient lookup or message was performed by that probe; actual target eligibility, message GUID routing and delivery remain live acceptance checks.

`TOKEN_ENCRYPTION_KEY` also protects temporary codes and derives a separate OTP HMAC key. Preserve it across deployments. The browser receives only masked state; do not log request bodies, encrypted payloads or provider errors. A code expires in ten minutes, with five guesses, a one-minute resend cooldown and five starts per hour per host and recipient. Explicit cancellation, number replacement, successful use and terminal failure clear protected material. A scheduled sweep also clears expired/revoked unsent or uncertain challenges.

The `fmat-photon-links` database schedule runs every minute. Due challenge records are the authoritative delivery intents; the worker at `/api/internal/photon/dispatch` claims at most five with two-minute leases, revalidates authority immediately before sending, and records provider results under the same lease. Its URL is derived from the existing `fmat_runtime_dispatch_url` Vault entry, with `/api/internal/photon/dispatch` replacing the conversation-dispatch path. It uses the same dedicated `fmat_runtime_dispatch_secret` / `RUNTIME_DISPATCH_SECRET`; absent Vault entries produce no network activity. Local/preview fixtures must keep those entries absent. Disable this named job to suspend code recovery without deleting records.

The transport uses the persisted challenge UUID as `clientMessageId`, disables automatic retries and closes each client. A claimed send that crashes or loses acknowledgment becomes reconciliation-only, even after lease expiry. Known provider references are checked only in the frozen private conversation. An unknown reference remains uncertain; never reset a record to prepared or generate a replacement ID automatically. A host may explicitly request a new code after the rate limit. Acceptance and duplicate acceptance do not prove device delivery. Before registering/enabling any receiver, finish linked-authority handling and run authorized real-recipient tests; the current release still has no enabled receiver. Inline cards and complete host continuity remain pending.

### Linked input recovery

The `fmat-photon-inbox` minute schedule uses the same Vault URL/secret as code recovery and invokes the same protected Photon dispatch endpoint. It wakes for unprocessed receipts with frozen link authority. Each HTTP sweep processes at most five receipts in separate transactions; existing conversation recovery dispatches accepted inputs to eve. Busy conversations preserve receipt order. Expired jobs recover; active transport leases are respected. Terminal receipt outcomes are `accepted`, `revoked` or `limited`, without private text in job results. Grants expire one hour after receipt and never move to a replacement link/receiver. Disable this named schedule to suspend input transfer; disabling the receiver additionally prevents ingress and invalidates queued execution. Live private acceptance and consumer ownership must pass before registering/enabling a receiver.

### Private reply recovery

`fmat-photon-replies` wakes `/api/internal/photon/replies` every minute when reply intents are due. It derives that path from `fmat_runtime_dispatch_url` and uses the existing Vault dispatch secret; no new credential or separate process is required. The route has a 120-second execution limit and handles at most five claims, with two-minute leases and a 30-second minimum polling interval. It uses the same pinned Photon transport and project secrets as code delivery. Local and preview databases keep wake-up Vault entries absent.

Final text is checkpointed by eve and inserted into `fmat.photon_replies` in the runtime settlement transaction. If settlement fails, the existing input recovery retries that saved result. Inspect input status separately from reply `status`, `provider_reference`, `checked_at`, lease and `revoked_at`; never log private bodies. A prepared reply is changed to uncertain before network dispatch. Crashes, timeouts and lost acknowledgments permit only reference reconciliation, with the same message identity. Never reset uncertain/accepted intents to prepared. Unknown references remain uncertain until authority expires, then further work is suppressed; browser history remains available under its own authorization. Disable `fmat-photon-replies` to suspend reply recovery; preserve its rows and the runtime checkpoint for diagnosis. Disable the receiver to revoke channel processing as well. Live recipient acceptance and actual scheduled delivery remain unverified while the production registry is empty.

### Unlinked continuation preparation

`PhotonHandoffs` uses `TOKEN_ENCRYPTION_KEY` to protect short-lived continuation tokens with a project/intent-specific encryption context. Its service-only `fmat_photon_handoff` RPC owns preparation, route validation, lease claims, post-preflight authorization, result recording and private token resolution. It uses the existing Photon project/transport credentials and `APP_ORIGIN`; no new secret is introduced. The handoff expires fifteen minutes after the signed receipt, and retries do not extend it. Never log the link fragment or ciphertext.

`POST /api/internal/photon/handoffs` requires the existing runtime dispatch bearer secret, prepares up to five unlinked receipts and claims up to five outgoing intents. The minute `fmat-photon-handoffs` sweep uses the existing Vault runtime URL/secret only when an enabled receiver has pending work. `/app` now exchanges the fragment into browser-bound HttpOnly continuation, preserves it through sign-in/admission and requires a fresh OTP in the original private conversation. No new provider secret is introduced. Keep the production receiver inactive until controlled live recipient eligibility, device delivery and actual iPhone/browser handoff acceptance are verified; local synthetic sends do not prove those gates.

## Google Routes

Set server-only `GOOGLE_MAPS_API_KEY` for the intended Routes-enabled Google Cloud project. It is separate from Google Calendar OAuth grants. The adapter calls only `https://routes.googleapis.com/directions/v2:computeRoutes`, places the key in `X-Goog-Api-Key`, uses a bounded field mask and a ten-second deadline, and makes no automatic retry. Production configuration must be provisioned separately from the ignored local environment. On 2026-10-07 the existing credential was added as a production-only Secret to verified Vercel project `findmeatime-release`; readback confirmed the named Secret entry without exposing its value.

A controlled probe on 2026-10-07 at 05:45 UTC used public landmark coordinates, with departure 2026-10-08 at 05:45 UTC. It made eight requests with the configured local server credential. These results apply only to the tested endpoint pair, mode and departure; they do not establish country-wide coverage or deployed scheduling acceptance.

| Endpoint pair | DRIVE | TRANSIT | WALK | BICYCLE |
|---|---|---|---|---|
| Seoul City Hall `(37.5663, 126.9779)` → Seoul Station `(37.5547, 126.9706)` | No route | Estimate returned | No route | No route |
| Times Square `(40.7580, -73.9855)` → Grand Central `(40.7527, -73.9772)`, New York | Estimate returned | Estimate returned | Estimate returned | Estimate returned |

The repeatable `npm run probe:routes` performs exactly sixteen read-only, billable requests with those public landmarks: both adjacent directions for each of four modes and both cities. It uses the real travel evaluator with synthetic neighboring commitments, a 120-minute gap per side, a 10-minute meeting buffer and a 15-minute extra travel buffer. It prints sanitized outcomes and asserts that successful legs count each buffer exactly once. It requires server-only `GOOGLE_MAPS_API_KEY`; it does not read Calendar, persist scheduling state or book a meeting.

On 2026-10-09 at 05:00 UTC, the exploratory and repeatable runs (sixteen requests each) agreed: Seoul transit returned estimates in both directions; Seoul drive/walk/bicycle returned no route in both directions; New York returned estimates for all four modes in both directions. In the repeatable run, departures were 2026-10-10 at 05:10:52.618 UTC inbound and 07:40:52.618 UTC outbound. Each successful estimate plus the extra travel margin fit the remaining 110 minutes, and each no-route result stayed clarification. These are local-adapter/evaluator checks against live Routes, with synthetic Calendar context; selected-deployment physical booking and explicit host manual-allowance acceptance remain open. [Dated evidence](05_rebuild_evidence.md#bidirectional-live-routes-evaluation--2026-10-09).

No-route, unsupported/partial locations, past departure contexts, transit departures beyond 100 days and provider failures remain unresolved. Reconnect/configuration recovery or an explicit host-confirmed, context-bound manual allowance is required as appropriate; the application must not substitute zero or switch modes. Authenticated manual allowance persistence, evaluator consumption and the [private host review UI](05_rebuild_evidence.md#private-travel-and-preference-review-2026-10-07) are implemented and fixture-tested; the complete live physical booking journey remains pending. See the [transit constraints](https://developers.google.com/maps/documentation/routes/transit-route) and [travel core](01_backend_architecture.md#routes-adapter-and-adjacent-trip-core).

Physical exact-candidate checks now read neighboring commitments with the host's existing Calendar grant and selected conflict calendars. No new OAuth scope or provider credential is required. The adapter uses the [Events list contract](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), expands recurring instances, includes hidden invitations, traverses bounded pages, reauthorizes before each page and omits titles/descriptions/attendee identity. Local fixtures cover missing/incomplete/denied responses and all-day/DST handling; no additional live Calendar access is claimed by these tests. A complete empty bounded range still leaves the host's origin/destination unknown. See [authorized adjacent commitments](01_backend_architecture.md#authorized-adjacent-commitments) for the coverage and privacy boundary.

The manual allowance backend adds no provider scopes, keys or external messaging. Host confirmation supplies a specific private leg duration/mode and endpoint/time; subsequent evaluation still reads current authorized Calendar context and checks both gaps and buffers. Unknown geography remains unresolved until a current explicit allowance or successful route resolves it. This does not expand the tested live Routes coverage above or establish a complete physical booking journey. See [manual allowances](01_backend_architecture.md#host-confirmed-manual-travel-allowances).

## Booking dispatch readiness

The current browser approval path stores verified host/session attribution and queues one frozen attempt. `fmat_booking_evaluation` revalidates that attempt under a current job lease; `fmat_booking_dispatch` consumes the exact saved evidence and writable-destination check within 30 seconds. No new provider credential or browser scope is introduced. Both internal RPCs require the service role, and neither is exposed as a model or browser action.

The first dispatch commit is the cutoff after which the saved event identity and reservation must be retained for reconciliation. It returns one positive insertion receipt; a repeated call returns `dispatched: false`, including after a lost positive response. Operators must not reset that attempt to prepared or use the retained generic feasibility-boolean command to bypass the gate. The dispatch record is not confirmation that Google created an event. See [the backend dispatch contract](01_backend_architecture.md#consuming-booking-evidence-at-dispatch).

The booking runner, scheduler, provider-outcome recording and reconciliation integration remain pending. These RPCs alone do not activate automatic Calendar writes, and the release remains unready until the implementation plan's complete booking and live acceptance gates pass.


### Booking worker scheduler

The booking worker migration installs the minute cron job `fmat-booking-dispatch`. Its private `fmat.wake_booking_worker()` sends a wake-up only when eligible booking/reconciliation work is due. It reads Vault names `fmat_booking_dispatch_url` and the existing `fmat_runtime_dispatch_secret`. A missing value leaves the scheduler inert. Provision the URL as `https://release.findmeatime.com/api/internal/booking/dispatch` only after the endpoint deployment is verified and pending work has been inspected. Do not print the shared secret or include it in tracked SQL.

Each authenticated invocation handles at most one job; duplicate wakes are safe because claims and dispatch are fenced. Recovery preserves the exact event identity and reservation. Missing lookup results are not proof of noncreation. After restoring access to the same Google account, use the audited `booking_reconcile` operator command for uncertain/conflicting attempts; do not delete attempts, release reservations manually or create compensating events. Exhausted work remains available for operational review. The controlled local fixture exercises audited conflict recovery; live Calendar acceptance and the complete operator retry interface remain pending.


On 2026-10-07, worker code `02d8823` was deployed Ready and the URL above was provisioned after an empty-queue inspection. The authenticated idle endpoint and the first post-activation minute cron run passed. Production migration history contains 57 matching versions. No live Calendar event was used for this activation check; see the [worker evidence](05_rebuild_evidence.md#automatic-booking-worker--2026-10-07).


### Booking confirmation email worker

The delivery adapter requires `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`, `CLOUDFLARE_EMAIL_FROM=no-reply@findmeatime.com`, `TOKEN_ENCRYPTION_KEY` and the existing application/database configuration. The token needs Email Sending access for the selected account. Missing configuration cannot claim work. Sender/account fallback and automatic resend after persisted dispatch are forbidden.

The minute scheduler `fmat-booking-delivery` calls private `fmat.wake_booking_delivery()`. Provision Vault `fmat_booking_delivery_url=https://release.findmeatime.com/api/internal/booking/delivery` only after deploying and verifying the authenticated endpoint and inspecting pending recipients. It reuses `fmat_runtime_dispatch_secret`; never print that secret. Without the delivery URL the scheduler is inert. Verify cron execution and endpoint status separately from actual inbox delivery.

An uncertain message retains its frozen identity and requires investigation; changing a job lease must not resend it. Expired final attempts receive a recovery claim that resolves local status without authorizing another send. A retry exhausted before any dispatch marks the message failed. No delivery recovery operation creates a Calendar event.

## Operator booking recovery

Controlled operator acceptance covers definitive rejection/retry and lost-success-response reconciliation, including CLI replay and an initial not-found lookup. See the [acceptance evidence](05_rebuild_evidence.md#operator-lost-response-recovery-acceptance--2026-10-09). These are local provider fixtures; live Google reconnection and booking require separate acceptance.

Run `npm run booking:recover -- --help` from the repository. Supply `SUPABASE_URL` and `SUPABASE_SECRET_KEY` through the operator's secure environment; the command does not load local environment files automatically. The service key grants administrative authority. `--operator` is a stable audit label, not a login or permission grant. This command is deliberately absent from browser and agent tools.

```sh
npm run booking:recover -- --project mriseqztcwmezvtawnbo --operator operator-name --request REQUEST_UUID --action reconcile --key DECISION_UUID
```

Replace the placeholders with the affected request, operator identity and a fresh UUID for the recovery decision. The project must match the configured Supabase hostname; disposable local fixtures require `--project local`. Preserve the complete command and decision UUID in the incident record. If its response is lost, retry the identical command and key. An `ok` response acknowledges the saved recovery command, including replay; it does not claim the Calendar event is confirmed.

- Use `reconcile` after possible dispatch, unknown outcomes or a mismatching event. The worker looks up the saved Calendar/event identity, verifies its association and payload, and keeps unresolved reservations. Never replace an event because an immediate lookup returns not-found.
- Use `retry` only for definitive noncreation or exhausted undispatched work. Pending or live jobs reject replacement. The database retains the request's event identity and checks current decisions; the worker repeats feasibility and credential checks before dispatch. A changed or missing agreement/approval requires participant review rather than an operator override.
- For revoked credentials, the host reconnects the original Google account through `/app`. Consent remains a host action. Reconciliation must use the original provider account and saved calendar/event; changing the destination cannot resolve an uncertain earlier write. A different connected account leaves recovery pending. A newly selected destination applies to future bookings; reconciliation continues against the original saved destination. [Controlled reconnect acceptance](05_rebuild_evidence.md#consent-based-booking-recovery--2026-10-09) verifies these boundaries.
- If retirement reports `nextAction: review_proposal`, return to the participant review flow. Do not edit approval, attempt, reservation or request rows to force recovery. Confirm success from the protected receipt and verified provider evidence, not the command response.

Recovery does not delete Calendar events, release uncertain reservations or retry confirmation email. Email delivery has its own saved outcome and identity. Local transport fixtures verify scheduling and recovery boundaries; controlled live Calendar recovery remains a separate release gate.

## Requester verification email delivery

The private `POST /api/internal/contact/delivery` endpoint uses the existing Cloudflare account/sender/token, `TOKEN_ENCRYPTION_KEY` and `RUNTIME_DISPATCH_SECRET`. Keep the encryption key stable while pending challenges or frozen messages exist. Each call claims one `contact_verification_delivery` job; it cannot claim booking jobs or verify contact itself.

The minute scheduler `fmat-contact-verification-delivery` invokes private `fmat.wake_contact_verification_delivery()`. Provision Vault `fmat_contact_verification_delivery_url=https://release.findmeatime.com/api/internal/contact/delivery` only after the endpoint is deployed and pending recipients/jobs have been inspected. It reuses `fmat_runtime_dispatch_secret` and stays inert without its URL. Inspect cron execution separately from accepted provider submission and actual inbox receipt.

Expired, consumed, superseded or contact/credential-changed challenges suppress unsent work. Unknown sends retain their immutable dispatch and must never be manually reset for resending. The requester may explicitly request a fresh code after the cooldown; the new challenge invalidates the old one. Verification is independent of Google-only host login, private-link recovery and proposal approval. The protected requester browser now exposes explicit send/confirm controls. Controlled live inbox acceptance remains a release gate.

## Requester identity-only Google entry

Optional requester identity uses the existing server-only Google client credentials and registered `https://release.findmeatime.com/connections/google/callback`, plus its approved local counterpart. It requests only `openid email profile`, online access and account selection; it does not request Calendar scopes or use Supabase host sessions. No additional callback registration is needed. The browser-visible `identity.` state marker selects its separate binding/state adapter and must never fall through to Calendar handling on failure.

Signed provider fixtures verify the app's HTTP token/certificate path and callback/database/browser behavior. These fixtures do not prove live consent, Google client publishing status or actual iPhone behavior. Google-authoritative Gmail/hosted-domain contact claims can establish proof for the reviewed matching recipient; third-party email still needs our email code, following [Google's identity verification guidance](https://developers.google.com/identity/sign-in/web/backend-auth).

### AgentMail verified transport boundary

`verifiedAgentMailReceipt` uses pinned Svix **2.7.0**. Unlike older examples that consume a return value, this SDK's `Webhook.verify` returns `undefined`; the adapter verifies the original UTF-8 payload before parsing JSON separately. The official library enforces five-minute timestamp tolerance. The application additionally bounds headers, rejects invalid UTF-8, caps streamed payloads at one MiB and cancels stalled reads after five seconds.

Only `message.received` produces a locator. Spam, blocked, unauthenticated and unrelated event types cannot enter conversation dispatch through this boundary. The configured inbox must match; an included thread object must agree with the message's inbox/thread. Output contains delivery/event/message/thread/inbox IDs, occurrence time and a SHA-256 digest of the signed bytes. Sender fields, arbitrary authentication headers, HTML, text and attachments are not identity evidence and are excluded.

AgentMail can omit large bodies from webhooks. The future worker must fetch the exact message through the bounded provider API and resolve verified contact/request binding; it must never infer blank content, use preview as full text or trust an email address as request authority. `POST /api/providers/agentmail` now awaits the service-only `fmat_agentmail_ingress` transaction before returning empty 200. The private registry requires matching `AGENTMAIL_RECEIVER_ID` (an internal generation UUID), `AGENTMAIL_INBOX_ID` and an enabled registration. Missing configuration or disabled/replaced registration returns 503, including for duplicate events. Authenticated unsupported event types return 204 only after checking that registry.

The transaction stores minimized receipt evidence, deduplicates inbox/message, inbox/event and inbox/delivery identities, rejects changed evidence with 409, and publishes one `agentmail_ingress` job containing only `receiptId`. Publication failure rolls back all receipt state; lost responses can retry without duplicate work. Registry replacement preserves the original receipt generation. No sender, request access or scheduling decision is inferred.

Keep production registry empty/disabled and do not register live delivery until competing consumers are fenced and full-message retrieval, sender/request binding and downstream dispatch are verified. Disabling the registry fences new ingress without deleting committed evidence. Consumer ownership, sender verification and live acceptance remain open.

Sources checked 2026-10-08: [AgentMail signatures](https://www.agentmail.to/docs/webhook-verification), [event schema](https://docs.agentmail.to/api-reference/webhooks/events/message-received), [payload limits](https://docs.agentmail.to/webhooks-overview), and [Svix library verification](https://docs.svix.com/receiving/verifying-payloads/how). The overview's `from_` example differs from the API event schema's `from` field; neither is used for authorization here. The installed SDK source and independent HMAC fixtures establish the verification behavior used by this adapter.

### AgentMail full-message reads

`AgentMailMessages.get` reads the exact receipt message at the fixed `https://api.agentmail.to/v0` origin with the configured inbox and scoped server API key. It disables redirects and caching, bounds the entire fetch/body to ten seconds and two MiB, and requires strict UTF-8 JSON. Inbox, message, thread and occurrence time must match the receipt. A received label is required; spam, blocked, unauthenticated, trash, sent and draft classifications are rejected. Provider 404 remains unavailable rather than an empty message; other provider failures are sanitized.

The reader prefers `extracted_text` when present, including an explicitly empty extraction. It falls back to full `text` only when extraction is absent and labels the source so downstream code can distinguish potentially quoted history. Preview, HTML and attachments never substitute for text. Missing, blank and over-10,000-character text produce distinct unavailable states instead of truncation or invented content; downstream recovery must ask for usable input without assuming agreement.

Sender, recipient and reply-to addresses remain **untrusted claims**. Neither labels nor authentication headers grant contact proof, request access or approval. Arbitrary headers and HTML are excluded from the reader output. A current protected request binding and verified contact are still required before dispatch or recipient selection; forwarded mail and changed reply-to cannot select authority. This module is not wired to job execution yet.

Verified 2026-10-08: six deterministic tests cover exact identity, address parsing, unavailable text, restricted labels, errors, redirects, invalid UTF-8, streamed size and stalled body cancellation. A read-only probe of the existing controlled project test inbox successfully returned matching message identity and extracted text; no message body or address was logged and no mail was sent. This is API-read evidence, not a live scheduling journey. Sources: [Get Message](https://docs.agentmail.to/api-reference/inboxes/messages/get) and [message extraction](https://docs.agentmail.to/messages).

### Independent email author evidence

AgentMail's normal received classification is insufficient for author alignment: its [inbound policy](https://docs.agentmail.to/knowledge-base/inbound-emails-missing) allows certain DMARC failures when the domain policy is `none`. Never promote copied Authentication-Results headers to authority.

`agentMailRawMessage` obtains [raw-message metadata](https://docs.agentmail.to/api-reference/inboxes/messages/get-raw) from the fixed API origin and downloads only from the observed `https://cdn.agentmail.to` origin, with no forwarded API credential or redirects. The combined metadata/download deadline is ten seconds; metadata is capped at 16 KiB and the raw message at two MiB. It checks provider message identity, URL expiry and exact downloaded size.

`verifyAgentMailAuthor` uses pinned [mailauth 7.1.1](https://github.com/postalsys/mailauth) in strict mode. It requires one matching From mailbox, a matching Message-ID, and a passing signature from that exact From domain signing both fields and the complete body. Partial-body `l=` signatures, testing keys, expired/future signatures, RSA keys below 2048 bits and SHA-1 are denied. Headers are capped at 64 KiB, signatures/DNS queries at eight and verification at five seconds. DNS errors remain unavailable evidence. The result contains sender/domain, message ID, raw hash, signature identity and signed routing context. Request binding additionally requires the same accepted signature to cover To or Cc containing the configured application inbox. Continuation requires a singular signed In-Reply-To that identifies an earlier authenticated receipt in the same linked thread; provider thread grouping alone is insufficient. Nodemailer 10.0.14 is pinned only for mailbox-header parsing.

These primitives do not authorize a requester or run a job. A protected request binding, verified contact and current receipt/replay/revocation checks must still authorize each message. Alignment failure or unsupported mail formats require protected browser recovery.

Controlled read-only observation on 2026-10-08: the existing Cloudflare-delivered test message downloaded successfully (5,224 bytes); From and Message-ID matched the provider record, and aligned whole-body DKIM passed. Both signatures omitted Message-ID, so application author evidence correctly failed closed. Eight deterministic tests include independently generated RSA signatures, tampering, forged verdict headers, limited-body signatures, ambiguous authors, unsafe download URLs and stalled DNS/downloads. Positive live requester-author acceptance remains open.

### gRPC security patch — 2026-10-08

The direct Photon transport dependency `@grpc/grpc-js` is pinned to **1.14.5**. The [upstream patch](https://github.com/grpc/grpc-node/releases/tag/%40grpc%2Fgrpc-js%401.14.5) fixes certificate-authentication context and error-detail disclosure advisories. Application/provider tests, both builds and the full local browser journey pass; `npm audit` reports zero vulnerabilities after the patch. This does not replace the separate live Photon routing/acceptance gate. No product or UX contract changes are introduced.

## Requester email worker activation boundary

The release includes `/api/internal/agentmail/dispatch`, protected by `RUNTIME_DISPATCH_SECRET`, and the database `fmat-requester-email` minute scheduler. The scheduler derives this route from the existing `fmat_runtime_dispatch_url` Vault value and uses the existing dispatch secret. It only wakes for pending work in an enabled receiver generation. Keep `fmat.agentmail_receivers` disabled until controlled signature, enrollment, continuation and revocation acceptance succeeds; setting provider credentials alone does not enable the channel. The worker does not yet send conversational email replies. See [the tracked change](../../openspec/changes/bind-requester-email/tasks.md).

### Requester recovery delivery worker

`POST /api/internal/recovery/delivery` requires the existing `RUNTIME_DISPATCH_SECRET`, processes one leased `requester_recovery_delivery` job and returns only a sanitized outcome. It uses the existing Cloudflare account/token/from settings, `TOKEN_ENCRYPTION_KEY` and validated `APP_ORIGIN`; no new provider credential is needed. The minute `fmat-requester-recovery-delivery` scheduler derives this endpoint from the exact validated `fmat_runtime_dispatch_url` in Vault and uses `fmat_runtime_dispatch_secret`. No work means no HTTP wake-up.

The worker freezes encrypted HTML/plain-text content and the recipient before dispatch. Its link uses `/booking/{requestId}#recover={challengeId}.{proof}`; no proof enters query strings or scheduling/model content. Dispatch rechecks the original verified contact, current request token hash, proof validity and request lifecycle. The old browser token may have expired; recovery proof supplies separate authority. Once dispatch may have occurred, a restarted worker records uncertainty rather than sending again. An explicit new recovery request after the cooldown creates a separate proof and supersedes older links. Delivery acceptance does not redeem the proof or rotate request access.

Public recovery issuance and explicit browser redemption are implemented on the booking page. Live recovery acceptance remains separate from synthetic delivery tests. Issuance enforces one link per minute and five per hour per request, five per hour per verified recipient across requests, and shared minute budgets of 600 attempts and 120 links. Budget exhaustion preserves generic acceptance and issues no email.


### AgentMail reply transport

`AgentMailReplyTransport` accepts a persisted reply ID, configured inbox, exact received parent/thread, one verified recipient, plain text and original first-attempt time. It calls the fixed [reply endpoint](https://docs.agentmail.to/api-reference/inboxes/messages/reply), explicitly clears Cc/Bcc, disables reply-all and open tracking, and excludes caller headers, HTML and attachments. The caller must freeze that snapshot and recheck current application authority/lease before dispatch; a provider parent alone is not authorization.

The stable `fmat-reply-<UUID>` header follows [AgentMail idempotency](https://docs.agentmail.to/idempotency). The provider documents a 24-hour key lifetime after completion; the adapter refuses sends at 23 hours from the persisted first attempt, including after an authorization wait. Never reset that timestamp or generate a fresh key to resolve a possibly accepted send. Each invocation makes at most one HTTP attempt. Non-200, missing/mismatched identifiers, transport failure and malformed/oversized responses remain uncertain; no automatic retry occurs inside the adapter. Requests reject redirects and bound fetch/body work to fifteen seconds and 128 KiB.

[Message readback](https://docs.agentmail.to/api-reference/inboxes/messages/get) checks inbox, message/thread, parent, sender, sole recipient, absence of Cc/Bcc and sent classification. It requires the exact frozen answer. The live reply endpoint appends quoted history: when present, inspection separately fetches the exact persisted parent and requires matching inbox/thread/message, sender equal to the frozen recipient, sole application recipient, received classification and a timestamp preceding dispatch. The entire appended quotation must match that parent’s original sender, UTC date and full text in the observed provider format. Unknown formats, changed content, unavailable parents and extra suffixes stay uncertain. Extracted text or prefix matching alone is insufficient. Authority is checked before each fetch and before returning acceptance; neither inspection nor an uncertain result sends a message. Each fetch retains its 15-second/128-KiB bound.

Readback proves provider storage only, never inbox delivery. The private worker already uses persisted POST acceptance and frozen-key replay; it does not use readback to invent an identity after a lost response. Durable capture/delivery and parent provenance are implemented below. Authenticated delivery events and live signed multi-turn acceptance remain pending. Do not change an already-attempted payload/key or substitute the send endpoint: the controlled explicit-header send probe preserved text but lost parent/thread association.


## Requester email reply worker

The internal worker at `POST /api/internal/agentmail/replies` uses `RUNTIME_DISPATCH_SECRET`, `AGENTMAIL_INBOX_ID`, `AGENTMAIL_RECEIVER_ID` and `AGENTMAIL_API_KEY`. Its minute scheduler uses the existing `fmat_runtime_dispatch_url` and `fmat_runtime_dispatch_secret` Vault entries and the enabled receiver registry; no separate provider credentials belong in SQL. Keep live receiver activation behind the binding/controlled-mail acceptance gate. A deployed worker alone is not a verified live email journey.

Each invocation claims one immutable reply, records uncertainty before HTTP, rechecks current authority, and stores provider acceptance only with a valid message identity and the frozen thread. Recovery keeps the original payload and idempotency key. The fixed 23-hour window starts at the first persisted claim and never moves with retries. A response lost after provider acceptance can be replayed within that window; a response lost after database acceptance is recovered as terminal without another send. Never reset first-attempt dates, replace keys, edit frozen recipients/content, or manually mark unknown sends failed to unblock a thread. Unknown outcomes after the horizon require evidence-based reconciliation; protected browser continuation stays available. Provider acceptance does not establish inbox delivery.


Signed requester continuations may cite a provider-accepted outgoing service reply. Its saved identity must match the same inbox, receiver, link, thread and recipient, and its first attempt and authenticated source input must precede the new receipt. No extra provider permission or configuration is introduced. Do not replace absent signed routing evidence with thread membership or mark an uncertain outgoing record accepted to admit a continuation. Controlled live enrollment, reply receipt and this continuation still require actual mailbox evidence before enabling the receiver.

## Protected MCP OAuth compatibility

The application-owned OAuth server and initial protected MCP resource are active. Keep Google-only host login separate from personal-agent grants. Run `npm run probe:oauth` against the disposable local stack to reproduce the pinned GoTrue v2.197.0 finding: discovery/registration/S256/replay/revocation work, but form-encoded code exchange and refresh accept a wrong `resource`, and access/refresh results use the generic `authenticated` audience. Exit 2 reports this incompatibility; it does not authorize deploying unmodified Supabase OAuth as the MCP boundary.

The probe creates an isolated loopback-only Auth process and synthetic identity/client, then removes the process/user and soft-deletes the client. It makes no hosted configuration changes. Its local signing issuer remains the existing local stack issuer; it calls only the isolated process directly, so this is a protocol/server capability probe rather than a usable browser discovery deployment. See [test instructions](../../tests/README.md#local-oauth-compatibility-probe) and [dated evidence](05_rebuild_evidence.md#local-oauth-resource-isolation-spike--2026-10-08).

The implementation must independently enforce resource-specific code/refresh/access authority and current scoped grants before publishing protected tools. Never accept generic Supabase or Google tokens as MCP credentials. Source verification used [pinned GoTrue token handling](https://github.com/supabase/auth/blob/4eee58f296d9698a1c2c0ae14d7a0b379c7622d3/internal/api/oauthserver/handlers.go), [Supabase OAuth setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started) and [MCP authorization requirements](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). Actual hosted behavior and each named client still require separate tests.

### Application-owned OAuth primitives

The completed [agent authorization change](../../openspec/changes/archive/2026-10-08-authorize-agent-clients/proposal.md) retains Google-only Supabase identity and implements a separate resource-bound grant/token boundary. Its internal primitives use pinned `jose` 6.2.12 with ES256. Discovery, registration, authorization, token, revocation and explicit browser-consent routes are implemented. Release signing is active as of 2026-10-08 with public key ID `release-20261008-v1`; the private key is stored only as a sensitive production Vercel variable. Discovery and protocol routes are live. A controlled requester browser/loopback-terminal journey verified deny/grant, code exchange, narrowed refresh, browser revocation and replay-family revocation; its fixtures were removed. The initial MCP catalog is exposed and controlled requester calls, refresh narrowing and browser revocation pass; full workflow and named-client acceptance remain open. See the [live authorization evidence](05_rebuild_evidence.md#live-agent-authorization--2026-10-08).

Before route activation, supply server-only `AGENT_OAUTH_SIGNING_JWK` as a P-256 private JWK with a unique `kid`, canonical base64url `x`, `y`, `d`, and optional `alg: ES256`/`use: sig`. `AGENT_OAUTH_RETIRED_JWKS` is an optional JSON array of at most three public P-256 keys with different IDs; private fields there are rejected. Key import and a sign/verify self-check must pass. Public projection contains only verification fields. Rotation requires a new active ID and the previous public key until its five-minute access tokens expire; removing a public key ends acceptance. Do not generate transient runtime keys, copy Supabase signing keys, or put this configuration in browser environment variables.

Issuer is the configured `APP_ORIGIN`; the only resource/audience is exactly `APP_ORIGIN + /mcp`. Authorization and form code/refresh parsing reject duplicate decoded parameters, malformed escapes/UTF-8, missing or mismatched resource, plain PKCE and missing/unknown/mixed-role scopes. Supported scope names are `host:read`, `host:write`, `host:decide`, `request:read`, `request:write`, `request:decide`; decision scopes never substitute for human meeting confirmation. Callback validation permits HTTPS and literal loopback HTTP and preserves exact registered strings. Unknown extension fields grant no permissions.

Access tokens expire in at most five minutes or at the grant's earlier expiry. Verification requires exact issuer/singleton audience/type/key/claim shape and a current-authority callback; it does not produce an existing browser/domain credential. The durable grant checker and internal operation adapter enforce current authority; public MCP/CLI transport still needs implementation. Test keys are generated in memory and never reused in production.


The internal OAuth lifecycle is implemented in service-only database RPCs. Apply the reviewed additive grant, revocation-authority and effective-scope migrations with the repository schema workflow. A fresh browser JWT is required to create host consent, but the explicit grant follows the original current Auth session for at most thirty days; session deletion, expiry, account bans or lost admission stop refresh/access. Requester grants follow the current request token and the earlier request/token expiry. Refresh reuse permanently revokes its family. RPC error objects can represent committed revocation, so protocol adapters must not roll back the call on an `invalid_grant` result. No public OAuth routes or release signing keys are enabled by these migrations alone.

### Application OAuth HTTP contract

With valid signing configuration, clients discover the issuer at `/.well-known/oauth-authorization-server`, public keys at `/oauth/jwks`, and the exact MCP resource at `/.well-known/oauth-protected-resource/mcp` (also available at the root metadata path). `POST /oauth/register` accepts JSON `client_name`, one to five exact `redirect_uris`, `token_endpoint_auth_method: none`, `response_types: [code]` and supported `grant_types`. Missing display name uses “Personal agent”; unrecognized metadata is discarded and never fetched or rendered. The response assigns a UUID public client, with no client secret. Registration does not grant scopes or actor authority.

`GET /oauth/authorize` requires `client_id`, `response_type=code`, exact `redirect_uri`, `resource`, explicit same-role `scope`, `state`, and S256 challenge/method. Optional `request_id` is a requester-context hint only; the consent browser must hold that request's current private cookie. Errors stay on the issuer instead of redirecting to an unverified callback. Successful initiation sets an HttpOnly, SameSite=Lax, Secure-in-production cookie and opens local consent. Requests without signing configuration fail before creating registry records.

`POST /oauth/token` uses `application/x-www-form-urlencoded`, `client_id` and exact `resource` for both code and refresh grants. Code exchange also requires `code`, the exact registered `redirect_uri` and `code_verifier`; refresh requires `refresh_token` and may narrow `scope`. Basic/Bearer client authentication, client secrets and assertions are unsupported. `POST /oauth/revoke` takes the public `client_id`, exact `resource` and refresh credential as `token`, returning a neutral empty 200 for known/unknown tokens. Revocation works without signing configuration. Responses use no-store; protocol CORS never allows credentials. Body limits are 16 KiB/five seconds. Invalid bounded registration/authorization payloads charge database budgets; transport-level rejection never allocates a record.

Browser management is at `/connect/authorize` for hosts and `/connect/authorize?requestId=<uuid>` for a currently authorized requester. Setup/request workspaces link there. Permission lists page through at most 50 records; a different owner's cursor is rejected. Revoking permission does not approve or cancel a meeting. This API contract does not claim that MCP tools, CLI login or any named agent client is ready.

Protocol references: [client registration](https://www.rfc-editor.org/rfc/rfc7591.html), [authorization-server metadata](https://www.rfc-editor.org/rfc/rfc8414.html), and [protected-resource metadata](https://www.rfc-editor.org/rfc/rfc9728.html).

### Agent operation integration

The internal `AgentCredentials.verify` and `AgentOperations.execute` boundary is available for subsequent MCP/CLI integration. It verifies application tokens and routes only allowlisted setup/request operations through service-only `fmat_agent_operation`, with current authority and operation scope enforced in the domain transaction. Do not substitute ordinary browser credentials, forward bearer tokens into model inputs, or invoke domain RPCs directly from agent-supplied names. Decision permission opens an authenticated browser confirmation path; it does not create meeting approval. Public MCP and CLI now use this boundary; full workflow and named-client acceptance remain pending.


## Protected MCP resource

The application mounts `POST /mcp` using the official TypeScript server/client SDK packages pinned at 2.3.1. Native clients authenticate with an application OAuth Bearer token for the exact configured resource; Supabase/Google credentials and browser cookies do not grant tool access. Unauthenticated requests advertise `/.well-known/oauth-protected-resource/mcp`. The initial catalog covers fifteen operations; full scheduling coverage, CLI and individual named-client acceptance remain open in the [agent tools change](../../openspec/changes/deliver-agent-tools-and-cli/tasks.md).

`MCP_ALLOWED_ORIGINS` is an optional JSON array of at most twenty exact canonical origins, for explicitly supported browser-based MCP clients. The configured application origin is always allowed; native clients may omit Origin. HTTPS is required except for literal local development origins accepted by application configuration. Do not add wildcard origins or enable credentialed CORS. The default empty list requires no new production environment variable. Connection recovery uses `/connect/authorize`; insufficient-scope responses identify the permission to request. GET and DELETE are unsupported (405 after authentication), and no MCP session ID is issued.

Controlled live requester MCP acceptance passes against deployment `dpl_9Nh1NoY1JPKMjy5itXZhQpUEBcPH`: browser-granted access, official SDK calls, draft retry/conflict behavior, target/role/scope denial, narrowing and browser revocation. Fixture cleanup confirms no approval or booking and zero retained fixture records. See [acceptance evidence](05_rebuild_evidence.md#live-requester-mcp-acceptance--2026-10-08).

Host request discovery adds `fmat_list_requests` with host:read and no new environment variables. Deploy the reviewed `agent_request_discovery` migration before the web code. Browser list behavior remains shared; agent pagination additionally rejects cursors outside the host’s current request set. Full conversation reads and broader workflow coverage remain pending.

Requester availability tools: `fmat_get_availability` returns the same requester-owned status projection as the browser, including revision, windows, timezone and Calendar connection/failure state. `fmat_propose_availability` accepts bounded windows and an IANA timezone at an expected revision and creates a pending details review with the normal grant-scoped retry key. The requester applies it through the existing browser review. It does not replace Calendar mode, clear a failed read, select calendars, express agreement or book a meeting. Those distinctions remain true after the window review is applied; replacing Calendar availability still uses explicit browser confirmation.

Agent scheduling/booking review: `fmat_get_scheduling` invokes only the private evaluator's `current_context` branch after current OAuth authorization, then shares the browser candidate/proposal projection. It checks current rules, connection generations, local bookings and freshness without provider calls or evaluation writes. The browser evaluator rejects agent-shaped credentials. Request and host UPDATE locks precede OAuth locks to avoid concurrent SHARE-to-UPDATE upgrades. `fmat_get_booking_status` shares the browser's verified receipt projection; null receipt is not provider-confirmed booking. Closed requester grants remain denied and use the protected booking page for receipts. `fmat_review_connections` and `fmat_review_setup` return browser workspaces without consent or settings effects; decision review includes the current proposal version and a request-selected host URL. Browser confirmation always reads current state again.


### Agent intake activation and acceptance

The integrated intake application and all five migrations (`20261009010933_agent_intake_state.sql`, `20261009012319_agent_intake_authority.sql`, `20261009014902_agent_intake_creation.sql`, `20261009015759_agent_intake_operations.sql` and `20261009020556_agent_intake_handoff.sql`) were deployed to the selected release project on 2026-10-09 with source `0fefa59`. They provide service-only one-host consent, atomic one-request creation, bound requester operations and private browser handoff. See the [production rollout evidence](05_rebuild_evidence.md#agent-intake-production-rollout--2026-10-09) and [remaining acceptance tasks](../../openspec/changes/enable-agent-request-intake/tasks.md). No new Google scope, requester product account or provider credential is introduced by intake authorization.

The creation adapter requires `AGENT_INTAKE_PROOF_KEY`: canonical base64 of 32 random bytes, separate from `TOKEN_ENCRYPTION_KEY` and OAuth signing material. It is provisioned as a sensitive production Vercel variable. Never expose it through public environment variables, model inputs or CLI output. Preserve it across outstanding request credential lifetimes so same-browser handoff derives the original proof; do not regenerate it on startup or rotate it implicitly. SQL compares the derived proof hash with the immutable binding, so a different key cannot claim an existing request.

Intake authorization uses `scope=request:intake` with separately requested requester permissions and a `handle` query parameter. Do not supply `request_id`; the new request does not exist yet. Existing host and request consent retain their original requirements. The same issuer, resource, ES256 keys, S256 verifier and exact registered callbacks apply. Intake access tokens identify the intake subject, not a host or preexisting request; refresh may narrow scopes but cannot retarget authority. The consent page can grant/deny without sign-in and revoke through its HttpOnly browser binding. The deployed MCP adapter exposes context/create tools and bound requester operations; pending and foreign requests remain denied.

Local MCP verification uses the pinned official SDK against the built Next.js `/mcp` route and real local Supabase. A test-only Node preload substitutes the Google Calendar metadata boundary using an encrypted synthetic credential; production code has no fixture switch. The CLI supports `login intake --handle HANDLE`; see [initial requester intake](06_cli.md#initial-requester-intake). Actual local subprocess acceptance uses a temporary XDG configuration root and a test browser-launcher shim, with real loopback OAuth and the built app. It does not override the user home directory or touch real stored connections. No live Calendar write or provider message is sent by these tests.

Production verification covers account-free consent, SDK context/clarification, unavailable-Calendar denial, exact creation retry, bound read, original-browser handoff and revocation. The first controlled request was created through service-only SQL. This does not establish successful fresh MCP creation through real Calendar preflight; that remains required by task 4.1. Full scheduling workflows and each named client remain separate acceptance gates.

Public entry instruction version `2026-10-09.6` is deployed with the integrated intake application. Its pinned CLI source is `72645aa394dab7b474420b908ffad740c3b132c5`, which contains intake login and private storage. A document fetch alone is not a successful client connection. Missing client target/OAuth support must disclose the limitation and retain the CLI or browser fallback.

## Backup readiness

The selected project’s current backup inventory and private logical export are recorded in the [backup and restoration runbook](09_backup_recovery.md). An empty platform backup list and disabled PITR remain a release gap. Preserve application encryption material separately; do not treat migration rebuilds or encrypted file verification as a successful restore.

## Database rejection collection

`OPERATIONAL_REJECTIONS_ENABLED=true` enables best-effort, category-only observations of recognized database RPC denials and stale actions. It defaults to disabled in `.env.example`. Apply the reviewed rejection-observation migration before enabling it, and configure only the intended environment. Collection sends at most one additional RPC per recognized rejection, with a 250 ms independent deadline, and cannot replace the original result. Read [scope, counter bounds and operator usage](08_operational_diagnostics.md#database-rejection-observations) before interpreting counts. Production-only activation is verified for `findmeatime-release` and Supabase `mriseqztcwmezvtawnbo`; [deployment evidence](05_rebuild_evidence.md#rejection-observation-production-acceptance--2026-10-09) records the hosted collector check and coverage limits.

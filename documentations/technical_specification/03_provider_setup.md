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
- Register webhooks against the verified deployed receiver. The native eve Photon route, if selected by the runtime spike, is `/eve/v1/photon`; establish the AgentMail route during implementation. Identify and fence existing consumers before changing delivery routing.
- Keep the transactional sender `no-reply@findmeatime.com`; the web subdomain does not change the email sender domain.

Verify DNS, TLS, the expected deployment, Auth/Calendar returns, generated links and signed webhook delivery. See [domain operations](../../AGENTS.md#domain-and-dns).

## Selected rebuild Supabase project

Use **FindMeATime2**, project **`mriseqztcwmezvtawnbo`**: [project dashboard](https://supabase.com/dashboard/project/mriseqztcwmezvtawnbo). The CLI link was restored and matched against `SUPABASE_PROJECT_REF` and `SUPABASE_URL` on 2026-10-07. The initially empty project now has all fourteen migrations through `20261006230858_calendar_consent`. A subsequent dry run reports no pending migrations, and the remote security advisor reports no issues. Reconfirm the target before each remote operation.

Verify schema, Auth, SMTP and provider configuration against this project independently. Follow the [schema workflow](../../AGENTS.md#supabase-schema-changes), review migration SQL and run `supabase db push --dry-run` before a remote push. Never reset a remote database for local setup.

## Development skills and CLIs

Use Node.js 24 and npm 11. The repository pins Supabase CLI **2.119.0** and OpenSpec CLI **1.14.0**; verify installed versions before schema or specification work. Read the relevant [project skills](../../AGENTS.md#shared-skills), including the [Photon skill](../../.agents/skills/photon-cli/SKILL.md) and [AgentMail skill](../../.agents/skills/agentmail-cli/SKILL.md).

Check each CLI's help before provider operations. Provider CLIs do not automatically load this repository's `.env`; load only the required variables. Separate operator credentials used for provisioning from narrowly scoped application credentials.

## OpenAI model access through eve

Use eve's direct OpenAI provider, `openai(...)` from `eve/models/openai`, with server-side `OPENAI_API_KEY` and an explicit `OPENAI_MODEL`. The initial verified model is `gpt-6-luna`; `npm run verify:model` checks a synthetic structured tool call through the installed eve provider. Direct API calls use the intended OpenAI API organization's billing and applicable credits; ChatGPT/Codex subscription usage does not fund this API-key path.

A Gateway model string is a different routing choice. Verify direct provider routing, secret loading, model access and handling of authentication, rate-limit and exhausted-credit errors before claiming readiness. Failed model operations must not record scheduling success or approval. See [eve model configuration](https://github.com/vercel/eve/blob/d97f2a689299f7de74227b77450359c571a02dc9/docs/agent-config.md#L20-L48) and [OpenAI spend limits](https://developers.openai.com/api/docs/guides/spend-limits).

## Cloudflare Email Service

**Cloudflare Email Service is the selected transactional email provider** for host invitations, contact verification, recovery and booking confirmations. It also provides custom SMTP for Supabase Auth email. Runtime configuration uses `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN` and `CLOUDFLARE_EMAIL_FROM=no-reply@findmeatime.com`. Scope the token to Email Sending in the intended account and verify the sending domain's required DNS records.

Supabase Auth SMTP uses `smtp.mx.cloudflare.net`, port `465`, implicit TLS, username `api_token` and the Email Sending token as password. The retained configuration tool supports a redacted preview and explicit application:

```sh
node --env-file=.env scripts/configure-email-smtp.mjs
node --env-file=.env scripts/configure-email-smtp.mjs --apply
```

The tool requires matching project reference, URL and CLI link. Apply mode also requires operator-only `SUPABASE_ACCESS_TOKEN`, rejects an overriding Send Email Auth Hook and verifies settings by readback. Configuration readback does not prove inbox delivery; verify controlled Auth and transactional messages through the deployed application.

On 2026-10-07, the selected project's Auth Site URL, release/local `/auth/callback` allowlist and Cloudflare SMTP were configured through authenticated Supabase CLI 2.119.0. A sparse config in an ignored work directory declared only `[auth].site_url`, `additional_redirect_urls` and `[auth.email.smtp]`; the SMTP password references `env(CLOUDFLARE_EMAIL_API_TOKEN)`. `supabase config diff --workdir <sparse-workdir> --project-ref mriseqztcwmezvtawnbo --output-format json` previews declared changes, and `supabase config push` with the same target/workdir applies them. Load the token into that process environment without printing it. CLI authentication can use its existing login; the repository SMTP script separately requires a Management API token.

Inspect the diff before pushing: undeclared remote-only settings must remain untouched, including Google Auth and MFA. Do not push the full local-development config to production. Readback found no declared differences; this confirms callback/SMTP configuration, while controlled production Auth inbox delivery remains unverified. Local browser tests use Mailpit and do not establish Cloudflare delivery.

References: [Cloudflare Email Service](https://developers.cloudflare.com/email-service/), [Cloudflare SMTP](https://developers.cloudflare.com/email-service/api/send-emails/smtp/), [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## AgentMail

AgentMail owns requester conversational inboxes and threads. Configure `AGENTMAIL_API_KEY`, `AGENTMAIL_POD_ID` and `AGENTMAIL_INBOX_ID` for the intended application resources. Use narrowly scoped `inbox_read`, `message_read` and `message_send` permissions; reserve provisioning and webhook administration for operator credentials.

Store the receiver signing secret as `AGENTMAIL_WEBHOOK_SECRET`; it is distinct from the API key. Verify signed ingestion, sender binding, request/thread mapping, deduplication, replies and uncertain-send recovery under the [compatibility gates](04_implementation_plan.md#compatibility-gates).

Inspection on 2026-10-07 with installed CLI 1.9.0 confirms that the configured development inbox is readable. The configured runtime key cannot list webhooks (`403 missing_permission`, missing `webhook_read`). Use an appropriately scoped operator credential to establish consumer ownership and webhook configuration; do not broaden the runtime key or send private Auth links into an inbox whose consumers are unverified.

References: [AgentMail quickstart](https://docs.agentmail.to/quickstart), [webhook verification](https://www.agentmail.to/docs/webhook-verification).

## Photon

Configure `PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET` for the intended project. These local names map to the SDK's `projectId` and `projectSecret`. For native eve webhook integration, configure the adapter's `webhookSecret` using the server-only `IMESSAGE_WEBHOOK_SECRET`; verify its signature handling during the runtime spike.

Verify target eligibility and actual sender routing for each controlled recipient. Do not infer an iMessage handle from Google email or assume one public sender number for shared-pool conversations. Validate Node runtime compatibility and recovery before deciding whether a separate bridge is necessary.

References: [Photon CLI skill](../../.agents/skills/photon-cli/SKILL.md), [routing](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing), [target policy](https://photon.codes/docs/spectrum-ts/troubleshooting/imessage#target-not-allowed-for-this-project).

### First message and host onboarding

The proposed host flow offers **Connect iMessage** inside authenticated chat: enter a private number, receive a six-digit code in that conversation, then enter it in a protected browser input to confirm the link. Keep code values out of model context, transcripts and logs. Neither requesting a code nor receiving an inbound message establishes host authority, notification consent or proposal approval.

Verify live delivery and shared-pool eligibility before enabling the flow. Offer web continuation when linking fails. The [host setup conversation](02_frontend_architecture.md#host-setup-conversation) and [pending OpenSpec change](../../openspec/changes/conversational-host-setup/proposal.md) own the UX and authorization contract. See [Photon deliverability guidance](https://photon.codes/docs/best-practices/imessage-deliverability).

### Display name, contact cards, and profile sync

The proposed optional **Add to contacts** action uses the verified sender route for that user's private conversation. The user chooses whether to save it. Contact saving does not establish identity or consent.

Verify provider profile-sync support and device-side display before claiming that the product name appears automatically. A delivered contact attachment alone proves neither import nor displayed name. See [native contact sharing](https://photon.codes/docs/spectrum-ts/providers/imessage/messaging-features/contact-card-sharing) and [custom contacts](https://photon.codes/docs/spectrum-ts/content/contacts).

## Host invitation operations

Implement operator issuance and revocation against the [host-admission contract](../../openspec/specs/host-admission/spec.md) and [email-delivery contract](../../openspec/specs/email-delivery/spec.md). No invitation CLI is currently implemented.

The operator boundary must identify the intended project and operator, reject public credentials and prevent ordinary hosts or guests from issuing invitations. Remote issuance uses configured Cloudflare delivery unless manual delivery is explicitly selected; local issuance and revocation do not send email.

Persist private dispatch intent before sending, keep one-time codes out of URLs/logs and reconcile uncertain outcomes without automatic resend or reissuance. Invitation revocation blocks redemption; revoking existing host access is a separate operation.

## Google Calendar consent configuration

Configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the server. Register `/connections/google/callback` on the release origin and `http://localhost:3000` for direct Calendar consent. Supabase Auth returns use `/auth/callback` instead. Preserve unrelated registered callbacks until their consumers are identified.

Begin consent through a same-origin endpoint with short-lived, single-use state bound to the initiating browser and verified host or protected request. Use HttpOnly, SameSite=Lax cookies, Secure in production, and a restricted return destination. Separate identity sign-in from Calendar consent.

| Principal | Requested Google scopes | Authority |
|---|---|---|
| Host | `openid`, `email`, `calendar.readonly`, `calendar.events` | Read selected host context; create events only in the selected writable destination after current agreement and approval. |
| Requester | `openid`, `email`, `calendar.freebusy` | Availability for one authorized request; no host admission or event creation. |

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

# Provider setup

Historical provider checks: 2026-10-05 (Asia/Seoul)
Source-removal update: 2026-10-07

Status: retained provider configuration and historical development evidence. The application source, including the scheduling backend and Photon bridge, is being rebuilt under the [implementation plan](04_implementation_plan.md). Provider choices and external resources remain selected unless a later decision changes them, but the former adapters, deployment topology, commands and passing tests do not establish replacement readiness.

Credentials live in the ignored root `.env`, with file mode `0600`; share variable names through [`.env.example`](../../.env.example), not credential values. Existing OpenAI, Supabase, Google, AgentMail, Cloudflare and Photon values were preserved. Local configuration does not deploy secrets to Supabase. Do not delete or rotate provider resources merely because their application code is being replaced.

The former app/API/bridge and executable probe commands below were removed on 2026-10-07. Treat them as historical evidence, not executable setup instructions. [Source removal](../archive/2026-10-07-source-removal.md) records recovery; SMTP configuration tooling remains available.

## Reconstruction deployment origin

Selected on 2026-10-07: **`https://release.findmeatime.com`** is the canonical origin for the reconstructed application, paired with Supabase project `mriseqztcwmezvtawnbo`. This is a deployment target; DNS, domain attachment, callbacks and HTTPS readiness remain unverified.

- Attach `release.findmeatime.com` to the intended Vercel rebuild project. Obtain its exact DNS requirements with `vercel domains inspect release.findmeatime.com`, then configure the subdomain through Cloudflare with DNS-only records. Preserve root-domain, mail and unrelated records.
- Set the rebuilt application's public origin and the selected Supabase project's Auth Site URL to `https://release.findmeatime.com`; allow the exact app return URL `https://release.findmeatime.com/auth/callback` and separately approved local callbacks. Provider-side Supabase Auth redirects remain the selected project's provider callback, not the app callback.
- Register direct Calendar consent at `https://release.findmeatime.com/connections/google/callback`. Bind consent to this origin; preserve unrelated registered callbacks until their consumers are identified.
- Generate reconstruction invitations, host booking links, `/booking/[bookingId]` continuations and public skill links from this configured origin. Root-domain product examples elsewhere describe the route shape; reconstruction links use the release subdomain.
- Register replacement webhooks against the deployed receiver on this origin where the receiver is co-deployed. The native eve Photon route, if selected by the runtime spike, is `https://release.findmeatime.com/eve/v1/photon`; confirm the actual AgentMail receiver path before registration. Fence former consumers before changing delivery routing.
- Keep the transactional sender `no-reply@findmeatime.com`; selecting a web subdomain does not change the sending domain. A later move to the root domain requires a separate deployment decision.

Verify DNS, TLS, the expected deployment, Auth/Calendar returns, generated links and signed webhook delivery before claiming readiness. This document records the target without applying external configuration.

## Selected rebuild Supabase project

Use **`mriseqztcwmezvtawnbo`** for the new rebuild. The owner selected it on 2026-10-06. [Project dashboard](https://supabase.com/dashboard/project/mriseqztcwmezvtawnbo). The former project `anelszynxtvxoxqvzgqt` remains historical infrastructure, not the rebuild deployment target. Its credentials, users, provider grants, SMTP settings and deployed functions must not be assumed present in the selected project. Keep historical references unchanged and verify replacement configuration against the selected project explicitly.

Access and local configuration were verified on 2026-10-06: the project is **FindMeATime2**, region **us-west-1**, status `ACTIVE_HEALTHY`. Supabase CLI **2.119.0** linked the main checkout after access was granted; the CLI link and ignored root `.env` now target it with matching publishable and server-only secret keys. Read-only Auth settings and Data API metadata checks returned HTTP 200. Former project credentials were preserved in ignored `.local/rebuild/previous-supabase.env` with file mode `0600`; unrelated provider settings were preserved. This establishes project access and credential consistency, not replacement readiness. Remote schema, functions, SMTP and Auth configuration have not been deployed or copied by this step. Review replacement setup before deploying; old scripts are historical reference rather than a rebuild bootstrap.

## Development skills and CLIs

Repository skills include Supabase, PostgreSQL best practices, OpenSpec, shadcn, and the copied AgentMail CLI, Photon CLI, OpenAI documentation, and skill-creator skills. These additions came from the installed local skills. AgentMail and Photon instructions include compatibility notes for the installed CLIs.

- AgentMail CLI: `1.8.0`, authenticated through macOS Keychain. Use `agentmail auth status` to inspect credential availability. Commands use `--format json` and `--query` for projections.
- Photon CLI: `2.2.0`, authenticated through its saved CLI login. Use `photon whoami`; this command does not accept `--json`. Resource commands such as `photon projects list --json` do.

These CLIs do not automatically load this repository's `.env`. Load the required variables into the process environment when running application-scoped checks. Keep admin CLI credentials separate from application credentials, and avoid commands that print secrets into logs.

## OpenAI model access through eve

Rebuild decision, 2026-10-06: use eve's direct OpenAI provider with a server-side `OPENAI_API_KEY` from the OpenAI API organization/project holding the intended API credits. API requests use that organization's API billing and applicable credit balance. ChatGPT/Codex subscription usage and credits do not fund this API-key path. Hosting, database and messaging charges remain separate. See [OpenAI spend and prepaid credits](https://developers.openai.com/api/docs/guides/spend-limits) and [Codex API-key billing](https://learn.chatgpt.com/docs/pricing).

The intended configuration shape is:

```ts
import { defineAgent } from "eve";
import { openai } from "eve/models/openai";

export default defineAgent({
  model: openai(process.env.OPENAI_MODEL),
});
```

Set `OPENAI_MODEL` to the native OpenAI model ID selected and verified during the runtime spike; require it in the replacement's startup configuration rather than relying on a moving default. The existing example's model value is historical configuration, not a newly verified model selection. Keep both provider configuration and `OPENAI_API_KEY` in the server environment; never expose the key in browser code, model context or logs. The ignored local `.env` does not populate deployment secrets automatically.

In eve, a string such as `model: "openai/model-name"` selects Vercel AI Gateway routing. It does not automatically consume the direct `OPENAI_API_KEY` or its credit balance. Use the `openai(...)` helper for this rebuild; Gateway is not required for the selected model path. eve's local `chatgpt()` subscription-login option is documented as non-deployable and is not the production configuration. See [eve model configuration](https://github.com/vercel/eve/blob/d97f2a689299f7de74227b77450359c571a02dc9/docs/agent-config.md#L20-L48) and [direct-provider API reference](https://github.com/vercel/eve/blob/d97f2a689299f7de74227b77450359c571a02dc9/docs/reference/typescript-api.md#L159-L178).

This records provider selection only. The credit balance, model entitlement and rebuilt runtime call have not been verified. The runtime spike must verify the selected model, direct provider route, server secret loading and handling of authentication, rate-limit and exhausted-credit failures without recording scheduling success or approval.

## Cloudflare Email Service

Use Cloudflare Email Service as the sender for operator invitations and application-owned verification, recovery, and booking messages, and as the custom SMTP transport for Supabase Auth. Keep Supabase Auth as the identity system. Runtime sends require `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`, and `CLOUDFLARE_EMAIL_FROM`; the token needs the narrow Email Sending permission for the intended account. Share only these names through [`.env.example`](../../.env.example). [Cloudflare Email Service](https://developers.cloudflare.com/email-service/), [send email](https://developers.cloudflare.com/email-service/get-started/send-emails/)

The `findmeatime.com` sending domain is registered in Cloudflare Email Service with `enabled: true`, `preview_enabled: true`, a quota of **100 messages per day**, and **zero emails sent at setup**. Cloudflare reports the required SPF, DKIM, DMARC, and bounce MX records ready. A scoped account-owned Email Sending token was created without replacing the other ignored `.env` credentials. SMTP implicit-TLS connection and token login returned status `235`; `MAIL FROM:<no-reply@findmeatime.com>` returned `250`, followed by `RSET` without recipients or DATA. No message was submitted. Sending is configured, but actual delivery remains untested and must not be described as verified. `preview_enabled` controls message previews in the activity log, not recipient restrictions. [Subdomain settings](https://developers.cloudflare.com/api/resources/email_sending/subresources/subdomains/methods/edit/)

Supabase Auth custom SMTP uses `smtp.mx.cloudflare.net` on port `465` with implicit TLS. The username is the literal `api_token`; the password is the Cloudflare Email Sending token; the From address is `CLOUDFLARE_EMAIL_FROM`. The following commands belong to the former implementation and remain historical operator reference until the replacement provides and verifies its own configuration command:

```sh
node --env-file=.env scripts/configure-email-smtp.mjs
node --env-file=.env scripts/configure-email-smtp.mjs --apply
```

The former default command printed a redacted preview. Its `--apply` mode updated the intended Supabase project's Auth SMTP settings and required `SUPABASE_ACCESS_TOKEN`; that management token remains an operator credential and must not be deployed as an application runtime secret. For project `anelszynxtvxoxqvzgqt`, the applied configuration was re-read as `smtp.mx.cloudflare.net:465`, user `api_token`, From `no-reply@findmeatime.com`, and sender name `Find Me a Time`. The readback proves configuration, not delivery or replacement integration; perform a controlled Auth email test through the rebuilt application before marking mail delivery verified. [Cloudflare SMTP](https://developers.cloudflare.com/email-service/api/send-emails/smtp/), [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

The root-domain sender supersedes the initial `mail.findmeatime.com` rollout. The deployed runtime sender secret was updated to `no-reply@findmeatime.com` and its hash matched on readback. Old subdomain DNS remains for historical sender identities; new mail uses the root domain. Website DNS and AgentMail resources were preserved.

## AgentMail

Created a development pod named **Find Me a Time Development**, with inbox **findmeatime-dev@agentmail.to**. The root `.env` contains `AGENTMAIL_POD_ID`, `AGENTMAIL_INBOX_ID`, and `AGENTMAIL_API_KEY`.

The application key is scoped to this pod and has only `inbox_read`, `message_read`, and `message_send` permissions. Inbox provisioning and webhook administration use the operator's CLI credentials. The initial application-key check returned only the development inbox. A later P0 probe created one fresh, marked fixture in this pod and sent two controlled emails only to itself; existing inboxes were preserved. The application key could read that fixture with HTTP 200. Actual signed sent/delivered webhooks, same-key send/reply recovery, changed-payload 409 and sent-parent thread matching passed. The self-send remained sent-only. A later probe reverified the original development inbox and marked fixture as two distinct product-controlled identities, sent exactly two emails between them, and proved received-parent replies, inbox-local threading, six signed sent/delivered/received callbacks, and idempotent recovery. No additional inbox or human recipient was used. See the [compatibility evidence](../archive/2026-10-06-compatibility_report.md#controlled-agentmail-probe).

For replacement conversational email, register a webhook only after a receiver with signature verification has a stable HTTPS URL. The disposable P0 receivers used temporary Cloudflare Quick Tunnels and exact one-inbox or two-inbox filters; their task-created webhooks were deleted and the receivers/tunnels stopped after capture. For the replacement endpoint, save its signing secret as `AGENTMAIL_WEBHOOK_SECRET`; the API key is not the webhook signing secret. AgentMail remains the managed requester conversation inbox/thread provider; Cloudflare Email Service owns transactional sending and Supabase Auth SMTP. The replacement must independently verify ingestion, sender binding, deduplication, replies and uncertain-send recovery.

References: [AgentMail quickstart](https://docs.agentmail.to/quickstart), [webhook verification](https://www.agentmail.to/docs/webhook-verification).

## Photon

Reused the existing **findmeatime** project, ID `3244ea18-c2c1-4727-80d4-7d7ea4d091ef`, on the free plan. Saved `PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET` in `.env` by reading the existing secret, without rotating it. These names are our configuration convention: pass their values explicitly as the SDK's `projectId` and `projectSecret`.

Verified account access and that `imessage` is enabled. The project's assigned-line list was empty; free plans use a shared pool, so this does not establish a missing dedicated-line configuration. No paid upgrade or dedicated line was provisioned. Subsequent controlled tests verified SDK access, outbound delivery, and an exact inbound reply; application identity binding and production channel integration remain open. See the [Photon compatibility evidence](../archive/2026-10-06-compatibility_report.md#photon-transport-probe).

The reserved-address SDK probe later initialized successfully but returned `Target not allowed for this project` for its unregistered target. Free/Pro shared-pool recipients must match a project User's actual iMessage phone number or email. This policy denial is not evidence that the project secret is invalid. Register a user-designated controlled recipient without requesting an onboarding invite, then verify availability before an explicitly authorized test message. Do not infer the iMessage handle from a Google account address. [Shared-target troubleshooting](https://photon.codes/docs/spectrum-ts/troubleshooting/imessage#target-not-allowed-for-this-project).

A user-designated controlled phone number was subsequently registered and independently verified without an onboarding invite. The first explicitly authorized shared-DM write, with retries disabled and a durable refusal fence, returned the same target-policy denial. A later read-only check returned available, and a newly authorized single-message retest received the exact expected reply. The earlier denial is historical evidence, not the current controlled recipient's status. The [controlled probe guide](../../scripts/p0/photon-controlled-conversation-README.md) documents private authorization, bounded targeted observation, and the permanent no-resend guard. No credentials were rotated and no paid plan was added.

The checked cloud iMessage SDK documented Node.js or Bun with Node-compatible gRPC. The local Node transport test does not establish compatibility with another runtime. The old bridge source is within the replacement boundary; final process placement is unresolved and must be recorded after the eve/runtime check. No provider evidence requires the rebuilt scheduling API to retain its former Deno Edge placement.

References: [Photon CLI skill](../../.agents/skills/photon-cli/SKILL.md), [shared and dedicated line routing](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing), [runtime compatibility](https://photon.codes/docs/spectrum-ts/providers/imessage#runtime-compatibility).

### First message and host onboarding

Photon's **Stable** documentation, checked on 2026-10-05, supports initiating a DM by resolving the recipient's iMessage phone number or email, creating a space with `im.space.create(user)`, and sending through that space. The recipient does not technically need to text first. Provider target policy still applies, including registered project Users on Free/Pro shared-pool plans. The documented default quota is **50 new conversations initiated per line per day**; replies within existing conversations do not count. The later controlled retest verified initiation and an inbound reply for one registered recipient; it does not establish routing for every user. [Creating conversations and quotas](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing), [shared-target policy](https://photon.codes/docs/spectrum-ts/troubleshooting/imessage#target-not-allowed-for-this-project).

Photon strongly recommends that users initiate conversations for deliverability. Messages sent first from an unknown number can expose the “Report Junk” action, and repeated unanswered outreach increases filtering risk. Photon recommends a deep link that opens Messages with a prefilled first message for the user to send, followed by contact-card sharing after the first exchange. [iMessage deliverability](https://photon.codes/docs/best-practices/imessage-deliverability).

The proposed rebuild flow starts from the authenticated host account with a six-digit code sent to the host's chosen private iMessage number. The host enters the received code in the initiating browser; only then may the replacement bind that exact sender and private conversation. This remains a proposed behavior delta requiring reconciliation with the conversational-host-setup change before implementation. A first inbound message or an outbound code request alone does not establish host identity, notification consent or proposal approval. Shared-pool onboarding must validate the recipient's assigned route rather than assume one public number for all hosts. The former `LINK` handoff is not a compatibility requirement. See the [host setup conversation](02_frontend_architecture.md#host-setup-conversation) and [page list](../user_experience/04_page_list.md).

### Historical Fly.io bridge hosting

The former bridge ran in a separate Node 24 container under `apps/photon-bridge`, while the website ran on Vercel and the backend on Supabase. On October 5, 2026, the official Homebrew Fly CLI updated to `0.4.111`, authenticated successfully, and reserved `fmat-photon-bridge` in the `personal` organization. Strict Fly configuration validation and local Linux/amd64 container checks passed. Initial [preparation evidence](../../scripts/p0/fly-bridge-preparation-2026-10-05.json) recorded zero Machines; later [deployment evidence](../../scripts/p0/fly-bridge-live-results-2026-10-05.json) recorded a healthy singleton.

That development deployment is external state to preserve deliberately, not the required topology for the replacement. Its historical health, restart and authorization checks do not certify rebuilt code. Before any controlled replacement test, identify and fence existing consumers so that old and new processes cannot both send messages. The rebuilt adapter must prove restart recovery, scoped backend access, deduplication and a real linked-host journey before launch.

### Display name, contact cards, and profile sync

On 2026-10-05, the project profile was set to `firstName: "Find Me a Time"`, `lastName: ""`, with no avatar. The installed Photon CLI **2.2.0** uses `--first-name` and `--last-name`, not `--display-name`. With `PHOTON_PROJECT_ID` loaded into the shell, the supported commands are:

```sh
photon spectrum profile update --project "$PHOTON_PROJECT_ID" \
  --first-name 'Find Me a Time' --last-name '' --json
photon spectrum profile sync --project "$PHOTON_PROJECT_ID" --json
```

`imessageSynced` is an observed synchronization status, not a writable profile option. The profile-update API accepts the name fields; the separate sync endpoint targets active dedicated iMessage lines. On this Free/shared project, the actual sync call returned `targetedLineCount: 0`, and a subsequent profile read still returned `imessageSynced: false`. Setting the project name alone did not make the name appear on the test recipient's device. A successful sync API response does not by itself verify Apple's device-side name display. No paid upgrade or dedicated line was provisioned. [Spectrum API schema](https://spectrum.photon.codes/openapi/json).

Native contact-card sharing uses Apple's **Share Name and Photo** signal. Spectrum 12.10.1 gates automatic sharing on `imessageSynced === true`; this native path was not tested here. A custom `.vcf` attachment is a separate option that the recipient can open and add to Contacts. Saving that attachment does not change the project's `imessageSynced` status. [Native sharing](https://photon.codes/docs/spectrum-ts/providers/imessage/messaging-features/contact-card-sharing), [SDK automatic-sharing gate](https://github.com/photon-hq/spectrum-ts/blob/main/packages/imessage/src/remote/profile-sync-gate.ts), [custom contacts](https://photon.codes/docs/spectrum-ts/content/contacts), [Apple contact import](https://support.apple.com/guide/iphone/import-contacts-iph356499f31/ios).

The authorized contact-card test sent exactly one `.vcf` containing **Find Me a Time**, the verified actual sender number for that private conversation, and `https://findmeatime.com`. It contained no photo or logo. The provider accepted the attachment at **14:09:22 KST on 2026-10-05**; a read-only check confirmed `is_sent: true`, `delivered: true`, and `send_error_code: 0`. The [redacted delivery receipt](../../scripts/p0/photon-contact-card-results-2026-10-05.json) excludes recipient numbers, sender numbers, and message identifiers. The recipient's final displayed name remains unverified; delivery alone does not prove contact import or name display.

For the proposed onboarding flow, offer an optional **Add to contacts** step after the first exchange. Build the card from the verified sender route for that user's conversation; do not hardcode a shared-pool number as the product's universal number. Explain that the user opens the card and saves the contact. This remains proposed P6 UX, and contact storage does not establish host identity, notification consent, or proposal approval.


## Host invitation operations

The replacement must preserve trusted operator issuance, recipient-bound single redemption, expiry, revocation, audit identity and separation from host access revocation. Public, anonymous and ordinary authenticated clients must not invoke the privileged issuance boundary.

The former [manage-invitations.mjs](https://github.com/snuhcs-course/swpp-2026-project-team-01/blob/981c08c33518c7b16135a50f2df9b0c3d774cd5d/scripts/manage-invitations.mjs) called the service-only `public.fmat_command` RPC. Its mandatory `--operator-id` identified the operator in the audit record; it was an audit identity supplied by the trusted privileged operator, not a public authorization credential. Do not treat the script or RPC name as a replacement compatibility requirement.

The former CLI required Node.js 24 or later and loaded remote operator configuration from the ignored root `.env`. Its project reference and exact Supabase origin had to match `supabase/.temp/project-ref`; only a server-side secret/service-role key could invoke the RPC. These safeguards remain requirements for any replacement operator tool: identify the intended project explicitly, reject publishable/anon/user keys and mismatched hosts, and keep privileged keys out of browser configuration and terminal history. [Supabase API key privileges](https://supabase.com/docs/guides/getting-started/api-keys).

The former remote issue command sent through Cloudflare by default using `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`, and `CLOUDFLARE_EMAIL_FROM=no-reply@findmeatime.com`. The replacement must fail before issuance when required sender configuration is missing, make manual delivery explicit, and avoid email on local issue and revocation operations.

Historical command shape:

```sh
node --env-file=.env scripts/manage-invitations.mjs issue \
  --project-ref <linked-reference> --operator-id <operator-identity> \
  --email <recipient-email> --app-origin https://findmeatime.com

node --env-file=.env scripts/manage-invitations.mjs revoke \
  --project-ref <linked-reference> --operator-id <operator-identity> \
  --invitation-id <issued-invitation-uuid>
```

The retained behavior generates a 16-character invitation code from 80 random bits, formatted as `XXXX-XXXX-XXXX-XXXX`, and stores only its SHA-256 hash. Bind it to the normalized recipient email and expire it within seven days. After confirmed remote issuance, Cloudflare sends one message containing the code, expiry, `/app` URL, and instructions to sign in with the same verified email. The URL omits the code; the recipient enters it after verified sign-in. The replacement does not need to accept former long tokens or preserve old endpoint names because the product has not launched.

Operator output containing a one-time code remains private. Before an external send, persist a protected dispatch intent and immutable payload so uncertain outcomes can be reconciled without blind resend. If local receipts are used, keep them ignored with file mode `0600` inside a `0700` directory. Provider acceptance means neither inbox arrival nor redemption.

The recipient must sign in with the same verified email. Redemption atomically consumes the invitation and admits that account. Same-account retries return saved admission. Wrong recipients, expired/revoked codes, and reuse by another account fail. Revocation blocks further redemption; it does not revoke an already admitted host. Host access revocation is a separate administrative operation.

Do not automatically repeat an uncertain issuance or email send. Inspect the operator audit, invitation records, dispatch record and provider activity before acting. Email failure does not itself revoke or reissue the invitation; creating another invitation is a distinct audited action.

## Google Calendar consent configuration

The former registered Google redirect URIs were **`https://findmeatime.com/api/google/callback`** and **`http://localhost:5173/api/google/callback`**. The replacement page contract uses **`/connections/google/callback`**. Register `https://release.findmeatime.com/connections/google/callback` and the canonical local callback on the intended Google OAuth web client before controlled replacement testing, while preserving unrelated callbacks until their consumers are identified. Set the deployed application origin to `https://release.findmeatime.com`; configure Supabase Auth returns as described in [reconstruction deployment origin](#reconstruction-deployment-origin).

Browser consent starts through a same-origin application endpoint. The replacement must bind a short-lived, HttpOnly, SameSite=Lax state cookie to the initiating browser and verified host or protected request, make state single-use, and restrict the callback return destination. Use Secure cookies in production. Calling an internal service origin directly from the browser can place the binding cookie on the wrong origin. Exact route placement belongs to the rebuilt server boundary, not the former Vercel rewrite or Vite proxy.

Host sign-in and Calendar consent are separate steps. Retain the former least-privilege baseline below unless the owning requirements approve a change; rebuilt source must define and verify its own requested and granted scopes:

| Principal | Requested Google scopes | Authority |
|---|---|---|
| Host | `openid`, `email`, `calendar.readonly`, `calendar.events` | Read selected host context and create events only through the selected writable booking calendar after current agreement/approval |
| Requester | `openid`, `email`, `calendar.freebusy` | Availability for one authorized request; no host admission, host context, or event creation |

Calendar scope names above use the `https://www.googleapis.com/auth/` prefix. Requester `calendar.freebusy` supplies availability on the requester's own calendar and is accepted by Google's free/busy query API. Validate the exact granted scope during live consent. [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [free/busy query scopes](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query).

In the Google console scope picker, email-address access appears as `https://www.googleapis.com/auth/userinfo.email`. The authorization request can use the OpenID Connect scope `email`, as the former implementation did. This identifies the account's email address; mailbox contents require separate Gmail scopes. `openid` identifies the Google account. [Google scope catalog](https://developers.google.com/identity/protocols/oauth2/scopes), [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

The host's `calendar.readonly` scope permits calendar and event reads; `calendar.events` permits event reads and writes, including modifications beyond creating a meeting. The application enforces the selected booking calendar and current agreement/approval checks. Those restrictions are application policy, not a creation-only Google permission. The broader `calendar` scope is not requested.

Offline consent uses `access_type=offline` and `prompt=consent`; these are request parameters, not additional scopes. Refresh credentials are encrypted and stored only server-side. A missing/expired refresh token, `invalid_grant`, revoked consent, or failed required read produces a reconnection action; none become an empty calendar. Optional requester denial still permits explicit manual availability. Calendar consent grants neither requester agreement nor host approval.

Google OAuth apps configured as External/Testing generally receive seven-day refresh-token lifetimes for Calendar scopes. Inspect publishing/verification status before claiming production continuity, and demonstrate actual consent and refresh with controlled identities. A credential inventory or fixture test cannot prove this. [Google OAuth web flow](https://developers.google.com/identity/protocols/oauth2/web-server), [refresh-token expiration](https://developers.google.com/identity/protocols/oauth2).

Requester event-detail access, requester travel based on private event locations, Gmail mailbox access and host conversational email are outside the confirmed rebuild scope. AgentMail remains the requester email transport. Add any of these extensions only through an explicit requirements change; do not add their scopes to the replacement consent flow by default.

## Local setup and historical verification

Use `http://localhost:3000` as the canonical Next.js local origin, with `/auth/callback` for application Auth returns and `/connections/google/callback` for direct Calendar consent; keep browser API requests same-origin. Local Supabase configuration records the Auth origin/return, but no remote provider callbacks were changed by source removal. Keep local and remote privileged credentials separate, disable external sends in local fixtures, persist encryption keys in ignored secret storage, and migrate key rotation explicitly. A fresh key on restart makes stored provider grants unreadable. Never reset a remote database for local setup.

The [archived local procedure](../archive/2026-10-06-compatibility_report.md#historical-local-setup-procedure) retains old Vite/Deno commands, ports and environment names. The [archived setup evidence](../archive/2026-10-06-compatibility_report.md#former-host-setup-operations-and-evidence) retains dated invitation and Calendar checks. Those results must not be presented as verification of the rebuilt app or selected Supabase project.

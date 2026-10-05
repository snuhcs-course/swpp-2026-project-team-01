# Provider setup

Setup checked on 2026-10-05. Credentials live in the ignored root `.env`, with file mode `0600`; share variable names through [`.env.example`](../../.env.example), not credential values. Existing OpenAI, Supabase, and Google values were preserved. Local configuration does not deploy secrets to Supabase.

## Development skills and CLIs

Repository skills include Supabase, PostgreSQL best practices, OpenSpec, shadcn, and the copied AgentMail CLI, Photon CLI, OpenAI documentation, and skill-creator skills. These additions came from the installed local skills. AgentMail and Photon instructions include compatibility notes for the installed CLIs.

- AgentMail CLI: `1.8.0`, authenticated through macOS Keychain. Use `agentmail auth status` to inspect credential availability. Commands use `--format json` and `--query` for projections.
- Photon CLI: `2.2.0`, authenticated through its saved CLI login. Use `photon whoami`; this command does not accept `--json`. Resource commands such as `photon projects list --json` do.

These CLIs do not automatically load this repository's `.env`. Load the required variables into the process environment when running application-scoped checks. Keep admin CLI credentials separate from application credentials, and avoid commands that print secrets into logs.

## Cloudflare Email Service

Use Cloudflare Email Service as the sender for operator invitations and application-owned verification, recovery, and booking messages, and as the custom SMTP transport for Supabase Auth. Keep Supabase Auth as the identity system. Runtime sends require `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`, and `CLOUDFLARE_EMAIL_FROM`; the token needs the narrow Email Sending permission for the intended account. Share only these names through [`.env.example`](../../.env.example). [Cloudflare Email Service](https://developers.cloudflare.com/email-service/), [send email](https://developers.cloudflare.com/email-service/get-started/send-emails/)

The `findmeatime.com` sending domain is registered in Cloudflare Email Service with `enabled: true`, `preview_enabled: true`, a quota of **100 messages per day**, and **zero emails sent at setup**. Cloudflare reports the required SPF, DKIM, DMARC, and bounce MX records ready. A scoped account-owned Email Sending token was created without replacing the other ignored `.env` credentials. SMTP implicit-TLS connection and token login returned status `235`; `MAIL FROM:<no-reply@findmeatime.com>` returned `250`, followed by `RSET` without recipients or DATA. No message was submitted. Sending is configured, but actual delivery remains untested and must not be described as verified. `preview_enabled` controls message previews in the activity log, not recipient restrictions. [Subdomain settings](https://developers.cloudflare.com/api/resources/email_sending/subresources/subdomains/methods/edit/)

Supabase Auth custom SMTP uses `smtp.mx.cloudflare.net` on port `465` with implicit TLS. The username is the literal `api_token`; the password is the Cloudflare Email Sending token; the From address is `CLOUDFLARE_EMAIL_FROM`. Preview the repository-managed configuration before applying it:

```sh
node --env-file=.env scripts/configure-email-smtp.mjs
node --env-file=.env scripts/configure-email-smtp.mjs --apply
```

The default command prints a redacted preview. `--apply` updates the intended Supabase project's Auth SMTP settings and requires `SUPABASE_ACCESS_TOKEN`; that management token is an operator credential and must not be deployed as an application runtime secret. For project `anelszynxtvxoxqvzgqt`, the applied configuration was re-read as `smtp.mx.cloudflare.net:465`, user `api_token`, From `no-reply@findmeatime.com`, and sender name `Find Me a Time`. The readback proves configuration, not delivery; perform a controlled Auth email test before marking mail delivery verified. [Cloudflare SMTP](https://developers.cloudflare.com/email-service/api/send-emails/smtp/), [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

The root-domain sender supersedes the initial `mail.findmeatime.com` rollout. The deployed runtime sender secret was updated to `no-reply@findmeatime.com` and its hash matched on readback. Old subdomain DNS remains for historical sender identities; new mail uses the root domain. Website DNS and AgentMail resources were preserved.

## AgentMail

Created a development pod named **Find Me a Time Development**, with inbox **findmeatime-dev@agentmail.to**. The root `.env` contains `AGENTMAIL_POD_ID`, `AGENTMAIL_INBOX_ID`, and `AGENTMAIL_API_KEY`.

The application key is scoped to this pod and has only `inbox_read`, `message_read`, and `message_send` permissions. Inbox provisioning and webhook administration use the operator's CLI credentials. The initial application-key check returned only the development inbox. A later P0 probe created one fresh, marked fixture in this pod and sent two controlled emails only to itself; existing inboxes were preserved. The application key could read that fixture with HTTP 200. Actual signed sent/delivered webhooks, same-key send/reply recovery, changed-payload 409 and sent-parent thread matching passed. The self-send remained sent-only. A later probe reverified the original development inbox and marked fixture as two distinct product-controlled identities, sent exactly two emails between them, and proved received-parent replies, inbox-local threading, six signed sent/delivered/received callbacks, and idempotent recovery. No additional inbox or human recipient was used. See the [compatibility evidence](05_compatibility_report.md#controlled-agentmail-probe).

For production conversational email, register a webhook only after a receiver with signature verification has a stable HTTPS URL. The disposable P0 receivers used temporary Cloudflare Quick Tunnels and exact one-inbox or two-inbox filters; its task-created webhook was deleted and the receiver/tunnel stopped after capture. For the production endpoint, save its signing secret as `AGENTMAIL_WEBHOOK_SECRET`; the API key is not the webhook signing secret. AgentMail remains the managed conversation inbox/thread provider; Cloudflare Email Service owns transactional sending and Supabase Auth SMTP.

References: [AgentMail quickstart](https://docs.agentmail.to/quickstart), [webhook verification](https://www.agentmail.to/docs/webhook-verification).

## Photon

Reused the existing **findmeatime** project, ID `3244ea18-c2c1-4727-80d4-7d7ea4d091ef`, on the free plan. Saved `PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET` in `.env` by reading the existing secret, without rotating it. These names are our configuration convention: pass their values explicitly as the SDK's `projectId` and `projectSecret`.

Verified account access and that `imessage` is enabled. The project's assigned-line list was empty; free plans use a shared pool, so this does not establish a missing dedicated-line configuration. No paid upgrade or dedicated line was provisioned. Subsequent controlled tests verified SDK access, outbound delivery, and an exact inbound reply; application identity binding and production channel integration remain open. See the [Photon compatibility evidence](05_compatibility_report.md#photon-transport-probe).

The reserved-address SDK probe later initialized successfully but returned `Target not allowed for this project` for its unregistered target. Free/Pro shared-pool recipients must match a project User's actual iMessage phone number or email. This policy denial is not evidence that the project secret is invalid. Register a user-designated controlled recipient without requesting an onboarding invite, then verify availability before an explicitly authorized test message. Do not infer the iMessage handle from a Google account address. [Shared-target troubleshooting](https://photon.codes/docs/spectrum-ts/troubleshooting/imessage#target-not-allowed-for-this-project).

A user-designated controlled phone number was subsequently registered and independently verified without an onboarding invite. The first explicitly authorized shared-DM write, with retries disabled and a durable refusal fence, returned the same target-policy denial. A later read-only check returned available, and a newly authorized single-message retest received the exact expected reply. The earlier denial is historical evidence, not the current controlled recipient's status. The [controlled probe guide](../../scripts/p0/photon-controlled-conversation-README.md) documents private authorization, bounded targeted observation, and the permanent no-resend guard. No credentials were rotated and no paid plan was added.

The current cloud iMessage SDK documents Node.js or Bun with Node-compatible gRPC. The [runtime decision](05_compatibility_report.md#runtime-and-interface-decisions) selects a narrow Node/Bun bridge for P6; the local Node transport test does not establish Supabase Edge compatibility. No message handler or webhook receiver was deployed during setup.

References: [Photon CLI skill](../../.agents/skills/photon-cli/SKILL.md), [shared and dedicated line routing](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing), [runtime compatibility](https://photon.codes/docs/spectrum-ts/providers/imessage#runtime-compatibility).

### First message and host onboarding

Photon's **Stable** documentation, checked on 2026-10-05, supports initiating a DM by resolving the recipient's iMessage phone number or email, creating a space with `im.space.create(user)`, and sending through that space. The recipient does not technically need to text first. Provider target policy still applies, including registered project Users on Free/Pro shared-pool plans. The documented default quota is **50 new conversations initiated per line per day**; replies within existing conversations do not count. The later controlled retest verified initiation and an inbound reply for one registered recipient; it does not establish routing for every user. [Creating conversations and quotas](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing), [shared-target policy](https://photon.codes/docs/spectrum-ts/troubleshooting/imessage#target-not-allowed-for-this-project).

Photon strongly recommends that users initiate conversations for deliverability. Messages sent first from an unknown number can expose the “Report Junk” action, and repeated unanswered outreach increases filtering risk. Photon recommends a deep link that opens Messages with a prefilled first message for the user to send, followed by contact-card sharing after the first exchange. [iMessage deliverability](https://photon.codes/docs/best-practices/imessage-deliverability).

For Find Me a Time, the recommended optional “Connect iMessage” flow starts from the authenticated host account, resolves the appropriate Photon line, and opens Messages with a prefilled setup message. The host sends it; the application verifies and binds the private conversation to that account before sending private scheduling summaries. A first inbound message alone does not establish host identity, notification consent, or proposal approval. Shared-pool onboarding must validate the recipient's assigned route rather than assume one public number for all hosts. The application now implements expiring two-sided linking proof, browser opt-in, private sender binding and unlink fencing; see the [host setup guide](06_host_setup_guide.md). Local cross-channel fixtures pass and controlled transport delivery passed separately. A new persistent bridge server and the real linked-host journey are still pending; production iMessage setup stays disabled while website onboarding and review remain available.

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

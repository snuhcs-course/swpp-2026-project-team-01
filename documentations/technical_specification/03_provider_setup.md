# Provider setup

Setup checked on 2026-10-05. Credentials live in the ignored root `.env`, with file mode `0600`; share variable names through [`.env.example`](../../.env.example), not credential values. Existing OpenAI, Supabase, and Google values were preserved. Local configuration does not deploy secrets to Supabase.

## Development skills and CLIs

Repository skills include Supabase, PostgreSQL best practices, OpenSpec, shadcn, and the copied AgentMail CLI, Photon CLI, OpenAI documentation, and skill-creator skills. These additions came from the installed local skills. AgentMail and Photon instructions include compatibility notes for the installed CLIs.

- AgentMail CLI: `1.8.0`, authenticated through macOS Keychain. Use `agentmail auth status` to inspect credential availability. Commands use `--format json` and `--query` for projections.
- Photon CLI: `2.2.0`, authenticated through its saved CLI login. Use `photon whoami`; this command does not accept `--json`. Resource commands such as `photon projects list --json` do.

These CLIs do not automatically load this repository's `.env`. Load the required variables into the process environment when running application-scoped checks. Keep admin CLI credentials separate from application credentials, and avoid commands that print secrets into logs.

## AgentMail

Created a development pod named **Find Me a Time Development**, with inbox **findmeatime-dev@agentmail.to**. The root `.env` contains `AGENTMAIL_POD_ID`, `AGENTMAIL_INBOX_ID`, and `AGENTMAIL_API_KEY`.

The application key is scoped to this pod and has only `inbox_read`, `message_read`, and `message_send` permissions. Inbox provisioning and webhook administration use the operator's CLI credentials. The initial application-key check returned only the development inbox. A later P0 probe created one fresh, marked fixture in this pod and sent two controlled emails only to itself; existing inboxes were preserved. The application key could read that fixture with HTTP 200. Actual signed sent/delivered webhooks, same-key send/reply recovery, changed-payload 409 and sent-parent thread matching passed. The self-send remained sent-only. A later probe reverified the original development inbox and marked fixture as two distinct product-controlled identities, sent exactly two emails between them, and proved received-parent replies, inbox-local threading, six signed sent/delivered/received callbacks, and idempotent recovery. No additional inbox or human recipient was used. See the [compatibility evidence](05_compatibility_report.md#controlled-agentmail-probe).

For production, register a webhook only after a receiver with signature verification has a stable HTTPS URL. The disposable P0 receivers used temporary Cloudflare Quick Tunnels and exact one-inbox or two-inbox filters; its task-created webhook was deleted and the receiver/tunnel stopped after capture. For the production endpoint, save its signing secret as `AGENTMAIL_WEBHOOK_SECRET`; the API key is not the webhook signing secret. A custom sending domain and its DNS records are not configured by this setup.

References: [AgentMail quickstart](https://docs.agentmail.to/quickstart), [webhook verification](https://www.agentmail.to/docs/webhook-verification).

## Photon

Reused the existing **findmeatime** project, ID `3244ea18-c2c1-4727-80d4-7d7ea4d091ef`, on the free plan. Saved `PHOTON_PROJECT_ID` and `PHOTON_PROJECT_SECRET` in `.env` by reading the existing secret, without rotating it. These names are our configuration convention: pass their values explicitly as the SDK's `projectId` and `projectSecret`.

Verified account access and that `imessage` is enabled. The project's assigned-line list was empty; free plans use a shared pool, so this does not establish a missing dedicated-line configuration. No paid upgrade or dedicated line was provisioned. Actual SDK authentication, test-user routing, and message delivery remain untested.

The current cloud iMessage SDK documents Node.js or Bun with Node-compatible gRPC. Validate the transport against Supabase Edge Functions before choosing an implementation; credentials alone do not establish runtime compatibility. If a bridge is needed, document that decision before implementing it. No message handler or webhook receiver was deployed during setup.

References: [Photon CLI skill](../../.agents/skills/photon-cli/SKILL.md), [shared and dedicated line routing](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing), [runtime compatibility](https://photon.codes/docs/spectrum-ts/providers/imessage#runtime-compatibility).

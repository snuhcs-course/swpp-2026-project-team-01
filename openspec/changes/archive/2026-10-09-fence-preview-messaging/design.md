# Design

## Context

See [proposal](proposal.md). Cloudflare has a configuration preflight, while Photon and AgentMail dispatchers can claim work before opening their transport. A transport-only denial could therefore turn an unsent item into an uncertain dispatch. Local tests inject providers and synthetic credentials.

## Goals / Non-Goals

**Goals:** One server-owned deployment check at worker entry and transport entry; no new schema or per-recipient bypass.

**Non-Goals:** Calendar/model traffic, general preview database isolation, platform SMTP, recipient authorization and live-provider acceptance.

## Decisions

Use Vercel system metadata, never request headers or browser input. If any of `VERCEL`, `VERCEL_ENV`, `VERCEL_TARGET_ENV`, `VERCEL_DEPLOYMENT_ID` or `VERCEL_URL` identifies a managed environment, require `VERCEL_ENV=production` and, when present, `VERCEL_TARGET_ENV=production`. Reject preview, development, custom and ambiguous values without normalization. Standalone local processes with no Vercel markers keep existing behavior. There is no preview override. Require Vercel system variables to remain enabled; do not copy production variables into previews.

Check all four Cloudflare workers at both run/process entry, both Photon dispatchers, and the AgentMail reply dispatcher before RPC calls. Check Cloudflare configuration, Photon public transport operations and AgentMail preparation independently before network activity. Use the existing `CONFIGURATION_UNAVAILABLE` 503 error outside outcome-conversion catches. Keep provider retry/uncertainty behavior unchanged for admitted execution.

Alternatives: withholding secrets alone is necessary but insufficient against accidental copying; transport-only checks permit delivery ledger mutations; a user-controlled request flag cannot establish deployment identity.

## Risks / Trade-offs

- Disabled system metadata can resemble standalone execution → enable and verify system variables for the selected project; preserve separate credentials/databases. This guard does not replace environment separation.
- Preview request handlers can still create non-delivery state → this bounded change fences delivery workers/transports, not all application actions.
- Non-production provider debugging cannot send through this app → use deterministic injected fixtures locally and separately authorized production acceptance.

## Migration Plan

No database migration. Verify unit/provider and worker denial tests, builds and runtime checks; deploy a reviewed clean source to the identified production project and verify HTTP guard behavior. Verify preview denial with the built application and controlled credentials without sending a message. Production rollback restores the previous application without rewriting delivery records.

Reference: [Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables).

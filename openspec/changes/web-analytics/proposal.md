# Proposal

Tracking issue: #469 (replaces #341, whose Google Analytics tag merged in #343 and was never activated)

## Why

Nobody on the team can see how hosts and guests move through the product: how many open the landing page, sign in, finish setup, link a messaging channel, start a request and end with a booking, or where they stop. The [measurement targets](../archive/2026-11-24-operations-and-release/proposal.md#decisions) (D1, D2) and the [channel usage report](../archive/2026-11-23-channel-usage-report/proposal.md) count outcomes from the database, not behavior. The Google Analytics tag from #341 counts page views only and cannot see the agent or iMessage, WhatsApp and Telegram. Issue #469 asks for PostHog with as much product capture as is useful. The app's credentials live in its paths, though: a booking link is the requester's only credential ([meeting requests](../../specs/meeting-requests/spec.md)), and link codes and OAuth steps sit under `/connect`, `/connections` and `/oauth`. Hosts' screens show guests' names, messages and calendars. So capture needs its own rules.

## What Changes

- **Browser.** When `POSTHOG_PROJECT_KEY` holds a PostHog project key and the deployment is Vercel production, the root layout loads `posthog-js`, which records page views and leaves, clicks, rage and dead clicks, heatmaps, web vitals, front-end exceptions and session replay. Local runs, previews, tests and Playwright never load it. The Google Analytics tag is removed.
- **Redacted addresses.** Every event, replay snapshots included, has its addresses redacted before it leaves the browser: a path of two or more segments is reported as its first segment followed by `[redacted]`, query strings and fragments are dropped, and a referrer is reduced to its origin.
- **Masked content.** Replay masks all text and inputs and blocks images; click events describe the element, not its text.
- **Identified hosts.** A signed-in host is identified by their host account ID, with their handle, sign-up date, linked channel, calendar status and setup readiness as person properties. Signing out resets the identity. Guests stay anonymous.
- **Server events.** The command pipeline, the job worker, the channel receivers and the agent's hook send events with `posthog-node`: operation names and outcomes, job kinds and results, a message's channel and content type, the agent's sessions, turns and tool names. Never content.
- **Same-origin relay.** The browser sends to `/ingest`, which `next.config.ts` rewrites to PostHog, so the Content Security Policy stays on the app's origin.
- **Notice.** `/privacy` names PostHog instead of Google Analytics in English and Korean, with what it receives, the replay, the cookies, the region and the retention.
- **Setup.** `.env.example` and [provider setup](../../../documentations/technical_specification/03_provider_setup.md#posthog) describe the project, the variables, the relay and the checks.

## Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | SDK ([design 1](design.md#d1-posthog-in-the-browser-and-on-the-server)) | PostHog Cloud: `posthog-js`, imported on first use, and `posthog-node`. Replaces the GA4 tag |
| D2 | Redaction ([design 2](design.md#d2-report-paths-not-addresses)) | Path only; paths of two or more segments are cut to their first segment plus `[redacted]`; referrers to their origin; applied to every event in `before_send`, snapshots included |
| D3 | Where it runs ([design 3](design.md#d3-production-only-and-opt-in)) | Only Vercel production with the key set, in the browser and on the server |
| D4 | Consent ([design 4](design.md#d4-disclosure-not-a-banner)) | Disclosed in the notice, with no cookie banner, the same basis as operations-and-release D12. Revisit before serving visitors in the EU |
| D5 | Transport ([design 5](design.md#d5-same-origin-relay)) | `/ingest` rewrite to the region's hosts; no CSP change |
| D6 | Capture and masking ([design 6](design.md#d6-capture-everything-show-nothing)) | Autocapture, replay, heatmaps, dead clicks, web vitals and exceptions on; replay masks all text and inputs and blocks images; clicks carry no text; hosts identified by account ID |
| D7 | Server events ([design 7](design.md#d7-server-events-without-content)) | Command, job, channel-receipt and agent-hook events, with names and outcomes only; guests as hashed pseudonyms without profiles |

## Capabilities

### New Capabilities

- `web-analytics`: product analytics on the web app, the agent and the messaging channels, with redacted addresses and masked content, in production only, disclosed in the privacy notice.

### Modified Capabilities

- `host-admission`: `ingest` joins the reserved handles, since `/ingest` relays analytics.

The public data notice (`data-stewardship`) is still a pending delta of [operations-and-release](../archive/2026-11-24-operations-and-release/specs/data-stewardship/spec.md). Its requirement already says the page names the providers that process data, so this change replaces a provider on the page without changing that requirement.

## Impact

- Web: `apps/web/lib/analytics.ts`, `apps/web/app/_components/analytics.tsx`, the root layout, `/app`, the workspace menu, `apps/web/next.config.ts`, `apps/web/proxy.ts` and the reserved handles in `lib/contracts/handles.ts`.
- Server and agent: `lib/server/product-analytics.ts`, `lib/server/commands.ts`, `lib/server/job-worker.ts`, `lib/server/photon-receiver.ts`, `lib/server/agentmail-receiver.ts` and `agent/hooks/analytics.ts`.
- Dependencies: `posthog-js`, `posthog-node` and `@vercel/functions`.
- Notice: `apps/web/app/privacy/page.tsx`, English and Korean.
- Configuration: `POSTHOG_PROJECT_KEY` and `POSTHOG_REGION` in `.env.example` and on the Vercel project that serves `findmeatime.com`. `GOOGLE_ANALYTICS_MEASUREMENT_ID` is no longer read.
- No schema change.

# Tasks

## Google Analytics (#341, merged in #343)

- [x] Add `apps/web/lib/analytics.ts` (measurement-ID gate, path redaction, CSP sources) with unit tests.
- [x] Add the `<Analytics>` client component and render it from the root layout.
- [x] Widen the Content Security Policy in `apps/web/next.config.ts` only when analytics is enabled.
- [x] Name Google Analytics in `/privacy`, in English and Korean.
- [x] Add `GOOGLE_ANALYTICS_MEASUREMENT_ID` to `.env.example` and a Google Analytics section to provider setup.

## PostHog in the browser (#469)

- [x] Replace the gate with `analyticsConfig` (project key and region) and add `analyticsUrl` and `redactAnalyticsValue`, with unit tests for properties, element chains, heatmaps and replay snapshots.
- [x] Replace the gtag component with `posthog-js`: autocapture, page views and leaves, rage and dead clicks, heatmaps, web vitals, exceptions and replay with all text and inputs masked and images blocked.
- [x] Add the `/ingest` rewrites and trailing-slash redirect in `apps/web/next.config.ts`, skip `/ingest` in `apps/web/proxy.ts`, reserve the `ingest` handle, remove Google's CSP origins, and test that the config and the gate agree.
- [x] Identify the host on `/app` with `hostAnalyticsTraits`, and reset on sign-out.

## PostHog on the server (#469)

- [x] Add `lib/server/product-analytics.ts` (gate, pseudonyms, background capture) with unit tests.
- [x] Send command, job and channel-receipt events from `runCommand`, `runWorkerBatch`, `storeReceipt` and the AgentMail receiver.
- [x] Add `agent/hooks/analytics.ts` for sessions, turns and tool calls.

## Notice and setup (#469)

- [x] Name PostHog instead of Google Analytics in `/privacy`, in English and Korean.
- [x] Replace the variable in `.env.example` and the provider setup section with PostHog's, and regenerate the Korean mirror.

## Activation

- [ ] Create the PostHog project, choose the region, set masking, retention and a billing limit, and set `POSTHOG_PROJECT_KEY` (and `POSTHOG_REGION`) on the Production environment of the Vercel project that serves `findmeatime.com`, for the web and agent services.
- [ ] Check page views for `/` and `/app`, that a booking page arrives as `/booking/[redacted]`, that a recording shows masked text, and that a server event such as `channel_message_received` arrives.
- [ ] Build the dashboard: host funnel, guest funnel, sign-ups per day and messages per channel.
- [ ] Confirm with the team whether the sign-up flow needs a notice or consent step under PIPA.

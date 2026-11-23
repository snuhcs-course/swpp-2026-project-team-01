# Proposal

Tracking issue: #341

## Why

Nobody on the team can see how many people open the landing page, a host page or the workspace, or where they leave. The [measurement targets](../archive/2026-11-24-operations-and-release/proposal.md#decisions) (D1, D2) are counted from the database, which records requests and bookings, not visits. Issue #341 asks for Google Analytics on the web app. The app's credentials live in its paths, though: a booking link is the requester's only credential ([meeting requests](../../specs/meeting-requests/spec.md)), and link codes and OAuth steps sit under `/connect`, `/connections` and `/oauth`. A stock analytics tag reports the full address of every page, and the [privacy notice](../../../apps/web/app/privacy/page.tsx) lists every processor by name. So analytics needs its own rules.

## What Changes

- **Tag.** When `GOOGLE_ANALYTICS_MEASUREMENT_ID` holds a GA4 measurement ID and the deployment is Vercel production, the root layout loads Google's `gtag.js` and records a page view on every route, including client-side navigations. Local runs, previews, tests and Playwright never load it.
- **Redacted addresses.** The tag reports a page by its path alone: no query string and no fragment. A path of two or more segments is reported as its first segment followed by `[redacted]`, such as `/booking/[redacted]`, so no booking identifier, link code or OAuth value leaves the browser. The referrer is reduced to its origin. Google signals and ad personalization are off.
- **Content Security Policy.** Google's tag and collection origins are added to `script-src`, `connect-src` and `img-src` only when the tag is enabled.
- **Notice.** `/privacy` names Google Analytics among the processors in English and Korean, and says what it receives and that it sets cookies.
- **Setup.** `.env.example` and [provider setup](../../../documentations/technical_specification/03_provider_setup.md#google-analytics) describe the property, the variable and the property settings to change.

## Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | SDK ([design 1](design.md#d1-gtagjs-without-the-firebase-sdk)) | GA4 through `gtag.js`, loaded by a small client component. No Firebase SDK, no `@next/third-parties` |
| D2 | Redaction ([design 2](design.md#d2-report-paths-not-addresses)) | Path only; paths of two or more segments are cut to their first segment plus `[redacted]`; the referrer is reduced to its origin |
| D3 | Where it runs ([design 3](design.md#d3-production-only-and-opt-in)) | Only Vercel production with the variable set. Each project opts in by setting it, so staging stays off until someone sets it there |
| D4 | Consent ([design 4](design.md#d4-disclosure-not-a-banner)) | Disclosed in the notice, with no cookie banner, the same basis as operations-and-release D12. Revisit before serving visitors in the EU |

## Capabilities

### New Capabilities

- `web-analytics`: page-view analytics on the web app with redacted addresses, in production only, disclosed in the privacy notice.

### Modified Capabilities

None in `openspec/specs/`. The public data notice (`data-stewardship`) is still a pending delta of [operations-and-release](../archive/2026-11-24-operations-and-release/specs/data-stewardship/spec.md). Its requirement already says the page names the providers that process data, so this change adds a provider to the page without changing that requirement.

## Impact

- Web: `apps/web/lib/analytics.ts`, `apps/web/app/_components/analytics.tsx`, the root layout and `apps/web/next.config.ts`.
- Notice: `apps/web/app/privacy/page.tsx`, English and Korean.
- Configuration: `GOOGLE_ANALYTICS_MEASUREMENT_ID` in `.env.example` and on the Vercel project that serves `findmeatime.com`.
- No schema, agent or channel change. iMessage, WhatsApp, Telegram and email conversations are not measured by this tag.

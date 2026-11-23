# Design

## Context

See [proposal.md](proposal.md). The root layout (`apps/web/app/layout.tsx`) is a server component shared by every page. `apps/web/next.config.ts` sends one static Content Security Policy: scripts, connections and images come only from the app's own origin, with page-specific variants derived from it by string replacement. Credentials sit in paths: `/booking/{id}`, `/connect/link/{code}`, `/connections/google/...`, `/imessage/continue`, `/auth/callback` and `/oauth/...` with query values. `cacheComponents` is on, so the layout is prerendered and reads environment variables at build time.

## Decisions

### D1. gtag.js without the Firebase SDK

The tag is Google's `gtag.js` (`https://www.googletagmanager.com/gtag/js?id=G-...`), loaded with `next/script` after the page is interactive by a client component, `<Analytics measurementId>`. The component queues `js`, `set` and `config` on `window.dataLayer` itself, so the page needs no inline script, and it sends `page_view` from an effect keyed on `usePathname()`.

Rejected: the Firebase JS SDK (`firebase/analytics`) | it wraps the same `gtag.js`, adds a Firebase project and a larger bundle, and no other Firebase product is used. A Firebase project can still be linked to the same GA4 property later. Rejected: `@next/third-parties/google` | it leaves page views to GA's history-change measurement, which reports `document.location` in full, query string included.

### D2. Report paths, not addresses

`analyticsPath(pathname)` keeps `/` and single-segment paths, which are public (`/app`, `/privacy`, a host's handle), and cuts every longer path to `/{first}/[redacted]`. `page_location` is the origin plus that path, set with `gtag('set')` before `config` and again on every navigation, so automatically collected events (scrolls, outbound clicks) carry the redacted value too. `page_referrer` is the referrer's origin, or empty. `config` sets `send_page_view: false`, so the only page views are the component's, plus `allow_google_signals: false` and `allow_ad_personalization_signals: false`.

The GA4 property's enhanced measurement setting "Page changes based on browser history events" must be off, or GA sends its own page views from the unredacted address. Provider setup says so.

Rejected: an allowlist of public routes | every new route would be unmeasured until someone added it, and a host handle is not a fixed route. Rejected: dropping deep paths entirely | the team would lose booking-page and setup-page counts, which are the funnel.

### D3. Production only and opt-in

`analyticsMeasurementId(env)` returns the ID only when `GOOGLE_ANALYTICS_MEASUREMENT_ID` matches `^G-[A-Z0-9]+$` and both `VERCEL=1` and `VERCEL_ENV=production` hold, the same reading as `lib/server/deployment.ts` without its target checks, because `next.config.ts` cannot import server modules. `next.config.ts` uses the same function to decide whether to widen the CSP, so the tag and its policy are always on or off together. Staging (`dev.findmeatime.com`) is a production deployment of another Vercel project; it stays unmeasured until that project sets the variable, preferably to a second measurement ID.

### D4. Disclosure, not a banner

GA4 sets first-party `_ga` cookies and receives the visitor's IP address, which Google uses for coarse location and does not store. The notice names Google Analytics, what it receives (redacted page paths, browser and device type, approximate location) and that it sets cookies, and says it is not used for advertising. There is no consent banner, the same basis as operations-and-release D12. A release that targets EU visitors needs Consent Mode or a banner first.

## Risks

- A future page that puts a credential in a single-segment path would be reported. Credentials have so far been one segment deeper, and the unit test lists the current routes.
- The CSP grows by Google's origins when enabled. They are added only to `script-src`, `connect-src` and `img-src`.

# Tasks

## Web

- [x] Add `apps/web/lib/analytics.ts` (measurement-ID gate, path redaction, CSP sources) with unit tests.
- [x] Add the `<Analytics>` client component and render it from the root layout.
- [x] Widen the Content Security Policy in `apps/web/next.config.ts` only when analytics is enabled.

## Notice and setup

- [x] Name Google Analytics in `/privacy`, in English and Korean.
- [x] Add `GOOGLE_ANALYTICS_MEASUREMENT_ID` to `.env.example` and a Google Analytics section to provider setup.

## Activation

- [ ] Create the GA4 property, turn off history-change page views, and set the variable on the Vercel project that serves `findmeatime.com`.
- [ ] Check page views for `/` and `/app` in the GA4 Realtime report, and that a booking page arrives as `/booking/[redacted]`.

# Web application

Next.js App Router lives in `app/`; `components/` and web-specific `lib/` hold presentation and request adapters. Root `lib/contracts/` is browser-safe; root `lib/server/` is privileged shared source. eve is a peer service, composed through root `vercel.ts`; do not add `eve/next` to this frontend.

From the repository root, use `npm run dev:web`, `npm run build:web` and `npm run start:web`. Use `npm run dev` for the composed web/eve service graph. `npm run check` includes app types; `npm run test:runtime` checks built routes and security headers.

`/app` supports email sign-in, waitlist submission, invitation redemption and sign-out. `/auth/callback` exchanges the PKCE code in the initiating browser and returns to `/app`. Auth and refresh credentials stay in HttpOnly, SameSite=Lax cookies, Secure on HTTPS; all session refreshes happen in Route Handlers and are attached to their response. The server verifies the original access token and current database session before protected operations. No browser Supabase client or local-storage session is used.

`/booking/[bookingId]` exchanges a private `#token=…` fragment for a request-specific HttpOnly cookie and immediately removes the fragment. The ID alone unlocks nothing. Closed requests expose only the permitted status/receipt projection. Private APIs use `private, no-store`; public page shells contain no personalized data. The browser conversation, Calendar setup and scheduling controls remain under implementation.

For the local browser journey, start disposable Supabase, install Chromium with `npx playwright install chromium`, then run `npm run build:web` and `npm run test:browser`. The test starts its own port-3000 server, uses local Auth/Mailpit and removes its synthetic database/Auth fixtures. Stop any other server on that port first. CI installs Chromium and runs the same journey.

Target origin: `https://release.findmeatime.com`. Canonical local origin: `http://localhost:3000`. Environment files are app-root-relative in standalone Next.js; provide shared secrets through the process environment or composed Vercel development configuration. Never prefix server secrets with `NEXT_PUBLIC_`.

- [Implementation plan](../../documentations/technical_specification/04_implementation_plan.md)
- [Frontend architecture](../../documentations/technical_specification/02_frontend_architecture.md)
- [Page list](../../documentations/user_experience/04_page_list.md)

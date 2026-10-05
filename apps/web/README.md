# Find Me a Time web

React, TypeScript, Vite, and shadcn/ui initialized using the requested `b6rtA2Hmi` preset through the shadcn CLI (Base UI, Nova, Inter, olive neutrals and green primary).

Copy `.env.example` to `.env.local` and supply the public Supabase project URL and publishable key. Never supply a service-role key to Vite. The UI calls the shared API through the same-origin `/api` proxy; it does not write tables directly.

From the repository root, install with `npm install`, then `npm run dev --workspace @fmat/web`. Build with `npm run build --workspace @fmat/web`, lint with `npm run lint --workspace @fmat/web`, and typecheck with `npm run typecheck --workspace @fmat/web`.

Vite proxies `/api` to local Supabase at port 54321. `VITE_API_ORIGIN` can override the API for a dedicated development server. Production Vercel rewrites preserve same-origin OAuth binding cookies. Serve `dist` with SPA fallback to `index.html`. Configure Supabase Auth's site URL and allowed redirects for `/host`. Google Calendar consent returns through the backend callback to the same host or request view.

Requester continuation credentials stay in browser storage and are sent only in `X-Request-Token`. A lost browser credential needs a one-time recovery link delivered to the verified contact; an email address alone cannot unlock access. Recovery links rotate the continuation credential. Contact verification accepts the complete case-sensitive email token; a same-browser verification link prefills it but still requires an explicit confirmation. All mutations carry an idempotency key, and existing request mutations use the current revision.

Browser regression tests run with `npm run test:browser --workspace @fmat/web`. They use Playwright supplied by the test environment (or `PLAYWRIGHT_MODULE` pointing to a bundled installation); install its Chromium browser or set `PLAYWRIGHT_CHANNEL=chrome` for installed Chrome. The test starts an isolated Vite server with a fixture API origin, verifies guest/host authority, recovery, contact verification, proposal decisions, private conversations and travel confirmation controls, and saves mobile screenshots in ignored `test-results/`. `WEB_TEST_URL` can target an already running fixture-configured development server.

The host UI adapts the official [shadcn blocks](https://ui.shadcn.com/blocks): `login-04` for split sign-in, `sidebar-08` for the inset workspace and mobile navigation, and `dashboard-01` for request summary cards. Registry source was inspected through `npx shadcn@latest view`; sidebar, sheet, tooltip, and the mobile hook were added through the CLI using the existing Base UI preset. Navigation and cards use real application routes and data. The mobile hook initializes from the viewport, and the mobile sheet exposes its close button. Keep the preset and existing authentication, explicit approval, and privacy boundaries when adapting further blocks.

Run `npm run test:workspace --workspace @fmat/web` for the host layout regression suite. It uses isolated API/auth fixtures to cover setup readiness, saved form values, inbox search, and mobile navigation, and saves desktop/mobile screenshots under `test-results/`. These fixture checks do not establish live Google Calendar or messaging provider connectivity.

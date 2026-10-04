# Find Me a Time web

React, TypeScript, Vite, and shadcn/ui initialized using the requested `b6rtA2Hmi` preset through the shadcn CLI (Base UI, Nova, Inter, olive neutrals and green primary).

Copy `.env.example` to `.env.local` and supply the public Supabase project URL and publishable key. Never supply a service-role key to Vite. The UI calls the shared API through the same-origin `/api` proxy; it does not write tables directly.

From the repository root, install with `npm install`, then `npm run dev --workspace @fmat/web`. Build with `npm run build --workspace @fmat/web`, lint with `npm run lint --workspace @fmat/web`, and typecheck with `npm run typecheck --workspace @fmat/web`.

Vite proxies `/api` to local Supabase at port 54321. `VITE_API_ORIGIN` can override the API for a dedicated development server. Production Vercel rewrites preserve same-origin OAuth binding cookies. Serve `dist` with SPA fallback to `index.html`. Configure Supabase Auth's site URL and allowed redirects for `/host`. Google Calendar consent returns through the backend callback to the same host or request view.

Requester continuation credentials stay in browser storage and are sent only in `X-Request-Token`. A lost browser credential needs the protected continuation link supplied by the service; an email address alone cannot recover request access. All mutations carry an idempotency key, and existing request mutations use the current revision.

# Web application

Next.js App Router lives in `app/`; `components/` and web-specific `lib/` hold presentation and request adapters. Root `lib/contracts/` is browser-safe; root `lib/server/` is privileged shared source. eve is a peer service, composed through root `vercel.ts`; do not add `eve/next` to this frontend.

From the repository root, use `npm run dev:web`, `npm run build:web` and `npm run start:web`. Use `npm run dev` for the composed web/eve service graph. `npm run check` includes app types; `npm run test:runtime` checks built routes and security headers. The current landing page and health endpoint are runtime probes. Authenticated host and protected requester workspaces are pending.

Target origin: `https://release.findmeatime.com`. Canonical local origin: `http://localhost:3000`. Environment files are app-root-relative in standalone Next.js; provide shared secrets through the process environment or composed Vercel development configuration. Never prefix server secrets with `NEXT_PUBLIC_`.

- [Implementation plan](../../documentations/technical_specification/04_implementation_plan.md)
- [Frontend architecture](../../documentations/technical_specification/02_frontend_architecture.md)
- [Page list](../../documentations/user_experience/04_page_list.md)

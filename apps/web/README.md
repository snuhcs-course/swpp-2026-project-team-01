# Web reconstruction

The Next.js directory scaffold now exists: `app/`, `components/`, web-specific `lib/` and `public/`. There is no runnable web app or dev/build command yet. Eve definitions live in root `agent/`, and shared scheduling logic/contracts in root `lib/`; the runtime spike will configure their separate builds. Ignored local credentials and deployment metadata are preserved.

- [Implementation plan](../../documentations/technical_specification/04_implementation_plan.md)
- [Frontend architecture](../../documentations/technical_specification/02_frontend_architecture.md)
- [Page list](../../documentations/user_experience/04_page_list.md)

Target origin: `https://release.findmeatime.com`. Canonical local origin: `http://localhost:3000`. Reintroduce setup instructions and application checks with the tested replacement implementation.

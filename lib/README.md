# Shared application source

This directory is shared source for the eve and web server builds, not a published package. Initial modules implement safe errors, origin/return validation and the verified model configuration; domain operations are being reconstructed.

- `contracts/`: browser-safe input schemas, actions and authorized projections.
- `server/`: shared identity, onboarding, scheduling, booking, delivery, provider, database and job modules.

All channel and tool adapters call the same authorized operations. Keep Next.js-specific request/cookie adapters in `apps/web/lib/`; pass verified actor/context into shared operations. Browser code must not import `server/`, including through barrel exports. Do not create a root export that mixes client-safe and privileged modules.

Unit tests live beside their modules. Cross-runtime coverage belongs in root `tests/integration/`. See the [backend boundaries](../documentations/technical_specification/01_backend_architecture.md#2-module-boundaries).

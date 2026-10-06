# Pre-rebuild source removal

The owner authorized removing the former application on 2026-10-07, before implementing its replacement. This intentionally leaves no runnable web app, agent runtime or scheduling API. Work stays on `feat/reconstruct-application` in the main checkout. The replacement target is `https://release.findmeatime.com` with Supabase project `mriseqztcwmezvtawnbo`.

## Cleanup plan and recovery

1. Capture baseline verification and preserve tracked files plus pending documentation/migrations before deletion.
2. Remove the former Vite UI, shared contracts, Deno API/worker, Photon bridge implementation, implementation-specific tests and deployment/management scripts. Remove obsolete executable provider probes while retaining their dated evidence.
3. Retire active Vercel routing to the former Supabase project; archive the old Fly container configuration for reference. Remove obsolete Edge Function entries from local Supabase configuration.
4. Keep SQL schemas, migrations and pgTAP tests together as the database baseline. Replace them through reviewed future migrations, not by making pg-delta's desired schema empty. Preserve independent SMTP configuration tooling and its tests.
5. Replace app CI/scripts with honest repository/documentation and retained infrastructure checks. Repair source references and verify the removal against the checkpoint manifest.

Before removal, `npm run check` passed the former app's typecheck, lint, backend/operator tests and Vite build. The bridge's `npm run check` passed all 23 tests. The build emitted its existing large-chunk warning. These are baseline results, not evidence for the replacement. Database tests could not be rerun: `supabase status` reported that the OrbStack Docker socket is unavailable. The retained database CI job still starts/reset/tests a disposable local stack.

A private local checkpoint is stored at `.local/rebuild/pre-removal-2026-10-07/working-tree.tar.gz`, alongside `manifest.json`, `status.txt` and `tracked-changes.patch`. All 696 archived files were verified against SHA-256 hashes before deletion. It includes pending tracked changes and untracked documentation/migrations. Ignored credentials, provider caches and unrelated `output/` files stay in place and are excluded from the checkpoint. Do not publish the local checkpoint as a product artifact.

To recover a file, extract only its relative path from the archive into a separate temporary directory, inspect it, then copy it back deliberately. Do not extract the entire checkpoint over ongoing rebuild work. Committed baseline source also remains in Git history; historical source links point to that revision and do not include uncommitted changes in the local checkpoint.

## Retained behavioral assertions

The removed tests remain recoverable in the checkpoint. The implementation plan assigns their requirements to replacement verification:

| Former coverage | Required replacement coverage |
|---|---|
| Foundation, OAuth and onboarding API tests | Admission, browser-bound consent, encrypted grants, isolated actor/session access and explicit settings confirmation (Phases 1–3) |
| Scheduling, requests, calendar and ranking tests | Deterministic feasibility, timezone/travel constraints, current proposal revisions and scoped requester access (Phase 4) |
| Booking, booking runtime and delivery tests | Explicit current approval, one event, durable claims, uncertain-write reconciliation and independent notification recovery (Phase 5) |
| Bridge and messaging tests | Verified private identity, browser-entered OTP, deduplication, reconnect/replay, revocation and uncertain-send handling (Phases 6–7) |
| Browser smoke and agent-client probes | Rebuilt conversational UI and each required personal-agent client's complete journey (Phases 3–9) |

No replacement behavior is introduced in this deletion step, so new application regression tests belong with the replacement slices. The retained SQL tests continue to describe the preserved database baseline.

## External state

This is local source removal only. It does not delete deployed applications, stop a remote bridge, modify DNS, send messages, revoke credentials or change a remote database. Existing consumers must be identified and fenced before later controlled channel tests. Historical provider evidence remains under `scripts/p0/` and the documentation archive; its old commands are not current runbooks.

## Removal verification

Removed 181 legacy tracked files. The dependency-free root manifest/lockfile and CI now run retained script syntax checks, documentation-link checks and four SMTP configuration tests. The database CI job retains migration replay and pgTAP checks without deleted application integration runners. No app build/typecheck is claimed during this empty-runtime stage.

Local Supabase Auth now uses `http://localhost:3000` with `/auth/callback`; former function entries and local Edge Runtime execution are disabled. This changes local defaults only; remote Auth/provider configuration is untouched.

# Retired verification inventory

Reconciled on 2026-10-11 against the Git tree immediately before reconstruction, `5c305d9^`.

The inventory contains **34 files: 31 named-test files with 215 top-level named tests, and three command-style integration scripts**. Counts identify historical test declarations, not individual assertions or replacement tests. Every source path has exactly one row below; the linked audits own assertion-level dispositions and evidence. A mapping is not a passing release gate: unresolved differences and actual provider/device/client acceptance remain open.

The file set was enumerated from `git ls-tree -r --name-only 5c305d9^` using the historical `_test.ts`, `.test.ts`/`.test.mjs` and integration-script names. Each file's contents were read to count its `Deno.test` or `test` declarations, and the index's path set was compared exactly to that enumeration. The retained SMTP test file was additionally compared byte-for-byte with its historical blob. The command inventory is owned by the [test guide](../../tests/README.md#legacy-verification-command-migration); its table includes the old package, Deno and CI entry points. This index does not claim the retrospective audit preceded removal of the old implementation.

## Complete file index

Paths in the first column are historical paths, not current workspace links.

| Historical file at `5c305d9^` | Named tests | Owning disposition and remaining scope |
|---|---:|---|
| `apps/photon-bridge/test/backend.test.mjs` | 1 | [Disposition](../../documentations/technical_specification/17_legacy_photon_bridge_audit.md) — Mapped with retired subscription lifecycle; forwarding representation and live receiver/device acceptance remain open. |
| `apps/photon-bridge/test/bridge.test.mjs` | 13 | [Disposition](../../documentations/technical_specification/17_legacy_photon_bridge_audit.md) — Mapped with retired subscription lifecycle; forwarding representation and live receiver/device acceptance remain open. |
| `apps/photon-bridge/test/config.test.mjs` | 4 | [Disposition](../../documentations/technical_specification/17_legacy_photon_bridge_audit.md) — Mapped with retired subscription lifecycle; forwarding representation and live receiver/device acceptance remain open. |
| `apps/photon-bridge/test/runtime.test.mjs` | 4 | [Disposition](../../documentations/technical_specification/17_legacy_photon_bridge_audit.md) — Mapped with retired subscription lifecycle; forwarding representation and live receiver/device acceptance remain open. |
| `apps/photon-bridge/test/startup.test.mjs` | 1 | [Disposition](../../documentations/technical_specification/17_legacy_photon_bridge_audit.md) — Mapped with retired subscription lifecycle; forwarding representation and live receiver/device acceptance remain open. |
| `scripts/configure-email-smtp.test.mjs` | 4 | [Disposition](../../scripts/configure-email-smtp.test.mjs) — Retained byte-for-byte; all four tests rerun for this inventory. |
| `scripts/manage-invitations.test.mjs` | 9 | [Disposition](../../documentations/technical_specification/15_legacy_invitation_cli_audit.md) — Mapped; controlled invitation inbox acceptance remains open. |
| `scripts/p0/agentmail-distinct-probe.test.mjs` | 5 | [Disposition](../../documentations/technical_specification/18_legacy_agentmail_probe_audit.md) — Diagnostic retired; ownership, distinct identities and real callback evidence remain open. |
| `scripts/p0/agentmail-paired-webhook.test.mjs` | 2 | [Disposition](../../documentations/technical_specification/18_legacy_agentmail_probe_audit.md) — Diagnostic retired; ownership, distinct identities and real callback evidence remain open. |
| `scripts/p0/agentmail-probe.test.mjs` | 12 | [Disposition](../../documentations/technical_specification/18_legacy_agentmail_probe_audit.md) — Diagnostic retired; ownership, distinct identities and real callback evidence remain open. |
| `scripts/p0/agentmail-webhook.test.mjs` | 4 | [Disposition](../../documentations/technical_specification/18_legacy_agentmail_probe_audit.md) — Diagnostic retired; ownership, distinct identities and real callback evidence remain open. |
| `scripts/p0/oauth-probe-native.test.mjs` | 7 | [Disposition](../../documentations/technical_specification/19_legacy_native_oauth_probe_audit.md) — Diagnostic retired; actual named-client lifecycle/tool/refresh acceptance remains open. |
| `scripts/tests/booking-integration.ts` | command | [Disposition](../../documentations/technical_specification/12_legacy_booking_audit.md#retired-command-integration-2026-10-10) — Command audit; exact recipients, refresh and receipt contract changes documented. |
| `supabase/functions/_shared/foundation_test.ts` | 8 | [Disposition](../../tests/README.md#legacy-foundation-assertion-map) — Mapped; same-origin health/CORS and worker contracts explicitly replace the old topology. |
| `supabase/functions/_shared/modules/booking/durable_test.ts` | 2 | [Disposition](../../documentations/technical_specification/12_legacy_booking_audit.md#durable-adapter-2) — Mapped; live Calendar recovery remains separate. |
| `supabase/functions/_shared/modules/booking/index_test.ts` | 16 | [Disposition](../../documentations/technical_specification/12_legacy_booking_audit.md#booking-handler-16) — Mapped; live booking acceptance remains separate. |
| `supabase/functions/_shared/modules/booking_runtime/index_test.ts` | 6 | [Disposition](../../documentations/technical_specification/12_legacy_booking_audit.md#booking-runtime-6) — Mapped; provider effects are controlled in the replacement fixtures. |
| `supabase/functions/_shared/modules/delivery/contact_test.ts` | 12 | [Disposition](../../documentations/technical_specification/11_legacy_delivery_audit.md) — Mapped; transactional and conversational ownership changed explicitly. |
| `supabase/functions/_shared/modules/onboarding/conversation_test.ts` | 9 | [Disposition](../../documentations/technical_specification/16_legacy_setup_conversation_audit.md) — Mapped; complete live onboarding remains open. |
| `supabase/functions/_shared/modules/onboarding/local_conversation_integration.ts` | command | [Disposition](../../documentations/technical_specification/14_legacy_onboarding_api_audit.md#retired-onboarding-command-integration-2026-10-10) — Command audit; actual Google/iPhone acceptance remains open. |
| `supabase/functions/_shared/modules/onboarding/oauth_test.ts` | 5 | [Disposition](../../tests/README.md#legacy-calendar-oauth-assertion-audit) — Mapped; fresh superseding consent replaces identical-URL retry. |
| `supabase/functions/_shared/modules/requests/evaluation_test.ts` | 8 | [Disposition](../../documentations/technical_specification/10_legacy_scheduling_audit.md#request-evaluation-assertions) — Mapped dispositions; online travel policy remains unresolved. |
| `supabase/functions/_shared/modules/requests/local_integration.ts` | command | [Disposition](../../documentations/technical_specification/13_legacy_request_api_audit.md#retired-request-command-integration-2026-10-10) — Command audit; changed private decision-history applicability documented. |
| `supabase/functions/_shared/modules/scheduling/index_test.ts` | 21 | [Disposition](../../documentations/technical_specification/10_legacy_scheduling_audit.md) — 20 mapped dispositions; online-adjacent-trip assertion unresolved. |
| `supabase/functions/_shared/providers/booking_test.ts` | 4 | [Disposition](../../tests/README.md#legacy-verification-command-migration) — Mapped in the named provider reconciliation within the test guide; live transport acceptance is separate. |
| `supabase/functions/_shared/providers/calendar_test.ts` | 3 | [Disposition](../../tests/README.md#legacy-verification-command-migration) — Mapped in the named provider reconciliation within the test guide; live transport acceptance is separate. |
| `supabase/functions/_shared/providers/email_test.ts` | 6 | [Disposition](../../tests/README.md#legacy-verification-command-migration) — Mapped in the named provider reconciliation within the test guide; live transport acceptance is separate. |
| `supabase/functions/_shared/providers/google_test.ts` | 3 | [Disposition](../../tests/README.md#legacy-verification-command-migration) — Mapped in the named provider reconciliation within the test guide; live transport acceptance is separate. |
| `supabase/functions/_shared/providers/host-intent_test.ts` | 5 | [Disposition](../../tests/README.md#legacy-host-intent-assertion-mapping) — Mapped; advisory extraction never establishes human confirmation. |
| `supabase/functions/_shared/providers/model_test.ts` | 8 | [Disposition](../../tests/README.md#legacy-requester-model-assertion-map) — Mapped; installed adapter fixtures do not establish live client behavior. |
| `supabase/functions/_shared/providers/ranking_test.ts` | 2 | [Disposition](../../tests/README.md#legacy-verification-command-migration) — Mapped in the named provider reconciliation within the test guide; live transport acceptance is separate. |
| `supabase/functions/_shared/providers/transport_test.ts` | 3 | [Disposition](../../tests/README.md#legacy-verification-command-migration) — Mapped in the named provider reconciliation within the test guide; live transport acceptance is separate. |
| `supabase/functions/api/routes/onboarding_test.ts` | 13 | [Disposition](../../documentations/technical_specification/14_legacy_onboarding_api_audit.md) — Mapped; same-origin routes replace retired Hono endpoints. |
| `supabase/functions/api/routes/requests_test.ts` | 15 | [Disposition](../../documentations/technical_specification/13_legacy_request_api_audit.md) — Mapped; same-origin routes and shared services replace old API. |

## Remaining obligations

- **Online meeting travel policy:** the scheduling audit explicitly leaves the old adjacent-physical-trip requirement unresolved. Current PRD/implementation limits travel evaluation to physical meetings. A product/spec decision is still required; this index does not silently retire the old assertion.
- **Photon forwarding and live transport:** the Spectrum envelope's forwarded-message representation is not verified. Current receiver/device, sole-consumer ownership, actual sender routing and iPhone acceptance remain open. Removed persistent bridge lifecycle tests do not prove webhook delivery behavior.
- **AgentMail diagnostic acceptance:** retired inbox provisioning and file-ledger utilities are not application APIs. Future live tooling must preserve resource ownership, private artifacts, frozen payloads and authorized recipients; paired live callbacks and exclusive consumer configuration remain unverified.
- **Native OAuth clients:** server and `fmat` CLI fixtures do not prove native Dots, Muse, Instinct, ChatGPT, Codex, Claude or Claude Code journeys, actual tool events or natural-expiry refresh.
- **Other live feature exits:** invitation inbox delivery, Calendar consent/refresh/booking and complete rich/sparse onboarding remain owned by the implementation plan. The verified 2026-10-11 identity-only Google login does not close these.

The enumeration gap is closed: no historical file is omitted from this index. The Phase 2 aggregate remains unchecked because a mapped unresolved difference is not completed behavioral reconciliation, and passing local replacements does not settle the external acceptance gates. No application, database, provider configuration or production deployment changes in this inventory update.

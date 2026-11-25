# Tasks

## 1. Pending MCP drafts

- [x] 1.1 Return actionable pending-draft guidance from MCP reads and field updates; verify missing values and unchanged ready states in unit tests and document tool results.

## 2. Intake in words

- [ ] 2.1 Add scoped MCP and linked messenger intake tools using host.set_intake, expose current preference/revision and document STOP distinction; verify schemas, authorization and revision/retry behavior.

## 3. Week rules and previews

- [x] 3.1 Add optional bounded, validated week overrides to drafts and confirmed settings; document format and verify invalid/duplicate Mondays and backward compatibility.
- [x] 3.2 Resolve overrides in feasibility and previews; add this-week image support without initial-setup confirmation authority; verify parity, closed weeks, overnight/DST, current-time clipping and image copy.
- [x] 3.3 Document messenger/MCP use, retain calendar-change re-proposal guidance and verify a regression assertion.

## 4. Validation

- [x] 4.1 Run relevant unit tests, lint, typecheck, build and OpenSpec validation; record unavailable integration prerequisites honestly.

## Validation evidence

- Node 24.22.2; npm ci completed against the current lockfile.
- Unit suite: 150 files, 1,372 tests passed. After final channel-scope and guidance edits, 133 related tests across five files passed.
- Final typecheck passed; lint passed with six existing warnings outside this change.
- eve build --skip-sandbox-prewarm and Next production build passed. Plain npm run build requires the uninstalled local microsandbox provider at prewarm time.
- OpenSpec strict validation and documentation link checks passed.
- Intake/MCP/channel integration cases were added. Execution is pending: local Supabase at 127.0.0.1:54322 returns ECONNREFUSED and Docker is not installed here. Real-device and model behavior acceptance are also pending; this remains an unarchived implementation draft.
- User clarified that web onboarding is unused and Settings must stay unchanged. The illustrative review-card addition was removed; no new Settings controls or screen were added.

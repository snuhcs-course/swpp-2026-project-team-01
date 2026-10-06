# Reconstruction evidence ledger

Updated: 2026-10-07. This ledger tracks the entire [implementation plan](04_implementation_plan.md); an empty evidence cell is incomplete, not a passed gate.

## Inventory

- Baseline commit: `fcd473d`, clean `feat/reconstruct-application` at start. No existing open PR on that branch.
- Application paths contain placeholders; retained baseline has five desired-schema files, seven migrations and six database test files. Existing checks validate scripts, 227 local links and four SMTP tests.
- Verified tools: Node 24.21.0, npm 11.19.0, Supabase 2.119.0, OpenSpec 1.14.0 and Vercel 62.5.0. Docker is reachable with no running containers at inventory time.
- Selected Supabase URL/reference in local configuration agree on `mriseqztcwmezvtawnbo`. CLI link metadata was absent and must be restored deliberately. Secret values are excluded from this ledger.
- Vercel team `justdodos-projects` owns `findmeatime` (`prj_OC4mdU9AkSV1fVkZ7uD8M3Dmv61U`), currently serving the root domain. No local Vercel link exists. The release subdomain needs DNS configuration; preserve the root deployment during the runtime spike.
- Local application origin still points to the root domain and needs release-specific configuration. AgentMail and iMessage webhook secrets are not yet configured locally. Existing remote channel consumers remain unverified; do not enable competing receivers before inspection.
- eve reference commit: `cebbc9b611be2b0eda728c731f675f592b57b100`. Both eve templates come from that checkout; no template auth/database is copied.

## Change ownership

| Owner | Responsibility |
|---|---|
| rebuild-application-foundation | Phase 0 ledger, shared contracts/authorization, admission/request rebuild, protected route shells and CI |
| validate-provider-and-agent-compatibility | Phase 1 runtime/model/topology decisions and all live provider/client evidence |
| connect-google-calendars | Host/requester Calendar, separate optional guest identity, timezone and callback binding |
| conversational-host-setup | Draft/review, suggestions, calendar analysis and OTP setup linking |
| evaluate-calendar-and-travel-feasibility | Candidate filtering, both travel legs, manual allowance and private exceptions |
| book-approved-proposals-reliably | Approval, reservations, dispatch/reconciliation, receipt and transactional delivery |
| email continuity (change to create before implementation) | Signed AgentMail ingestion and same-request requester conversation |
| iMessage continuity (change to create before implementation) | Linked host proposal review and decisions beyond setup |
| agent access (change to create before implementation) | Public skills, MCP OAuth, CLI, scoped grants and discovery |
| release hardening (change to create before implementation) | Operational limits/runbooks, final deployment and full completion audit |

## Runtime foundation evidence

Verified locally on 2026-10-07, Node 24.21.0/npm 11.19.0:

- Pinned eve 0.71.3, Next.js 16.4.0, React 19.2.8, AI SDK 7.0.105 and Zod 4.4.3. Separate `npm run build:eve` and `npm run build:web` pass; root `vercel.ts` follows the peer-service template. The initial deployed service composition passes HTTPS health and anonymous-denial checks; see the deployment record below.
- `npm ci`, `npm run check`, `npm run build` and `npm run test:runtime` pass. The smoke test starts the production outputs, checks web health/security headers and verifies anonymous denial at all seven eve session/stream endpoints. CI now executes these commands without provider credentials. Deny-all is temporary; actor/session ownership and recovery tests remain outstanding.
- Supabase CLI 2.119.0: all six retained pgTAP suites pass, 424 assertions. This proves the retained baseline on the local stack, not rebuilt application acceptance.
- `npm run verify:model` calls direct OpenAI through `eve/models/openai`, using native ID `gpt-6-luna`, low reasoning, a synthetic prompt and a required structured tool call. The call passed (56 input / 18 output tokens), with no scheduling tool execution. The selected model has a documented 1,050,000-token context window; metadata is explicit to avoid dependence on AI Gateway discovery. See [official model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).
- Missing/unapproved model configuration fails closed. Runtime refusal, quota/rate-limit, invalid-output and interrupted-turn behavior still need application-level verification. Only the current model is accepted until another is explicitly verified.
- A scan of 215 generated eve/web output files found none of the 15 configured secret values. Source-level client/server import enforcement remains to be added.
- Intended production persistence is managed Vercel Workflow; application authorization, grants, scheduling state and durable effects remain Supabase-owned. Shared memory and default agent tools are disabled. No extra worker/bridge is justified yet; restart/repeated-tool and Photon compatibility tests must settle that decision.

These results complete the initial build slice only. No user journey or release acceptance case is certified by them.

## Conversation access foundation (local)

Verified on 2026-10-07: the additive `conversation_access` migration rebuilds locally with all eight migrations; seven pgTAP suites now pass 466 assertions (42 new conversation-access cases). Tests cover two-host/two-request separation, private/shared scopes, revoked/rotated/expired credentials, logout, admission revocation, guest closure and the separate receipt boundary. pg-delta also emitted an identical drop/re-add of the existing booking event-ID check; review confirmed its range and alphabet are unchanged and no data/table is removed.

Ten application unit tests and four SMTP tests pass. A real local Supabase Auth integration test creates/removes a synthetic user, checks original-token verification, denies unadmitted access and direct authenticated RPC invocation, and confirms logout invalidates an otherwise unexpired execution credential. Public runtime session endpoints remain closed until authorized ingress, stream and tool adapters are complete. The new schema and shared modules do not yet certify foundation tasks 2.1–2.2 or any complete release case.

### Remote schema and deployment

Commit `2af4cef` adds the access boundary. On 2026-10-07, verified `FindMeATime2` (`mriseqztcwmezvtawnbo`, active, us-west-1), restored the CLI link, and confirmed the remote project had zero Auth users and no `fmat` schema. Reviewed `supabase db push --dry-run`, then applied the eight locally tested migrations with `supabase db push --yes`. No remote reset or test-user creation was performed. The follow-up dry run is current; remote security advisors report no issues. Remote grant inspection confirms anonymous access and ordinary authenticated execution access are false, while service execution access is true.

Production deployment `dpl_365B9d3LvJJLnP4rSjcHtBpMNgPP` at `https://findmeatime-release-i3vcbmon4-justdodos-projects.vercel.app` is `READY` and aliased to `https://release.findmeatime.com`. Added only the selected Supabase URL/keys and direct OpenAI key to the verified Vercel production project through stdin; no credential values are recorded here. All three public page/health probes return 200 and all seven anonymous eve session/stream probes return 401 after deployment. Application session adapters remain pending, so this is still a foundation deployment rather than a completed scheduling service.

## Conversation tool execution (local)

Verified on 2026-10-07: the ninth migration adds the service-only conversation-tool RPC and serializes its authorization with the command effect. Three authored eve tools expose scoped context reads, private notes and shared detail updates. They use the active caller, derive retry identity from the durable call and cannot record human decisions or provider outcomes. Shared results exclude private fields on both first execution and cached replay.

The complete local migration reset and seven pgTAP suites pass 499 assertions. Thirteen application unit tests and four SMTP tests pass. Four integration tests cover real Supabase Auth plus independent PostgreSQL transactions for tool-before-logout, logout-before-tool and expiry during a lock wait. The concurrency tests observe actual blocking locks before releasing either transaction. Separate eve/web builds and built-server anonymous-denial smoke checks pass. These tests establish the tool/database boundary, not process-crash recovery or a complete conversation journey; authorized ingress, durable dispatch acknowledgment and stream replay remain pending.

Deployed code commit `3433cac` on 2026-10-07. Reviewed the single pending migration in `supabase db push --dry-run`, applied it to the verified `mriseqztcwmezvtawnbo` project and confirmed no remaining migrations or security-advisor findings. The execution RPC is unavailable to anonymous/ordinary authenticated roles and available to the service role; a remote call with nonexistent execution authority is rejected. Vercel deployment `dpl_4duXssbFv4JW5PMHDBDZepHYYf95` (`https://findmeatime-release-q9ds7q7el-justdodos-projects.vercel.app`) is `READY` at `https://release.findmeatime.com`. All three public page/health probes return 200, all seven anonymous session/stream probes return 401, and `releaseReady` remains false. The upload preflight excluded credential files and local state; no additional provider receiver was enabled.

## Authorized conversation ingress and replay (local)

Verified on 2026-10-07: the tenth migration adds a service-only accepted-message inbox and canonical runtime binding. Custom conversation routes authenticate before open/read/send/stream, deny cross-request access, freeze input under a client UUID, serialize pending messages and reject silent replacement of a bound workflow. Default eve session/control routes remain denied. The inbox is temporarily capped at 200 messages per conversation, and text is bounded at 10,000 characters. Streams expose only text and safe lifecycle events, with per-event/idle authorization checks and cursor reconnect.

The full local reset and seven pgTAP suites pass 513 assertions. Eighteen application unit tests, four SMTP tests and four Auth/database integration tests pass. An actual eve 0.71.3 fixture uses the production channel and a deterministic mock model: a real details command commits, the process group is killed before the tool returns, `eve dev --resume` restarts the same workflow and a same-client-ID retry completes with no second revision. The model generates a different tool-call ID on replay; conversation/message/operation retry identity preserves the effect. A second message and cursor reconnect preserve continuity without replaying the first reply. Cross-request and revoked stream access are denied. `npm run test:conversations` runs this fixture in CI after local database setup, with no live model/provider calls.

The first crash-test attempts timed out after 30 seconds. Inspection of the pinned bundled Workflow runtime identified its default 860-second inline ownership lease. The isolated fixture sets `WORKFLOW_INLINE_OWNERSHIP_LEASE_SECONDS=5`; the resulting process-kill/replay test passes in about ten seconds. No production setting or framework file was changed. This establishes local replay after lease expiry, not the production recovery SLA.

Automatic recovery between database acceptance and runtime dispatch, managed Vercel recovery, complete host/private/shared runtime switching, browser credential exchange, remaining runtime controls and full product journeys are still pending. No foundation task or phase exit is marked complete by this slice.

Deployed code commit `3237895` on 2026-10-07. The reviewed tenth migration was applied to `mriseqztcwmezvtawnbo`; the follow-up dry run is current and remote security advisors report no issues. The inbox RPC remains service-only and browser roles cannot read its table. Vercel deployment `dpl_7ec7sqDp9io9E1woJ3CbEtFJyp8Z` (`https://findmeatime-release-ki6ln2ukb-justdodos-projects.vercel.app`) is `READY` at `https://release.findmeatime.com`. Three public page/health probes return 200; all eleven default/custom private route probes return 401 without credentials. `releaseReady` remains false. Upload preflight checked 162 regular source files against 16 configured secret values and found none; local credential/state files were excluded. No additional provider consumer was enabled.

## Accepted-message dispatch recovery

Local verification on 2026-10-07: two additional migrations add leased dispatch metadata and a minute Supabase Cron wake-up. Recovery scans the authoritative inbox, so it covers a crash between acceptance and runtime send without needing a queue publication. Claims use `FOR UPDATE SKIP LOCKED`, five rows per sweep and 90-second leases. Completion uses the lease token; an expired worker cannot acknowledge a new claim. Transport acknowledgment leaves the turn pending, with a five-minute retry delay until the runtime receipt settles. Current-grant denial retires pending input without starting model work. Canonical runtime identity still prevents silent replacement.

`npm run test:conversations` now simulates accepted input without any send and verifies recovery through the authenticated endpoint, preserving the second-message stream and cursor. The complete local reset passes 523 database assertions; 20 app and four SMTP tests pass. The schedule is inert until its two environment-specific Vault entries exist. These checks do not certify managed Workflow crash latency, the remaining session controls or full product journeys.

Deployed code commit `e07fe44` on 2026-10-07. All twelve migrations are current on `mriseqztcwmezvtawnbo`; remote security advisors report no issues and ordinary browser roles cannot invoke the dispatch RPC. The narrow dispatcher secret is configured only on the verified release Vercel project and matching Supabase Vault entries. Deployment `dpl_Fk1Dp4ZGGJimVohnt32X7Yy6sTfX` (`https://findmeatime-release-p1hcald3h-justdodos-projects.vercel.app`) is `READY` at `https://release.findmeatime.com`. Three public probes return 200 and all twelve private route probes reject anonymous callers. The authenticated empty dispatch sweep returns zero claimed/sent.

The actual `fmat-runtime-dispatch` cron tick at **2026-10-07 07:08 KST** reached the production endpoint and retired a synthetic message with an already-revoked grant as `failed` / `ACCESS_REVOKED`, with no runtime session created. No manual dispatch was invoked after inserting this fixture. Cron records show success; exact synthetic inbox/grant/scope/host/invitation rows were removed afterward. This proves the scheduled HTTP path and revocation guard, while the local deterministic fixture proves delivery to eve after a lost send. Neither substitutes for managed Workflow process-crash evidence. Upload preflight checked 167 regular source files against 17 configured secrets and found none.

## Browser access foundation

Verified locally on 2026-10-07: `/app` now supports email PKCE sign-in, waitlist submission, invitation redemption, reload and sign-out. `/booking/[bookingId]` exchanges a private fragment for a request-specific HttpOnly cookie and loads only the authorized state. The service-only browser RPC checks current Auth sessions and derives email from Auth records. Same-origin JSON mutations, private/no-store responses and server-only cookie refresh keep credentials out of browser JavaScript. The browser conversation and Calendar/setup controls remain pending.

The thirteenth migration rebuilds locally; seven pgTAP suites pass 531 assertions, including narrow browser-role permissions, identity derivation, expiry and cross-request denial. Twenty application tests, four SMTP tests and four Auth/concurrency integration tests pass. Playwright 1.63.0 with Chromium 153.0.8010.12 passes the actual local Auth/Mailpit → invitation → reload → logout journey, copied-session revocation, callback replay, forged cookies, private-link exchange/reload, separate-browser denial, closed-request privacy and waitlist deduplication. CI now installs Chromium and runs this browser test.

Visual verdict: pass for the access forms at desktop 1280×900 and phone 390×844, with readable labels, visible keyboard focus and no horizontal overflow at 320/390px. CSS 200% magnification also remains readable; native browser zoom and actual iPhone Safari/iMessage handoffs remain unverified. Test screenshots are local ignored artifacts. A same-path fragment-navigation bug was found and fixed; a response sequence guard prevents an older link exchange from replacing the current state.

Migration review caught a proposed cron unschedule because the named recovery job was missing from desired schema. The unapplied draft was discarded, the named schedule was added to its owning desired-schema file, and `20261006221555_browser_access.sql` was regenerated without the removal. Applied history is unchanged. The generated SQL adds one service-only browser RPC and repeats the existing, identical event-ID check constraint. Local security advisors report no issues. No complete phase exit or release acceptance case is certified by this access slice.

Selected-project Auth callback and Cloudflare SMTP configuration were applied through a sparse CLI config and verified by readback with no declared differences. Existing Google Auth/MFA settings were preserved. Production inbox delivery remains pending; local Mailpit delivery is separate evidence.

Deployed code commit `7c38bfc` on 2026-10-07. All thirteen migrations are current on `mriseqztcwmezvtawnbo`; the remote security advisor reports no issues. The browser RPC is denied to anonymous/ordinary authenticated roles and granted to the service role. The existing minute recovery cron remains active. Vercel deployment `dpl_9kE48XNAXuaYB38RUpF9LWWNU1bC` (`https://findmeatime-release-5ceipk06w-justdodos-projects.vercel.app`) is `READY` at `https://release.findmeatime.com`. Five public page/health probes return 200; fourteen private browser/runtime probes return 401. Cross-origin Auth submission returns 403 before sending email, and an invalid Auth callback stays on the release origin. Chromium renders the production sign-in page at phone width without horizontal overflow. Upload preflight checked 178 regular files against 12 configured credential values and found no matches.

Foundation task 3.1 is complete for the authenticated/protected route shells, safe Auth return, request credential exchange, CSRF, reload and private caching. Browser chat, Calendar consent/context restoration and complete scheduling journeys remain pending in their owning tasks; all AC and phase-exit gates remain open. The configured AgentMail inbox is readable, but CLI 1.9.0 returns `403 missing_permission` for webhook inspection because the runtime key lacks `webhook_read`. No production Auth email was sent into that mailbox while its consumer isolation is unverified.

## Browser conversation transport

Verified locally on 2026-10-07: admitted `/app` hosts and active `/booking/[bookingId]` requesters can send, stream and replay their authorized conversation through a cookie-authenticated web gateway. The gateway allowlists application routes, rejects arbitrary upstreams/framework controls, forwards current server-verified credentials and removes runtime-only fields. Absolute cursors deduplicate replay; completed text replaces partial blocks; retry after a lost acknowledgment uses the same message ID. Revocation aborts the reader and clears rendered history; closed requester access returns to the permitted receipt. Shared messages use a neutral participant label rather than claiming sender attribution.

Validation: `npm run check` passes 24 application and four SMTP tests, including gateway credential/route boundaries and transcript replay. Separate web/eve builds and production-server anonymous-denial smoke tests pass. The actual-eve process-kill fixture still verifies one committed tool effect and scheduled lost-dispatch recovery. The Chromium browser journey now uses a real isolated eve channel with a deterministic model and verifies host/requester messages, reload, one input after a lost POST acknowledgment, dropped-stream replay without duplicates, host/shared history separation and revocation while connected. CI runs that same fixture. No migration is introduced in this slice.

Visual verdict: pass for conversation rendering at desktop 1280×900, phone 390×844, 320px reflow and CSS 200% magnification. Labels remain readable and the existing keyboard focus checks pass. Native browser zoom, iPhone Safari/iMessage handoff and complete scheduling controls remain unverified. shadcn `radix-nova` components, `@shadcn/react` 0.3.1, AI Elements suggestions and Tailwind 4.3.3 are pinned/configured for the web application. Calendar setup, proposal decisions, provider journeys and full phase/acceptance gates remain open.

Deployed code commit `33bf27e` on 2026-10-07 to the verified release project. Deployment `dpl_ELNnstPqdktMpD9jkfx7cK8Migzh` (`https://findmeatime-release-kq1re5iaf-justdodos-projects.vercel.app`) is `READY` at `https://release.findmeatime.com`. Five public probes pass; five new browser-conversation probes reject anonymous callers with private/no-store headers, and cross-origin creation returns 403. Upload preflight checked 199 regular files against 13 configured credential values without a match. No database migration or provider configuration changed.

A controlled production Chromium test with an isolated synthetic request passed private-link exchange, the cookie gateway, a real direct-OpenAI response through managed eve, completed inbox/session binding, replay after reload, phone reflow, separate-browser denial and live revocation clearing visible history. The response correctly stated that host approval is required; no Calendar event, email or iMessage was sent. Exact synthetic database fixtures were removed and cleanup was checked separately. This proves a live conversation path, not managed process-crash recovery or complete booking. Both GitHub CI runs for `33bf27e` (`37543299329` and `37543305768`) passed, including clean dependency installation, builds, 531 database assertions, Auth/concurrency tests, actual-eve recovery and the browser journey.

## Bound Google Calendar consent

Verified locally on 2026-10-07: host and request-scoped Google consent uses S256 PKCE, nonce-bound signed OIDC identity, single-use browser state and original-credential revalidation before token persistence. Distinct scopes prevent requester event-detail access; AES-256-GCM protects provider credentials with state/principal-bound authenticated context. Connect/reconnect/disconnect controls stay in the protected conversation. New attempts and disconnect fence unfinished exchanges; revocation during the provider call prevents saving its result. A return query alone cannot claim a verified connection.

`npm run check` passes 27 application and four SMTP tests. Five integration tests pass, including real-database concurrent callbacks and a paused provider exchange followed by guest revocation. Both builds and runtime smoke checks pass. Eight pgTAP suites pass 559 assertions; local security advisors report no issues. The Chromium journey covers host/requester consent denial, wrong-browser binding, callback replay, safe returns and removal of state cookies. Google calls use fixtures for token-exchange cases; actual user consent, refresh and reads remain unverified.

Reviewed migration `20261006230858_calendar_consent.sql` adds credential bindings, a principal/time index and service-only consent functions. Its repeated event-ID check constraint is identical; no historical migration or recovery cron is removed. The complete fourteen-migration local reset passed. The selected release project was reidentified before a one-migration dry run and remote push; its security advisor reports no issues. Google client credentials and the preserved encryption key were added only to the verified Vercel production project. Exact release/local Calendar callbacks were saved and re-opened in Google Cloud; existing callbacks were preserved. The external app is In production with verification still required and a 100-user unverified cap. The remote consent RPC denies anonymous/ordinary authenticated execution and permits the service role.

Deployed code commit `b4ff7b2` to release deployment `dpl_AkDzrjCs7HuwFgHJz9eQSkUA1hhi` (`https://findmeatime-release-feovphwex-justdodos-projects.vercel.app`), verified READY at `https://release.findmeatime.com`. Upload preflight checked 212 regular files against 11 configured credential values with no matches. A controlled Chromium production probe passed anonymous/cross-origin denial, safe callback errors, account-free authorization URL/PKCE/scope checks, Secure HttpOnly browser binding, wrong-browser rejection, same-request denial return, cookie removal, replay rejection and disconnect fencing. Exact synthetic database fixtures were removed and cleanup verified. No Google grant, event or external message was created.

Visual verdict: pass for the consent card at 1280px desktop and 390px production phone width, with readable explanation/actions and no horizontal page overflow. Existing browser checks also pass 320px reflow, keyboard focus and CSS 200% magnification. Complete onboarding and actual iPhone Safari handoffs remain open.

Consent tasks 1.1–1.4 are complete. Calendar selection, refresh/reads, manual replacement, identity-only guest entry and live AC-27 remain open; this slice does not certify a complete phase exit.

## Initial production runtime deployment

On 2026-10-07, deployed commit `7b3085b` to Vercel project `findmeatime-release` (`prj_eCihziUF85AHPkfnFCNhBtdYlfnk`) in `justdodos-projects`. The checkout is explicitly linked to this project; the existing root-domain project is preserved.

- Deployment: `https://findmeatime-release-pabke1x4v-justdodos-projects.vercel.app`, ID `dpl_CTHF7nZfQ69BuMt2t9np3MjoJaun`, state `READY`.
- Production alias: [release.findmeatime.com](https://release.findmeatime.com). Both Next.js and eve were independently built by Vercel, including eve's Vercel Workflow output.
- Source-upload dry run excluded `.env`, `.env.local`, local secrets/caches and generated build outputs. Production config sets only the model ID and release origin at this stage; provider secrets are provisioned when their protected adapters are ready.
- After domain attachment, Vercel requested `A release.findmeatime.com 76.76.21.21`. Cloudflare dry-run preceded creation with `proxied: false`; readback confirmed the new record and byte-equivalent preservation of all 13 preexisting records. Nameservers remain Cloudflare. Public DNS resolves the required address.
- Public HTTPS `/`, `/api/health`, `/eve/v1/health` return 200; unauthenticated `POST /eve/v1/session` returns 401. App health reports `releaseReady: false`.
- Commands: `vercel project inspect --non-interactive`, `vercel deploy --prod --dry --json`, `vercel deploy --prod --yes --scope justdodos-projects --logs`, `vercel domains inspect release.findmeatime.com --scope justdodos-projects`, DNS lookup and direct HTTPS requests. Cloudflare CLI version: 1.0.0-beta.12; Vercel CLI: 62.5.0.

This establishes deployment and routing only. Session authorization, live model execution in Vercel, application persistence/recovery, provider callbacks and full booking journeys remain open.

## Acceptance matrix

All cases start pending for the replacement. Baseline SQL or former deployment results do not certify these cases. Owners refer to the table above.

| Case | Requirement | Owner | Required evidence | Result / evidence |
|---|---|---|---|---|
| AC-01 | Account-free complete booking | foundation, calendar, booking | Browser intake → agreement → explicit host approval → one live event | Pending |
| AC-02 | Two-leg travel and uncertainty | feasibility | Deterministic both-leg fixtures and live supported Routes probes | Pending |
| AC-03 | Private preference exceptions | feasibility | No hard-constraint override and guest projection redaction | Pending |
| AC-04 | Material revisions invalidate decisions | foundation, booking | Version changes clear applicable agreement/approval | Pending |
| AC-05 | Stale email option | email continuity | Replayed old email preserves current request/version | Pending |
| AC-06 | Concurrent and repeated approval | booking | Database concurrency and one provider event identity | Pending |
| AC-07 | Competing requests and new busy event | booking, feasibility | Reservation concurrency and final-read conflict injection | Pending |
| AC-08 | Lost successful Calendar response | booking | Fault injection plus live exact-event reconciliation | Pending |
| AC-09 | Revocation, rejected writes and delivery failure | calendar, booking | Recovery tests with separate event and delivery state | Pending |
| AC-10 | Private data and fabricated approval | foundation, booking | Direct API/tool bypass and projection tests | Pending |
| AC-11 | Email/web continuation | email continuity | Verified same-request live email/web journey | Pending |
| AC-12 | Different timezones and DST | feasibility | Ambiguous/nonexistent input and same-instant displays | Pending |
| AC-13 | Closed-state and withdrawal races | foundation, booking | Expiry/decline/withdraw guards before and after dispatch | Pending |
| AC-14 | Host/requester journeys in every client | compatibility | Separate dated live evidence for all seven clients | Pending |
| AC-15 | Requester delegated link handoff | compatibility | Each client negotiates within delegation and awaits host | Pending |
| AC-16 | Private iMessage review and decision | iMessage continuity | Live linked review/revision/approval and separate decline | Pending |
| AC-17 | Unlinked/group/ambiguous/stale iMessage | iMessage continuity | Transport negatives plus direct authority tests | Pending |
| AC-18 | Restart/replay and outbound failure | iMessage continuity, booking | Crash tests and live recovery with one booking | Pending |
| AC-19 | MCP consent and revocation | agent access | OAuth grant/deny/revoke and scoped operation tests | Pending |
| AC-20 | Invalid tokens and fabricated approval | agent access | Wrong issuer/audience/expiry/scope and Google-token rejection | Pending |
| AC-21 | Account-free requester agent grants | agent access | No cross-request read or host operations | Pending |
| AC-22 | MCP/CLI parity and retries | agent access | Same request/version/errors and machine-readable CLI | Pending |
| AC-23 | Host skill onboarding | compatibility | Both new and returning host in all seven clients | Pending |
| AC-24 | Requester skill entry | compatibility | Host resolution, missing data and approved live completion | Pending |
| AC-25 | Missing skill/client and consent denial | agent access | Unavailable/unknown host and truthful web continuation | Pending |
| AC-26 | Waitlist and invitation guards | foundation | Deduplication, recipient-bound concurrent redemption, direct bypass | Pending |
| AC-27 | Optional requester Calendar | calendar | Live request-bound consent plus read/revoke/privacy/fallback tests | Pending |
| AC-28 | Guided host setup | setup | Calendar scan fixtures, explicit policy review, mobile/keyboard and live consent | Pending |

## Phase exits

Phases 0–9 remain open until their complete exit conditions are evidenced. Current progress is recorded in each owning change; installing tools or writing this ledger does not complete a runtime or release gate.

## Explicit host calendar choices

Local verification on 2026-10-07: host Calendar listing and explicit conflict/booking selections run through cookie-authenticated routes and a service-only RPC. Confirmation re-fetches current Google access roles, rejects read-only or missing destinations and never falls back to primary. Auth, connection generation and setup revision are rechecked after provider work. Refresh preserves omitted refresh material, keeps credentials encrypted and cannot overwrite a newer grant. Guest callers cannot use this host adapter.

The fifteenth generated migration adds the connection generation and narrow access RPC and updates consent generation. Review confirms the repeated event-ID constraint is identical and the recovery cron/history are preserved. A complete disposable local reset passes 579 assertions across nine SQL suites; local security advisors report no issues. Thirty app and four SMTP tests pass, six real-Auth/database integration tests pass, and separate eve/web builds pass. Integration tests pause provider operations and verify reconnect/disconnect/logout fence their results; Google HTTP/refresh responses remain deterministic fixtures.

The browser fixture covers the actual list/select routes, explicit keyboard choices, read-only rejection, current selection persistence, duplicate calendar names and disconnect. Its outbound Google list response is synthetic and loaded only by the isolated test process. Initial visual review found invisible radio selection caused by generated checked-state selectors; selectors were corrected for installed Radix and a visible-state assertion was added. Actual Google grants, availability reads, requester recovery and complete scheduling/release gates remain open.

Visual verdict after correction: pass for desktop 1280px and phone 390px, with readable choices and a visible selected booking destination. Browser checks pass 320px reflow, keyboard choice and CSS 200% magnification. Actual iPhone Safari/native zoom remains pending. Task 2.1 is complete; task 2.2 remains open because requester refresh/read recovery is not complete. All phase exits and AC acceptance cases remain open.

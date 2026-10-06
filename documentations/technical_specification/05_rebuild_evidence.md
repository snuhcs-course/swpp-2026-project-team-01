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

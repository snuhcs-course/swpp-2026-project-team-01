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

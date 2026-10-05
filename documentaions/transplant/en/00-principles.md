# 00 — Product intent and design principles (AI-facing)

Source tree: `team-01` repo, branch `mvp/enu3379` @ `47a7b9c` (analysed 2026-10-06; 46 test files / 421 tests pass, `tsc --noEmit` clean). Later on the same branch: host place/meeting-type suggestions (F06) and awaited legacy routes — 49 files / 434 tests pass, `next build` succeeds.
App root: `apps/web` (Next.js App Router, TypeScript, Postgres via Drizzle + postgres-js, Tailwind v4, Zod, Ollama Cloud `gemma4:31b`).
Schema: `supabase/schemas/scheduler.sql` (30 `create table`; `conversations`/`messages` are legacy — the Drizzle `conversations`/`messages` objects map onto `booking_searches`/`search_messages`, see `server/db/schema.ts:54`) + `supabase/migrations/*` (3 migrations).

This folder describes **what the running code does**. Where the older design docs (`documentaions/mvp`, `documentaions/availability_onboarding`) disagree with code, code wins and the difference is listed in `transplant-guide.md §5`.
Evidence tags used below: `[code]` = read in source, `[commit]` = stated in a commit message, `[doc]` = stated in a design doc and consistent with code, `[inferred]` = my reading of intent, not stated anywhere.

## 0. Author's intent (confirmed by the author, 2026-10-06)

**Host.** The host should not pick available times, places and preferences one by one. The AI infers them from the connected calendar and the conversation, and the client chooses within that space. The AI's role ends at turning text and event titles into structured values. Hour estimates are statistical rules, availability is an algorithm, and preferences are must-filters plus scores. Every outcome therefore comes from a deterministic system, which keeps the risks of a probabilistic LLM (invented numbers, judgments that vary between runs) out of the results.

**Client.** The client finds bookable people through booking links. While the account is connected, the client uses the profile set up in advance and adds per-booking preferences through conversation only when needed, then sends a request. The profile shapes the first candidates, so preferences never have to be re-entered. Conversational changes are also only translated by the AI into filter/score commands, and the same deterministic engine produces the result.

**Resumability.** If the user steps away to check their schedule or loses the link, signing in is enough to pick up where they left off: contacts, previous searches and the saved profile persist.

Known differences from the current code (confirmed with the author):
- Host places and meeting types are now *proposed* from the past 8 weeks of business events and from what the host says (added 2026-10-06); because they are public to clients, each proposal is added only when the host presses **추가** (F06).
- Booking links never expire, only renew (F07). Acceptable per the author.
- Business/personal labelling is done by the LLM and correctable in the review dialog (F03). Acceptable per the author.

## 1. One-line product

A web app where two people's real calendars, meeting-hour rules and travel time are turned into a list of times they can **actually** meet; the requester narrows it down in natural language and sends a request; the host accepts or declines. A one-time onboarding turns the user's connected calendar into a personal "time profile" that pre-personalises every later search.

## 2. Principles that every feature follows

Each principle is a constraint to preserve when transplanting. Breaking one changes the product, not just the implementation.

| # | Principle | Where it is enforced | Evidence |
|---|---|---|---|
| P1 | **AI interprets, code decides.** The LLM only turns text into structured changes (filter commands, profile patches, event labels). Availability, scoring, ranking, counts and every number shown to the user are computed in code. | `llm/interpret.ts` (output = filter diff only), `llm/onboarding.ts` (output = profile patch only), `llm/classify.ts` (output = label indexes only); slots in `core/slots.ts`, ranking in `core/filter.ts` | `[code]` `[doc]` one_pager §2 |
| P2 | **The AI never invents reasons.** Explanations are generated from a code-computed basis (`SelectionBasis`) and rendered by a deterministic template. In the live journey no LLM writes user-facing sentences. | `core/explain.ts` `basisSentence`; `server/services/search.ts:47`; `llm/onboarding.ts` `explainOnboarding` ignores its client | `[code]` comment "Computed in code so the wording layer cannot invent reasons" |
| P3 | **Nothing inferred is applied until the user confirms it.** History analysis produces *estimates* worded as estimates; it never writes profile values. A draft never affects booking; only an explicitly confirmed profile version does. | `core/briefing.ts`, `core/analysis.ts` ("Observations only"), `services/profile.ts confirmProfile` | `[code]` `[commit c0ccfb9]` |
| P4 | **Past behaviour ≠ future permission.** Late meetings in history never open late meeting hours; analysis says so explicitly. | `core/analysis.ts:346`, `core/briefing.ts:441` | `[code]` |
| P5 | **Must vs. prefer.** "Must" conditions remove candidates; preferences only reorder. A preference mismatch is explained, never turned into zero results. Must conditions are never relaxed automatically. | `core/filter.ts applyFilter/scoreSlotUnits`, `core/summary.ts outcome/relax` | `[code]` |
| P6 | **Client first, host as tie-breaker.** Host preferences only order candidates whose client score (and explicit time order) are exactly equal. No "close enough" tolerance. | `core/filter.ts compareMeaningful` | `[code]` |
| P7 | **This search vs. my defaults.** Per-search conditions inherit, override or disable profile defaults dimension by dimension; editing a search never edits the profile. | `core/preferences.ts resolvePreferences`, `services/search.ts mutateSearch` | `[code]` |
| P8 | **Never silently stale.** Every booking action re-fetches connected calendars first; any data change marks shown candidates stale and disables them; failures keep the last good data and say so. | `services/preflight.ts`, `services/search.ts readSearch.candidateState`, `components/calendar/RefreshCalendarButton.tsx` | `[code]` |
| P9 | **Show conflicts, never auto-resolve.** A confirmed meeting that later overlaps an external event is flagged to its owner, not cancelled. | `core/week.ts findConflicts`, `services/schedule-view.ts conflictingRequestIds` | `[code]` |
| P10 | **Privacy boundary.** The other person sees only public places/meeting types and candidate times. Conflict checks read only the viewer's own calendar. Event titles are untrusted data in prompts. Logs never contain titles, places, message bodies or tokens. | `schedule-view.ts:78` comment, `llm/classify.ts SYSTEM`, `calendar-sync.ts:142` | `[code]` |
| P11 | **Every mutation is idempotent and revisioned.** Client sends an `Idempotency-Key`; server stores the operation; UI can "check result" after an ambiguous failure instead of re-submitting. Optimistic `expectedRevision` on every editable resource. | `services/operations.ts`, `components/hooks/useMutationOperation.ts` | `[code]` |
| P12 | **Manual path always exists.** Calendar connection is optional; AI failure leaves manual editing fully working; chips can be edited without AI. | `CalendarSettings` "Calendar 없이 직접 설정하기", `OnboardingWorkspace` manual editor, chip × buttons | `[code]` |
| P13 | **Reach is by invitation.** You can only book people you are connected with through a booking link (both modes). | `services/contacts.ts canBook` | `[code]` `[commit 9819e71]` |

## 3. Fixed product constants (verified)

| Constant | Value | File |
|---|---|---|
| Time zone | Asia/Seoul, fixed +09:00 (no DST) | `core/time.ts` |
| Booking horizon | today 00:00 KST + 60 days | `core/time.ts HORIZON_DAYS` |
| Slot start grid | 30 min | `SLOT_STEP_MIN` |
| Minimum lead time | 2 h (0 h when re-validating at accept) | `MIN_LEAD_HOURS`, `acceptMeeting` |
| History analysis window | 56 days before the import day | `services/analysis.ts`, `calendar-sync.ts` |
| Preference weights | strong 10, weak 3 (integer units × 7,200,000) | `core/filter.ts` |
| Slack scoring cap | 120 min | `core/filter.ts SLACK_FULL_MIN`, `core/slots.ts SLACK_CAP_MS` |
| Candidates shown | max 3, same-day starts ≥ 60 min apart (then fill by rank) | `core/options.ts` |
| Request message | 1–500 chars, required | `contracts/booking.ts` |
| Meeting type length | 5–480 min, step 5 (UI) | `components/HostSettings.tsx` |
| LLM call timeout | 20 s, key rotation on 401/403/429 | `llm/ollama.ts` |
| Operation hard timeout | 90 s (search/onboarding/analysis) | services |
| Invite token | 24 chars base64url (18 random bytes) | `services/contacts.ts` |

## 4. Two run modes

`APP_MODE=demo|real` (`server/config.ts`). A database binds to one mode forever (`bindDatabaseMode`).
- **demo**: seeded accounts, header user switcher (cookie `uid`), "예시 Calendar" built from seed events (`providers/mock-calendar.ts`), persona profiles pre-confirmed (`server/db/persona-profiles.ts`), contacts pre-seeded (김민준↔박지호, 김민준↔최하나; 이서연 left unconnected to demo the link flow).
- **real**: Google sign-in (OpenID), separate Calendar consent, sessions in DB (`mvp_session` cookie, 7 days), refresh tokens encrypted (`TOKEN_ENCRYPTION_KEY`), HMAC impact tokens (`IMPACT_SIGNING_KEY`).

## 5. File map of this folder

- `01-journey-map.md` — end-to-end journeys and how each screen hands off to the next.
- `features/F01…F11` — one file per transplantable feature, same template.
- `design-system.md` — tokens, type scale, primitives, copy rules.
- `cross-cutting.md` — idempotent operations, revisions, preflight receipts, LLM safety, privacy, logging.
- `transplant-guide.md` — dependency graph, recommended order, minimal subsets, dead code, known gaps, doc-vs-code differences.

# F02 — Calendar connection, selection, import and refresh

## Intent
- Use the user's real schedule (times **and** places) so availability is true, not self-reported. `[doc]`
- Read-only, one Google account, several selected calendars. Never write to Google. `[doc PRD decision A]` `[code scopes]`
- An import is all-or-nothing: a partial failure must never look like an empty calendar or delete good data. `[code]` `[doc FR-17]`
- Respect what the source says about busyness (declined, free, cancelled, working-location) instead of guessing. `[code]`

## How the user is led (`components/calendar/CalendarSettings.tsx`)
- Page header "Calendar 연결", description "선택한 캘린더를 읽어 기존 일정과 겹치지 않게 준비해요. 과거 8주 관찰과 앞으로 60일의 일정을 사용해요." Status pill: 직접 설정 사용 / 일정 반영 중 / 일정을 가져와 주세요 / 권한 재연결 필요 / Calendar 없이 계속할지 선택해 주세요.
- `Stepper` steps `연결 · 캘린더 선택 · 일정 가져오기 · 시간 프로필`, current step derived from state.
- Card 1 "1. 계정 연결": real → Google button (turns into disabled "✓ Google Calendar 연결됨"); "Calendar 없이 직접 설정하기" link. Demo → "예시 Calendar 연결" / "✓ 예시 Calendar 연결됨 · Google에는 접속하지 않아요". "캘린더 목록 새로고침". Shows "과거 분석 기준" and "일정 확인" timestamps once imported.
- Card 2 "2. 사용할 캘린더": checkbox per calendar with description `일정 정보|바쁜 시간만 · <timezone>`. Actions: **저장하기**, **AI로 설정 시작하기** (primary), **연결 해제 · 가져온 정보 삭제** (danger). Helper text explains both buttons and "미팅 가능 시간은 직접 확인해야 확정돼요."
- Right after OAuth returns, the calendar list is fetched automatically (`autoListed` effect).
- Default selection = previously saved selection, else every calendar with full detail access.
- On `/calendar`: "일정 새로 가져오기" + "연결 관리"; failure keeps stored data and says so.

## Rules (verified in `server/services/calendar-sync.ts`, `core/calendar.ts`)
- **Windows**: `full` scope = KST day start − 56 d − 3 h … + 60 d + 3 h; `future` scope = today − 3 h … + 60 d + 3 h. Full import sets both `analysis_snapshot_id` and `schedule_snapshot_id`; future refresh only replaces the schedule snapshot.
- **Snapshots**: each successful sync writes a new `calendar_snapshots` row + `imported_events` + `imported_busy_intervals`, bumps `generation`, then deletes snapshots nothing points to and no analysis used (`commit 6c6d497`).
- **Single flight**: `service_leases` row per connection; concurrent sync → `calendar_busy`. Lease fenced; stale finisher → `operation_lease_lost`.
- **Limits**: 100 pages, 50,000 items, 60 s sync deadline; Google request 15 s × 2 attempts; 401/403 → `calendar_reconnect_required` (connection status `reconnect_required`).
- **Free/busy-only calendars** (`accessRole=freeBusyReader`) are read through the freeBusy API and stored as anonymous busy intervals.
- **Conversion** (`convert`): cancelled → dropped; zero-length entries → dropped (`commit 47a7b9c`); end-before-start/unparseable → whole sync fails with `calendar_fetch_failed` and a shape-only log `calendar.event_invalid_time`. Offset-less dateTime is rejected. All-day uses date + calendar time zone. `hasOnlineLink` = hangoutLink or conferenceData. Initial `kind`: online only when there is a link and no location; else `none` (place text kept in `placeRef`).
- **Normalisation** (`normalizeCalendarEvents`):
  - Busy unless cancelled, declined by me, `transparent`, or `workingLocation`. Tentative / needsAction **are** busy.
  - Copies are merged only by provider identity (`iCalUID` + original start); same title/time never merges. Conflicting copies block time and become travel anchors with unknown location.
  - All-day events block the day but are never travel anchors.
  - Location: user confirmation wins; place text **and** online link together → ambiguous → `none` (needs confirmation); never auto-decide attendance mode.
  - Analysis events exclude all-day and non-default types (focusTime, outOfOffice, workingLocation, freeBusy).
- **Selection change** clears derived analysis, classifications and annotations of deselected calendars, bumps revisions, sets state `needs_refresh` (or `decision_required` if none selected).
- **Disconnect** deletes sources, snapshots, analyses, classifications, annotations and the refresh token; state → `decision_required`; app events, profile and requests stay. "Calendar 없이 계속" sets state `manual`.
- **Catalog refresh**: if a selected calendar disappeared or its access role changed, derived data is cleared and state → `needs_refresh`.
- **Persons for slot computation** (`services/schedule.ts loadPerson`): app events (`seed|manual|booking`) + selected imported events (with annotations projected) + busy intervals → `busyIntervals` and `travelAnchors`. If calendar state is not manual/not_connected and not fully connected with a snapshot → `calendar_decision_required`.

## Data / API
- Tables: `calendar_connections`, `calendar_sources`, `calendar_sync_runs`, `calendar_snapshots`, `imported_events`, `imported_busy_intervals`, `service_leases`; `users.calendar_use_state` ∈ `not_connected|manual|needs_refresh|connected|decision_required`.
- Routes (all POST are idempotent operations): `GET /api/calendar` → `CalendarConnectionView`; `POST /api/calendar/catalog`, `/selection {expectedSelectionRevision, calendarIds}`, `/sync {expectedSelectionRevision, scope?}` → `SyncView`, `/disconnect`, `/decision {expectedRevision, choice:'continue_without_calendar'}`, `/mock-connect` (demo).
- Provider port: `CalendarProvider {listCalendars, listEvents, freeBusy}` — Google and mock implementations (`server/providers/*`, chosen in `server/calendar-context.ts`).

## Code map
`server/services/calendar-sync.ts`, `core/calendar.ts`, `server/providers/google-calendar.ts`, `server/providers/mock-calendar.ts`, `server/services/mock-calendar.ts`, `server/calendar-context.ts`, `server/services/schedule.ts`, `components/calendar/{CalendarSettings,RefreshCalendarButton}.tsx`, `app/(app)/settings/calendars/page.tsx`, `contracts/calendar.ts`.

## Depends on / used by
Depends on F01 (calendar consent) and cross-cutting operations. Used by F03, F04, F08 (busy + travel anchors), F09/F10 (preflight refresh), F11.

## Transplant unit
- **Minimum valuable**: `core/calendar.ts normalizeCalendarEvents` + `convert` rules. They are pure and carry most of the correctness (busy semantics, dedup, ambiguous locations). Any provider can feed `CalendarSourceInput`.
- **Full**: snapshots + leases + generation checks if the target needs "never show partial data". Can be simplified to "replace all rows in one transaction" if concurrency is not a concern.
- The two-button finish (저장하기 vs. AI로 설정 시작하기) is the hand-off into F03–F05; keep it if those are transplanted.

# F06 — Host setup: places, meeting types, readiness

## Intent
- The host controls *where* and *how long*; the client never picks these separately — every candidate is a (time, place, meeting type) triple. `[doc one_pager §4.2]` `[code computeSlots]`
- One person can be host and client; there are no role-specific screens. `[doc app_screen_list]` `[code nav]`
- Be explicit about why someone cannot receive requests. `[code copy]`

## How the user is led (`app/(app)/settings/host/page.tsx`, `components/HostSettings.tsx`)
- `PageHeader` eyebrow 설정, title 호스트 설정, description "장소와 미팅 양식을 등록하면 다른 사람이 나에게 미팅을 요청할 수 있어요.", action badge **예약 받는 중** (success) / **예약 받을 수 없음** (warn).
- Warning alert while not ready: "현재 예약을 받을 수 없어요. 장소와 미팅 양식을 각각 하나 이상 등록해 주세요."
- Booking-link card (F07).
- **제안으로 채우기** card (`components/HostSuggestions.tsx`, added 2026-10-06 after `47a7b9c`): "지난 8주 업무 일정에서 자주 나온 장소와 미팅 길이, 또는 말씀하신 내용으로 제안해요. 추가하기 전에는 다른 사람에게 보이지 않아요."
  - Calendar proposals (code, `core/host-suggestions.ts`): from the analysis window's **business** events ≤ 3 h — location texts seen ≥ 2 times (top 3; kind guessed `office_near` if the event is marked office or the text matches 회사/사무실/오피스/본사/office, else `special`), "온라인" if ≥ 2 online events or meeting-link locations, and durations rounded to 15 min seen ≥ 2 times (top 3, named "N분 미팅"). Already registered names/online/durations are not proposed. A user-confirmed location (even "unknown") overrides the source text; user labels override AI labels.
  - Spoken proposals: textarea "말로 알려 주기" → **제안 받기** → `POST /api/host-setup/interpret {text}` → `llm/host-setup.ts` extracts `{places[{kind,name}], meetingTypes[{name,durationMin}]}` (JSON mode, temperature 0, each item Zod-validated separately, duration 5–480 in 5-min steps, greeting guard, 1 retry, no retry when the service is unreachable, existing names dropped). Changes nothing server-side.
  - Each proposal row: kind select (places) + editable name + note "지난 8주 N건" / "말씀하신 내용" + **추가** → the normal `POST /api/places` / `/api/meeting-types`, then refresh. Nothing is published until **추가**.
  - Empty states: no calendar import → link to Calendar 연결; no business events → points to the profile analysis; nothing repeated → says so with the count.
- Two cards side by side:
  - **장소** — "만날 수 있는 장소예요. 이름을 고치면 자리를 벗어날 때 저장돼요." Row = kind select (회사 근처 / 특정 장소 / 온라인) + name input (saves on blur; kind saves on change) + delete with inline confirm "삭제할까요? [삭제] [취소]". Add form at bottom.
  - **미팅 양식** — "요청자가 고를 수 있는 미팅 이름과 길이예요." Row = name + minutes (5–480, step 5) saved on blur. Add form placeholder "예: 45분 리뷰".
- Empty lists render a dashed "등록된 장소가 없어요." / "등록된 양식이 없어요."

## Rules (verified)
- Place kinds: `office_near | special | online` (`core/types.ts PlaceKind`) — they select a row of the host travel table (F08).
- Bookable host = ≥1 active place and ≥1 active meeting type (`services/schedule.ts isBookableHost`, `/book` card state).
- Requests snapshot the place and meeting type (`place_snapshot_json`, `meeting_type_name_snapshot`, `duration_min_snapshot`). Accept fails with `meeting_definition_changed` if the definition changed after the request (F10).
- Places/types carry `revision` and `active`; delete is a soft delete (`active=0`, `server/repos/hosting.ts`), lists show active rows only; changes enter `dataBasis`, so open searches become stale (F09).

## Data / API
Tables `places`, `meeting_types`. Routes `POST /api/places {kind,name}`, `PATCH|DELETE /api/places/:id`, `POST /api/meeting-types {name,durationMin}`, `PATCH|DELETE /api/meeting-types/:id` (legacy `call()` helper, not idempotent operations).

## Code map
`components/HostSettings.tsx`, `components/HostSuggestions.tsx`, `app/(app)/settings/host/page.tsx`, `server/repos/hosting.ts`, `server/services/host-suggestions.ts`, `core/host-suggestions.ts`, `llm/host-setup.ts`, `app/api/places/*`, `app/api/meeting-types/*`, `app/api/host-setup/interpret`. Tests: `tests/core/host-suggestions.test.ts`, `tests/llm/host-setup.test.ts`, `tests/server/host-suggestions.test.ts`.

## Why suggestions are never auto-added
Places and meeting types are public to clients (booking cards, candidate labels), while calendar location text can be private (a clinic, a home address). Only business events are read, and every proposal waits for the host's **추가** — the same "infer, then the user confirms" rule as the time profile (P3). Using real calendar location names as place names also makes the travel rule "same place = 0 min" (`core/travel.ts sameLocation`, which compares the event's place text with the place name) match the host's own events.

## Transplant unit
Small and self-contained. If the target already has "event types", map them to `MeetingType {id,name,durationMin}` and add a place list with the three kinds; the kind is what makes travel rules possible.

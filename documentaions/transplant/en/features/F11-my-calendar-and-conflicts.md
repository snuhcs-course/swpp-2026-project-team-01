# F11 — My calendar (week view) and post-confirmation conflicts

## Intent
- Show the user what the app is computing from: app events, confirmed meetings, imported calendar items and the meeting windows of each day. `[doc US-2]` `[code page description]`
- One appointment on several selected calendars appears once — but only when the provider says it is the same; look-alikes are not merged. `[code comment schedule-view.ts:22]`
- A confirmed meeting that later collides with a newly added/moved external event is flagged to its owner and never cancelled; only the viewer's own calendar is consulted. `[code comment schedule-view.ts:73]` (P9, P10)

## How the user is led (`app/(app)/calendar/page.tsx`)
- Header "내 캘린더" — "이 앱에서 만든 일정, 확정된 미팅, 연결한 Calendar 일정이에요. 날짜마다 미팅 허용 시간을 함께 보여줘요." Week nav 이전 주 / `YYYY-MM-DD ~ YYYY-MM-DD` / 다음 주 (weeks 0…8, disabled at the ends).
- Status line: connected → "Google 일정을 함께 보여줘요(읽기 전용). 선택한 캘린더 … · 마지막으로 가져온 시각 …" + 일정 새로 가져오기 + 연결 관리; `needs_refresh` → "캘린더 선택을 저장했어요. 일정을 가져오면 여기에 보여요."; `reconnect_required` → re-connect link; not connected → "Calendar를 연결하면 그 일정도 여기에 보여요. 지금은 이 앱의 일정 기준이에요."
- 7 day columns (stacked on mobile): date with weekend muted, today ring + 오늘 pill; under the date the day's meeting windows `10:00–12:00, 13:00–18:00` or "허용 시간 없음".
- Entry styles (left 3 px rule):
  - imported event: primary-soft tint, `HH:MM–HH:MM`, title, "(미정)" if tentative, "Google · N개 캘린더" — clickable → detail panel (F03).
  - all-day: "종일" + title.
  - busy-only calendar: grey, "바쁨만 공유된 캘린더", not clickable.
  - confirmed meeting: success tint, "확정 미팅 · <place>" — clickable panel.
  - app event (seed/manual): grey with inline delete (confirm "삭제할까요?").
  - badges: imported item "확정 미팅과 겹쳐요"; meeting "겹치는 외부 일정 N건".
- "일정 추가" form below: 제목, 날짜, 시작, 끝, 장소 (장소 없음/회사/다른 장소/온라인 + name).
- Panel overlap section: "이 일정은 이미 확정된 미팅과 시간이 겹쳐요." / "이 미팅을 확정한 뒤 겹치는 외부 일정이 생겼어요." + "확정 미팅은 자동으로 취소되지 않으니 직접 확인해 주세요." + the related items.
- Request cards (F10) for accepted meetings with a conflict show "확정한 뒤 내 Calendar에 겹치는 일정이 생겼어요. 미팅은 자동으로 취소되지 않아요. 내 캘린더에서 확인" linking to the right week.

## Rules (verified, `server/services/schedule-view.ts`, `core/week.ts`)
- Items come from the current schedule snapshot only; the page never refreshes Google by itself (`checkedAt` tells age).
- Excluded: cancelled, transparent, declined by me, workingLocation — same as availability.
- Dedup: group by `iCalUID + original start`; merge only if title, times, all-day and status are identical; otherwise list separately.
- All-day placement uses the calendar's own dates (end exclusive); timed items appear on every day they overlap and are clipped to the day.
- In demo with the example calendar connected, seed events are not listed twice (`shownEvents`).
- `findConflicts(bookings, items)`: plain interval overlap; `conflictingRequestIds` checks upcoming booking events only.

## Data / API
Server-rendered; mutations `POST /api/events {title,date,start,end,kind,placeRef}`, `DELETE /api/events/:id`, `POST /api/calendar/sync`.

## Code map
`app/(app)/calendar/page.tsx`, `server/services/schedule-view.ts`, `core/week.ts`, `components/{EventForm,DeleteEventButton}.tsx`, `components/calendar/{CalendarEventPanel,RefreshCalendarButton,format}.tsx`.

## Transplant unit
`core/week.ts` and `listCalendarItems` are portable; the week grid is plain Tailwind. The conflict badge + "never auto-cancel" copy is the part that expresses the product stance.

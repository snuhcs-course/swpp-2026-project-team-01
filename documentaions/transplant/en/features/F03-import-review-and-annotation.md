# F03 — Import review, per-event correction and event detail panel

## Intent
- Let the user see what the AI made of their calendar **before** it shapes the profile, and fix it cheaply. `[commit a93465e]`
- Show the review only where it says something: before the AI has classified anything almost every event is "확인 필요", so the plain save path skips it. `[commit ac41f06]`
- Corrections change only this app's interpretation, never the Google original. `[code copy]`
- When the source later changes, a previous correction is not silently trusted. `[code needsConfirmation]`

## How the user is led
- **Review dialog** (`components/calendar/ImportReviewDialog.tsx`), opened only at the end of "AI로 설정 시작하기":
  - Title "가져온 일정 확인", subtitle "분류와 장소가 맞는지 살펴보세요. 고친 내용은 이 앱에만 적용되고 Google 일정은 바뀌지 않아요."
  - Tabs **분류별** (업무 / 개인 / 확인 필요 + hint "AI가 업무·개인을 판단하지 못한 일정") and **장소별** (회사 / 장소 / 온라인 / 알 수 없음). Category tab is limited to the 8 analysed weeks with note "분류는 AI가 살펴본 지난 8주 일정만 보여요. 앞으로의 일정은 장소별에서 확인해요." `[commit 1843e51]`
  - Each group is a `<details>` with a count badge, auto-open when 1–8 items.
  - An AI suggestion counts as the group until the user decides (`classOf`).
  - Footer: "보정 내용이 저장됐어요" when anything changed + primary "확인했어요 · AI 설정 계속". Esc / backdrop closes. Mobile: bottom sheet.
- **Per-event editor** (`EventEditor` → `EventAnnotationForm`): summary row with badges (다시 확인 필요 / category / "AI 제안 · 업무" / place); form fields 분류 (확인 필요/업무/개인; hint shows the AI suggestion), 장소 (알 수 없음/회사/직접 지정/온라인; "직접 지정" reveals a name input); **보정 저장**; shortcut link "AI 제안(업무) 적용".
- **Detail panel** (`components/calendar/CalendarEventPanel.tsx`), opened from any item in `/calendar`: right-side `<dialog>`; sections "Google에서 가져온 원본 (읽기 전용)" (calendar, 상태 미정/확정, 바쁨 여부, 제공된 장소, 화상회의 링크 있음/없음) and "내가 보완한 내용 (이 앱에만 적용돼요)" with the same form and the note "화상회의 링크가 있어도 참석 방식을 자동으로 정하지 않아요." Overlap section (see F11). Focus returns to the clicked entry on close.

## Rules (verified)
- Annotation = `{classification?, locationKind?, placeRef?}` stored per (connection, calendar, provider event id) in `event_annotations` with field fingerprints of the source at save time (`services/annotations.ts`).
- Save requires the current `sourceFingerprint` (else `source_changed`) and `expectedRevision`.
- Projection (`core/annotations.ts projectAnnotation`): a saved location/classification is applied **only if the source field fingerprint still matches**; otherwise the view shows "다시 확인 필요" and "원본이 변경돼 보정 내용을 다시 확인해 주세요."
- Saving bumps `users.annotation_revision` and `schedule_revision` (invalidates analyses and marks searches stale).
- Classification precedence: user > provider > AI (`core/analysis.ts resolveClassification`).
- After the dialog, re-analysis runs only if something changed (`CalendarSettings.finishReview`).
- List query is one SQL statement (supplements + newest AI proposal joined) limited to 500 newest events (`listImportedEvents`) — `[commit 1843e51]` latency fix (44 s on Vercel before).

## Data / API
- `GET /api/imported-events` → `ImportedEventView[]`; `GET /api/imported-events/:id` → `ImportedEventDetail`; `POST /api/imported-events/:id/annotation {expectedRevision, sourceFingerprint, patch}`.
- `ImportedEventView`: `eventId, title, startAt, endAt, allDay, startDate, endDate, timezone, revision, sourceFingerprint, patch, needsConfirmation, locationKind, classification, aiClassification`.

## Code map
`server/services/annotations.ts`, `core/annotations.ts`, `components/calendar/{ImportReviewDialog,ImportedEvents,EventAnnotationForm,CalendarEventPanel,format}.ts(x)`, `contracts/calendar.ts`.
`ImportedEvents` (searchable list component) is defined but not mounted anywhere (grep found no JSX usage); only its `EventEditor` export is used.

## Depends on / used by
Depends on F02 (imported events) and F04 (AI suggestions). Feeds F04 (classification), F08 (confirmed locations change travel), F11 (panel).

## Transplant unit
- Copy dialog + form + projection rule together; the fingerprint rule is what keeps corrections honest.
- If the target has no AI classification, keep the **장소별** tab and location correction only.

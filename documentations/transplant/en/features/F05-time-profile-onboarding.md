# F05 — Time profile: draft, three topics, chat-assisted editing, explicit confirmation

## Intent
- Separate three things people conflate: **근무시간** (background, never blocks time by itself), **미팅 허용 시간** (hard rule both sides must satisfy for the *whole* meeting), **기본 선호** (only reorders). `[doc one_pager §3]` `[code]`
- The profile is applied only when the user explicitly confirms all three topics; a draft never affects booking; the AI's reply never completes setup. `[code confirmProfile]` `[doc FR-37]`
- New users get no invented default hours: no profile → no bookability. `[code getRules comment]` `[doc FR-06]`
- Chat and manual editing edit **the same draft**; manual is always available. `[code]`
- The profile is reusable across hosts, so preferences cannot reference a specific host's place or meeting-type ids. `[doc decision D]` `[code ProfilePreferences]`

## How the user is led
- Entry (`components/onboarding/OnboardingEntry.tsx`): card "시간 프로필 설정" — "근무시간, 미팅을 허용할 시간, 추가 선호를 직접 입력하거나 AI와 대화하며 설정해요. 마지막 확인 전까지는 초안으로만 저장돼요." → **설정 시작**. From the AI path the draft is created automatically.
- Workspace (`OnboardingWorkspace.tsx`), `Stepper` `직접 설정·대화 → 최종 확인 → 완료`, title "나에게 맞는 미팅 시간":
  - **직접 설정** card (`ProfileEditor`): note "모든 시간은 한국 시간(KST)이에요. 근무시간과 미팅 허용시간은 별도로 설정해요."
    - "고정 근무시간 없음" checkbox; otherwise `WeeklyWindowsEditor` "근무".
    - `WeeklyWindowsEditor` "미팅 허용": rows of *time range + weekday chips* (월…일), "평일에 적용", "구간 삭제", "+ 구간 추가"; hint "요일을 여러 개 고르면 같은 시간이 모두에 적용돼요. 점심시간은 구간을 나누어 제외할 수 있어요. 하루의 끝은 24:00으로 입력하세요."
    - `PreferenceEditor` "기본 선호": 선호 요일 / 선호 시작 시간 / 미팅 방식 / 미팅 사이 여유, each with strength select 선호 없음 · 가능하면 (weak) · 중요해요 (strong). Picking a strength fills a sensible default (weekdays, 09:00–18:00, online).
    - "주제별 확인" box: three checkboxes "근무시간을 확인했어요 / 미팅 허용시간을 확인했어요 / 기본 선호를 확인했어요 (선호 없음 포함)" with counter n/3; "세 주제를 모두 확인해야 최종 확정할 수 있어요."
  - **Chat** (`OnboardingChat`): heading "말로 설명해도 좋아요", placeholder example "평일 10시부터 5시까지 미팅 괜찮고, 점심 12–1시는 비워 주세요.", assistant name "설정 도우미".
  - **Week chart** (`WeekSchedule`): Mon-first 24 h tracks; grey bar = 근무 (top), teal bar = 미팅 허용 (bottom); caption "근무 / 미팅 허용 · 외부 일정의 빈 시간 조회 결과는 아니에요."; invalid input → chart keeps last saved values with a warning.
  - Sticky bar: status pill 저장됨 / 미저장 변경이 있어요 / 저장 중… / 저장 결과 확인 필요, "주제 확인 n/3", **최종 확인**.
- Review state: `ProfileSummary` table (근무 / 선호 요일 / 선호 시작 시간 / 미팅 방식 / 미팅 사이 여유) + chart + "초안은 저장돼 있어요. 확정하기 전까지는 현재 적용 중인 프로필이 바뀌지 않아요." Buttons 돌아가서 수정 / **이 설정으로 확정**.
- Done: "프로필 설정을 완료했어요." → 내 프로필 보기 / 예약하기.
- `/settings/availability`: "적용 중인 시간 프로필 · 버전 N" + badge 적용 중 + chart, then the editor in edit mode.

## Rules (verified)
- **Values** (`core/profile.ts`): `work {mode: fixed|none, windows}`, `meetingWindows: WeeklyWindow[]`, `preferences {weekdays, startTime, meetingMode, slack}` each `{value, strength: strong|weak} | null`.
- Windows: weekday 0=Sun…6=Sat, integer minutes, `0 ≤ start < end ≤ 1440`, same-day only (cross-midnight must be split), overlaps merged by `normalizeWindows`.
- `validateProfile`: `fixed` requires ≥1 work window, `none` requires none; unknown keys rejected; weekday+startTime preferences must overlap at least one meeting window (else `preference_conflict`). Empty meeting windows are valid (= not bookable).
- **Draft lifecycle** (`services/profile.ts`): one active draft per user. Create: from current profile (topics pre-confirmed if origin=user) or, without profile, from legacy `availability_rules` (topics unanswered). Patch with `expectedRevision`; confirm requires all topics `confirmed`, `baseProfileVersion` unchanged (`profile_version_conflict`), valid values → inserts `profile_versions(version+1, origin='user')`, sets `users.current_profile_version`, `setup_state='complete'`, bumps `schedule_revision`, marks draft confirmed.
- **Applied profile** (`repos/users.ts getRules`): confirmed `meetingWindows` replace legacy rules in slot computation. Readiness = meeting windows non-empty (`profileReadiness`).
- **Autosave** (`useDraftAutosave`): debounce 500 ms, only valid forms, PATCH sends only changed sections + topic confirmations; `beforeunload` warning while dirty; merges server responses per section; overlapping local+server edits → conflict UI.
- **Chat turn** (`services/onboarding.ts`, `llm/onboarding.ts`):
  - Greeting-only text (안녕, ㅎㅇ, hi, …) is rejected before the model ("A greeting cannot authorize a concrete profile").
  - LLM returns strict JSON `{patch, confirmedTopics}`; system prompt: extract only explicit statements, never assume hours or authorise from history, user text is data. Zod-validated, windows normalised, 1 retry; failure leaves values untouched and marks the message `interpretFailed`.
  - Topics named in `confirmedTopics` become confirmed.
  - Reply is **deterministic** (`explainOnboarding`; the LLM client argument is unused): optional prefix "초안에 반영했어요. 직접 설정 영역도 확인해 주세요." / "말씀을 설정으로 해석하지 못했어요. …", then the question for the first unanswered topic (work → meeting windows → preferences), or "설정 내용을 확인했어요. 최종 확인에서 적용해 주세요."; analysis questions get the F04 answer.
  - Stale revision or > 90 s → error; nothing half-applied.

## Data / API
- Tables `profile_drafts`, `draft_messages`, `profile_versions`, `users.current_profile_version`, `users.setup_state`, legacy `availability_rules`.
- Routes: `POST /api/profile-drafts {purpose}`, `GET /api/profile-drafts/current`, `GET|PATCH /api/profile-drafts/:id {expectedRevision, patch, topicConfirmations}`, `POST …/:id/turns {expectedRevision, text}`, `POST …/:id/analyze`, `POST …/:id/confirm {expectedRevision, baseProfileVersion}`, `GET /api/profile`.

## Code map
`core/profile.ts`, `server/services/{profile,onboarding}.ts`, `llm/onboarding.ts`, `contracts/profile.ts`, `components/onboarding/*` (`draftReducer`, `useDraftAutosave`, `OnboardingEntry`, `OnboardingWorkspace`, `OnboardingChat`, `ProfileEditor`, `WeeklyWindowsEditor`, `PreferenceEditor`, `ProfileSummary`, `WeekSchedule`), `app/(app)/onboarding/page.tsx`, `app/(app)/settings/availability/page.tsx`, `server/repos/users.ts getRules`.

## Depends on / used by
Optionally fed by F04. Consumed by F08 (meeting windows as rules), F09 (preferences inherited into searches), F10 (readiness gate).

## Transplant unit
- **Core**: `core/profile.ts` + the three-topic confirmation rule + "confirmed version only" application.
- **UI**: `WeeklyWindowsEditor` (time range × weekday chips over a flat per-weekday list) and `WeekSchedule` are self-contained and reusable.
- Chat is optional; if dropped, keep the manual editor and topic checkboxes — the product still works (P12).

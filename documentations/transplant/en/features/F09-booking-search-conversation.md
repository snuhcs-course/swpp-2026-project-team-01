# F09 — Booking search: inherited defaults, conversational conditions, ranking, explained candidates

## Intent
- The client should not scan a slot list: they say what they want, chips show what was understood, and the app shows a few genuinely different candidates with the reason they were chosen. `[doc one_pager §2]`
- The saved profile personalises the **first** response: a new search starts from the client's defaults and answers immediately. `[doc availability one_pager §4.5]` `[code createSearch]`
- Each search is a separate "this meeting" context: conditions inherit, override or disable defaults per dimension; nothing written here changes the profile. `[code]` (P7)
- Host preferences matter only between candidates that are equal for the client. `[code]` (P6)

## How the user is led (`components/SearchWorkspace.tsx`, `app/(app)/book/[hostId]/page.tsx`)
1. **/book** contact cards: avatar initial, name, place badges `회사 근처 · <name>`, meeting types `<name> (30분)`; non-bookable → dashed card + badge 예약 불가 + "장소와 미팅 양식을 모두 등록해야 예약을 받을 수 있어요."
2. **Start card** (`/book/<hostId>` without `?search`): "내 기본 선호를 적용해서 새로 찾아볼까요?" / "이번 예약의 조건은 기본 선호와 별도로 유지돼요." → **새 예약 탐색 시작**, link 내 기본 선호 설정; "이전 탐색 이어가기" buttons 이전 탐색 1…10.
3. **Workspace** (title "<host>님과 미팅", "원하는 조건을 말하면 AI가 가능한 시간을 다시 찾아요."):
   - **Chip bar** "적용 중인 조건": each chip = label · source (`기본 선호` neutral outline / `이번 예약` primary tint) · × ("<text> 조건 끄기"). Empty → "적용 중인 조건이 없어요."
   - `<details>` **기본 선호 복원·갱신**: "기본 프로필 버전 N", buttons `<요일|시작 시간|장소·온라인|미팅 양식|날짜|정렬|앞뒤 여유> 복원`, link 최신 기본 선호 가져오기.
   - Stale warning "일정 또는 설정이 바뀌었어요. 후보를 새로 확인해 주세요." (candidates disabled).
   - Left card **예약 도우미와 대화** (placeholder "예: 다음 주 화·목 오후가 좋아요"), assistant name "예약 도우미", pending bubble "가능한 시간을 찾고 있어요…".
   - Right card **가능한 시간**: "후보 N개 · 하나를 골라 요청을 보내요" or "조건에 맞는 후보가 없어요. 조건을 바꿔 보세요."; action 가능한 시간 다시 확인; each candidate one line `M월 D일(요일) HH:MM · 장소 · 양식` with clock icon, pressed state.
   - Selecting a candidate opens the request panel (F10).
   - Bottom link 다른 예약 탐색 시작.

## Rules (verified, `server/services/search.ts` unless noted)
- **Create**: refuse self and non-contacts; reserve the search row first (retry resumes it); store `inherited_profile_version` + `inherited_preferences_json` (snapshot of the client's profile preferences at creation) and empty `overrides`; preflight both calendars (cross-cutting); evaluate with `initial=true`; insert the first assistant message.
- **Effective conditions** (`core/preferences.ts resolvePreferences`): dimensions `weekdays, timeOfDay, location, meetingTypes, dateRange, order, slack`; each `inherit | override(value) | disabled`. Profile maps: weekdays→weekdays, startTime→timeOfDay `HH:MM`, meetingMode→location (online/offline), slack→slack. Location is exclusive: specific `places` replace inherited `meetingMode`.
- **Commands** (`contracts/search.ts`): `set{dimension,value}`, `disable{dimension}`, `restore_inherited{dimension}`, `apply_latest_defaults` (re-snapshots the current profile, keeps overrides/disabled). Chip × sends `disable`.
- **Turn**: LLM `interpret` (call ① only) turns text into `set`/`remove` → `set`/`disable` commands (`places` → `location`). If no LLM or unusable output: no command, reply prefixed "말씀을 조건으로 해석하지 못해 기존 조건을 유지했어요."
- **Interpretation prompt rules** (`llm/interpret.ts`): strength words must=반드시/꼭/절대/~만/~는 안 돼, strong=~이면 좋겠어/선호, weak=가능하면/되도록; 오전 08–12, 오후 12–18, 저녁 18–22, 점심 11:30–13:30; "N시쯤" = N−0:30 … N+1:00, "N시에" = N … N+0:30; negations become allow-lists ("금요일은 안 돼" → weekdays without 5, must); "다음 주/이번 주" resolved from a supplied calendar table; output validated key by key, dates clamped to the 60-day horizon, unknown place/type ids dropped; temperature 0, JSON mode, 1 retry.
- **Ranking** (`core/filter.ts rankForParticipants`):
  1. Drop slots failing any **must** dimension.
  2. Client score = Σ weight(strength) for matched soft dimensions (strong 10, weak 3) + slack weight × min(slack, 2 h), in integer units.
  3. Host score = same function over the host's **current** profile preferences.
  4. Order: client score ↓ → (only if `order` set) nearer day first, then earlier/later time within the day → host score ↓ → start ↑ → placeId → meetingTypeId. `latest` never means "farthest date".
- **Candidates** (`core/options.ts`): top 3 by rank, skipping same-day starts < 60 min from an already picked one, then filled by rank. In this flow **always shown** (`requested=true`).
- **Reply text** (`saveResult`, deterministic): `[failure prefix] + [initial & inherited: "기본으로 선호하시는 조건을 적용해 찾아봤어요. "] + [0 results: "현재 허용 시간과 필수 조건에 맞는 후보가 없어요. 조건을 조정하거나 프로필을 확인해 주세요. " | preference mismatch: "가능한 시간은 있지만 선호와 모두 맞는 시간은 없어요. "] + basisSentence + [host tie-break used: " 사용자 선호 점수가 같은 후보에는 호스트 선호를 반영했어요."]`.
- **basisSentence** (`core/explain.ts`, parts joined by spaces): "[‘chip’ 조건을 반영해서] [‘chip’ 조건은 빼고] ‘<must texts>’은(는) 반드시 지키고 <soft text>(강하게 선호|약하게 선호) 조건에 맞는 것을 앞에 두고 <describeOrder> 기준으로 [서로 60분 이상 떨어진 ]후보 N개를 골랐어요." — e.g. "‘평일’은(는) 반드시 지키고 12:00–18:00(강하게 선호) 조건에 맞는 것을 앞에 두고 조건 점수가 높은 순, 같으면 이른 시각 순 기준으로 후보 3개를 골랐어요." The "60분" phrase appears only when diversification actually skipped a candidate. + per-candidate "<label> 후보는 <prefs> 조건에 맞지 않아요." only when some (not all) shown candidates miss a preference `[commit 1843e51]`. `hostTieBreakUsed` is true only if a shown candidate actually beat an equal-client-score alternative on host score.
- **Staleness**: `data_basis_json` snapshots both users' profile version, schedule/host/annotation/calendar revisions, rules, places, types and events. `readSearch` compares with current → `candidateState: ready | stale | not_ready`.
- Every mutation: `expectedRevision`, preflight, 90 s guard, re-check revision inside the transaction.

## Data / API
- Tables `booking_searches` (id, client_id, host_id, seq, revision, inherited_profile_version, inherited_preferences_json, overrides_json, last_result_json, data_basis_json, initial_reply_state), `search_messages`.
- Routes: `POST /api/searches {hostId, meetingTypeId?}`, `GET /api/searches/:id`, `POST /api/searches/:id/turns {expectedRevision, text}`, `…/conditions {expectedRevision, commands[1..20]}`, `…/refresh {expectedRevision}` → `SearchScreenView {searchId, hostId, revision, inheritedProfileVersion, inheritedPreferences, effectiveConditions, candidateState, candidates[], count, labels[], chips[], sources, overrides, messages[], basis}`.

## Code map
`server/services/search.ts`, `core/{preferences,filter,options,summary,chips,explain}.ts`, `llm/interpret.ts`, `llm/ollama.ts`, `contracts/search.ts`, `components/SearchWorkspace.tsx`, `app/(app)/book/{page,[hostId]/page}.tsx`. Eval script `scripts/eval-interpret.ts`.

## Not in the live journey (present in code)
`server/services/chat.ts` + `llm/respond.ts` implement the original two-call turn (LLM-written reply, ask-back on distribution, "ask meeting length first", "same as before" suppression, relax hints). Their routes `/api/conversations*` are retired (always `invalid_input` "예약 화면에서 새 탐색을 시작해 주세요"). Only tests use them. See `transplant-guide.md §4`.

## Transplant unit
- **Engine** (`core/*` listed above) is pure and portable.
- **Conversation**: `interpret` + command mapping. Re-enable `respond` only if LLM-written replies are wanted; keep P2 (basis computed in code).
- **UI**: chip-with-source pattern and the 3-candidate card are the recognisable design elements.

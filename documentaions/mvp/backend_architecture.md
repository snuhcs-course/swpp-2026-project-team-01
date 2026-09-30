# Backend Architecture — AI 미팅 예약 (가칭)

작성일: 2026-09-29 · 상태: 확정 (2026-09-29) · 수정: 2026-09-30 (Supabase 전환) · 상위: `technical_architecture.md`

---

## 1. 모듈

```
src/                    # 팀 리포의 apps/web/src
  core/                 # 순수 TS. I/O 없음. 실제 앱으로 가져갈 자산
    types.ts            # Event, Place, MeetingType, Slot, Filter, Summary …
    time.ts             # KST 변환, 30분 격자
    availability.ts     # 가능 시간 규칙 → 바쁜 구간
    travel.ts           # 이동시간 표 (호스트/클라이언트)
    slots.ts            # computeSlots(host, client, now) → Slot[]
    filter.ts           # applyFilter, score, rank, mergeFilter(교체/추가)
    summary.ts          # 개수·분포·동점 수, 0개일 때 완화별 개수
    options.ts          # 버튼 표시 판정 (showOptions | 3위 확정 | ≤3)
    booking.ts          # 요청 겹침 검사, 수락 시 자동 거절 대상 계산
  llm/                  # 실제 앱으로 가져갈 자산
    ollama.ts           # kibitzer postChat 이식 + assistant 역할 + 코드펜스 제거
    interpret.ts        # 호출 ①: 프롬프트, zod 스키마, 1회 재시도
    respond.ts          # 호출 ②: 프롬프트, 실패 시 템플릿 문장
  server/               # 데모 전용
    db/schema.ts, db/client.ts, db/seed.ts
    repos/*.ts          # 테이블별 조회·저장
    services/
      chat.ts           # 대화 한 턴 오케스트레이션
      booking.ts        # 요청 생성·철회·수락·거절
      schedule.ts       # 사용자별 입력(일정+accepted+규칙) 조립 → core 호출
    session.ts          # 쿠키 uid로 현재 사용자
  app/api/**/route.ts   # Route Handlers (얇게: 파싱 → 서비스 → 응답)
```

## 2. 데이터 모델 (Supabase Postgres)

| 테이블 | 컬럼 |
|---|---|
| users | id, name |
| availability_rules | user_id, weekday(0–6), enabled, start_min, end_min |
| places | id, host_id, kind(`office_near`\|`special`\|`online`), name |
| meeting_types | id, host_id, name, duration_min |
| events | id, user_id, title, start_at, end_at, location_kind(`office`\|`place`\|`online`\|`none`), place_ref(nullable), source(`seed`\|`manual`\|`booking`), request_id(nullable) |
| conversations | id, client_id, host_id, filter_json, UNIQUE(client_id, host_id) |
| messages | id, conversation_id, role(`user`\|`assistant`), content, options_json(nullable), created_at |
| requests | id, client_id, host_id, start_at, end_at, place_id, meeting_type_id, message, status(`pending`\|`accepted`\|`declined`\|`withdrawn`), decided_at |

- 스키마 원본은 리포 루트 `supabase/schemas/scheduler.sql`이고, 마이그레이션은 `supabase/migrations/`에 커밋한다. Drizzle 정의(`src/server/db/schema.ts`)도 같이 맞춘다.
- 서버가 DB 소유자로 직접 접속하고 Supabase Data API는 쓰지 않는다. 그래서 `anon`·`authenticated`의 테이블 권한을 모두 회수하고, 한 겹 더 막기 위해 모든 테이블에 RLS를 켜되 정책은 두지 않는다.
- 시각은 UTC ISO 문자열(`text`)로 저장하고, 표시는 KST로 한다.
- `place_ref`는 "같은 장소" 판정에 쓰는 식별자다. 수락된 미팅 일정은 `places.id`를, 일반 일정은 장소명을 넣는다.
- "만료"는 저장하지 않는다. 조회 시점에 `pending && start_at < now`로 계산한다.

## 3. core 규칙 구현

### 3.1 슬롯 계산 `computeSlots`
1. 후보를 만든다: 오늘부터 60일 × 30분 격자 시작 시각 × 호스트 장소 × 미팅 양식. `now + 2h` 이전 후보는 버린다.
2. 두 사람 각각에 대해 검사한다.
   - `[start, end]`가 가능 시간 규칙 안에 있는가. 규칙 경계에는 이동시간을 붙이지 않는다.
   - 겹치는 일정이 없는가(일정 = events, 수락된 미팅 포함).
   - 직전 **오프라인** 일정: `prev.end + travel(prev, place) ≤ start`
   - 직후 **오프라인** 일정: `end + travel(place, next) ≤ next.start`
   - 온라인 일정(`location_kind=online`)은 겹침 검사에만 쓰고, prev/next를 찾을 때는 건너뛴다.
3. 규모: 60 × 28 × 3 × K개 후보이고, 매 요청마다 다시 계산한다(캐시 없음). NFR-1(1초)을 만족하는지는 단위 테스트에서 측정한다.

### 3.2 이동시간 `travel(from, to, role)`
- 호스트: one_pager 4.3 표를 그대로 코드로 옮긴다.
  - 표의 "회사" = `location_kind=office`
  - "회사 외 장소" = `place`, `none`
- 클라이언트: 미팅이 온라인이면 0분, 아니면 1시간.
- 공통: 같은 `place_ref`면 0분.
- 표의 모든 칸을 테스트 케이스로 만든다. 여기에 "회사 → 온라인 일정 → 특정 장소 미팅" 같은 온라인 일정 끼임 케이스를 추가한다.

### 3.3 필터 · 점수 · 순위
```ts
type Strength = "must" | "strong" | "weak"
type Filter = {
  dateRange?:  { from: string; to: string; strength: Strength }   // YYYY-MM-DD
  weekdays?:   { days: number[]; strength: Strength }
  timeOfDay?:  { start: string; end: string; strength: Strength } // HH:MM
  places?:     { placeIds: string[]; strength: Strength }
  meetingTypes?: { ids: string[]; strength: Strength }
  order?:      "earliest" | "latest"
  slack?:      { strength: Exclude<Strength, "must"> }            // 앞뒤 여유
}
```
- `must`는 슬롯을 제거한다. `strong`은 +10점, `weak`는 +3점이다(튜닝 대상).
- `slack` 점수는 앞뒤 인접 일정과의 여유 시간을 0–1로 정규화한 값에 가중치를 곱한다.
- 정렬: 점수 내림차순 → `order`(없으면 이른 시각) → 장소 id → 양식 id. 끝까지 결정적이다.
- **3위 확정**: 3위와 4위의 점수가 다르다. 또는 `order`가 지정되어 있다(시각으로 동점이 완전히 풀리므로).
- 정렬: 점수 → **날짜(가까운 순)** → 시각(`order`가 `latest`면 늦은 순, 아니면 이른 순) → 장소 → 양식. `latest`는 가장 먼 날짜가 아니라 "같은 날 늦은 시각 우선"이다.
- `mergeFilter`: 키 단위로 교체한다. 호출 ①의 출력은 변경분(`set` / `remove` 키 목록)이다.

### 3.4 예약 규칙 (`booking.ts`)
- 생성 시 두 가지를 검사한다.
  - `computeSlots`에 해당 슬롯이 있는가
  - 이 클라이언트의 pending 요청(호스트 무관) 중 시간이 겹치는 것이 없는가
- 생성·수락·거절·철회는 트랜잭션 안에서 `pg_advisory_xact_lock`을 잡고 하나씩 처리한다. 동시에 들어온 수락이 같은 시간을 이중 예약하지 않게 하기 위해서다(SQLite 시절에는 동기 실행이라 저절로 보장되던 것).
- 수락은 한 트랜잭션에서 처리한다.
  1. 다시 검증한다.
  2. 상태를 accepted로 바꾼다.
  3. 같은 호스트에게 온 요청 중 시간이 겹치는 pending 요청을 모두 declined로 바꾼다.
  4. 양쪽에 `events(source=booking)`를 추가한다.
- 철회는 상태를 withdrawn으로 바꾼다. 요청함과 겹침 검사에서 빠진다.

## 4. 대화 한 턴 (`services/chat.ts`)
1. 사용자 메시지를 저장한다.
2. **호출 ①** `interpret(history, filter, today, places, meetingTypes)`
   - 출력: `{ set: Partial<Filter>, remove: (keyof Filter)[], showOptions: boolean }`
   - zod로 검증한다. 실패하면 1회 재시도하고, 그래도 실패하면 필터를 유지하고 `interpretFailed=true`로 둔다.
   - 날짜가 범위(오늘–60일) 밖이거나 placeId·양식 id가 목록에 없으면 해당 키만 버린다.
3. `mergeFilter` → `computeSlots` → `applyFilter` / `rank` → `summary` → `options` 판정
4. **호출 ②** `respond(...)` → `{ text, fallback, unavailable, ms }`. 호출 ①이 "서비스 불가"로 끝났으면 호출하지 않고 템플릿을 쓴다. 호출 ②가 실패해도 템플릿 문장을 쓴다. 후보가 많아 되묻는 경우 미팅 양식이 미정이면 `askMeetingType`을 넘겨 길이를 먼저 묻게 한다.
5. assistant 메시지(문장 + 버튼 슬롯 스냅샷)와 필터를 저장하고 반환한다.
- 칩 삭제(`PATCH .../filter`)는 LLM을 부르지 않고 3번 단계만 실행한다.

## 5. LLM 어댑터 (`llm/ollama.ts`)
- kibitzer `apps/extension/src/providers/ollamaChat.ts`(origin/dev c1e3101)의 `postChat`을 옮기고, 다음을 바꾼다.
  - 메시지 역할에 `assistant`를 추가한다.
  - `chat(messages, { json, numPredict, think })` 형태의 범용 메서드로 만든다.
  - 응답 앞뒤의 ```` ```json ```` 펜스를 제거한 뒤 파싱한다. gemma4:31b가 펜스를 붙이는 것을 실측에서 확인했다.
- 그대로 유지하는 것: 키 로테이션(401/403/429), 본문을 다 읽을 때까지 적용되는 타임아웃, `temperature: 0`(호출 ①).
- 호출 ②는 `format` 없이, `temperature`를 약간 올려서 부른다(0.3).

## 6. API (Route Handlers)

| 메서드 · 경로 | 용도 |
|---|---|
| `POST /api/session` | 현재 사용자 전환(쿠키) |
| `GET/POST/DELETE /api/events` | 내 일정 |
| `PUT /api/availability` | 가능 시간 규칙 |
| `GET/POST/PATCH/DELETE /api/places`, `/api/meeting-types` | 호스트 설정 |
| `POST /api/conversations` | (client, host) 대화 가져오기 또는 생성 |
| `POST /api/conversations/[id]/turns` | 대화 한 턴 |
| `PATCH /api/conversations/[id]/filter` | 칩 삭제 → 재계산 |
| `POST /api/requests` | 요청 생성 |
| `POST /api/requests/[id]/withdraw` · `/accept` · `/decline` | 상태 변경 |

- 오류는 `{ code, message }` 형식이다. 검증 실패는 409를 쓰고, `code`는 `slot_unavailable` 또는 `overlapping_request`다.

## 7. 결정 기록
- 2026-09-29: 이동시간은 **직전/직후 오프라인 일정** 기준으로 판정한다(§3.1). 온라인 일정은 이동을 없애주지 않는다.

## 8. 로그 · 실패 종류
- `src/server/log.ts`의 `logEvent(event, fields)`가 JSON 한 줄을 stdout에 남긴다(test 환경과 `LOG_LEVEL=silent`에서는 조용).
  - `chat.turn`: `interpret {ms, attempts, failure, set[], remove[], showOptions}`, `respond {ms, fallback}`, `count`, `buttons`(사유 또는 null), `askMeetingType`, `totalMs`, `model`
  - `chat.filter_removed`, `request.created|accepted|declined|withdrawn`, `api.rejected {code}`, `api.llm_error {status}`
  - 메시지 본문, API 키는 남기지 않는다.
- LLM 실패는 두 종류다(`llm/ollama.ts`의 `classifyFailure`). `ModelOutputError`(모델이 답했지만 쓸 수 없음) = `unparseable`, 그 밖의 모든 오류(HTTP 상태, 시간 초과, 네트워크) = `unavailable`.
- 버튼 후보는 `core/options.ts`의 `pickDiverse`로 고른다(시작 시각이 같은 날 60분 이내인 후보는 건너뜀).

## 9. 설명 근거 (`core/explain.ts`)
- `diffChips(before, after)`: 이번 턴에 추가·교체·삭제된 조건(칩 문구).
- `selectionBasis(...)`: 반드시 조건, 선호 조건(강/약), 정렬 설명, 다양화 여부, 후보별 맞춘/못 맞춘 선호와 앞뒤 여유를 계산한다. 호출 ②에는 이 값만 근거로 준다.
- `basisSentence(...)`: LLM 없이 쓰는 같은 내용의 문장.
- 채팅 서비스는 이전 assistant 메시지의 버튼을 호출 ①에 `lastShown`으로 넘기고, 새 후보가 그와 같으면 `sameAsBefore`를 켠다(사용자가 요청한 경우가 아니면 버튼을 생략).

# Implementation Plan — AI 미팅 예약 (가칭)

작성일: 2026-09-29 · 상태: 확정 (2026-09-29) · 진행: M0–M7 완료 · 2026-09-30 팀 리포 이관·Supabase 전환
순서대로 진행한다. 각 마일스톤은 **완료 기준**을 만족해야 다음으로 넘어간다. 괄호는 관련 요구사항이다.

---

## M0. 프로젝트 셋업
- [x] `git init`, `.gitignore`(.env, data/, node_modules, .next)
- [x] 기획 문서를 `docs/`로 이동 (`repo_structure.md`)
- [x] Next.js(App Router, TS) + Tailwind 스캐폴드, Vitest 설정
- [x] SQLite 드라이버 확정: `better-sqlite3` 13이 Node v25.9.0에서 설치·동작함을 확인(`node:sqlite`도 동작)
- [x] `.env`에 `OLLAMA_MODEL=gemma4:31b`, `DATABASE_PATH` 추가 · `.env.example` 작성
- **완료 기준**: `npm run dev`, `npm test`, `npm run typecheck`가 빈 앱에서 통과한다.

## M1. core — 슬롯 계산 (FR-10–15)
- [x] `types.ts`, `time.ts` (KST +09:00, 30분 격자)
- [x] `availability.ts` (규칙 → 바쁜 구간)
- [x] `travel.ts` + 이동시간 표 **전 칸** 테스트 + 온라인 일정이 끼어 있는 케이스
- [x] `slots.ts` `computeSlots` + 경계 테스트(규칙 경계에는 이동시간 없음, now+2h, 60일 끝)
- [x] 성능 테스트: 2명 × 60일 × 장소 3 × 양식 3 < 1초 (NFR-1)
- **완료 기준**: `tests/core` 전부 통과한다.

## M2. DB · 시드 · 기본 화면 (FR-1–5, US-1–4, US-10–11)
- [x] Drizzle 스키마(`backend_architecture.md` §2), `npm run db:reset`(스키마 + 시드)
- [x] 시드: 사용자 3–4명, 실행일 기준 60일 일정. 회사, 장소명, 온라인, 장소 없음을 섞고, 데모 시나리오(M7)가 성립하도록 배치
- [x] `session.ts` + S0 헤더(`UserSwitcher`, 메뉴)
- [x] S1 내 캘린더(주 단위 보기, 추가·삭제), S2 가능 시간 규칙, S3 호스트 설정(장소, 양식 길이는 분 단위 입력)
- **완료 기준**: 사용자를 바꾸면 S1–S3에 각자의 데이터가 보이고, 편집한 내용이 저장된다.

## M3. core — 필터 · 순위 · 요약 (FR-23–29)
- [x] `filter.ts`: `mergeFilter`(키 단위 교체), `applyFilter`(must), 점수(strong +10 / weak +3 / slack), 결정적 정렬
- [x] `summary.ts`: 개수, 주·요일·시간대·장소·양식별 분포, 최고점 동점 수, 0개일 때 조건별 완화 개수
- [x] `options.ts`: 버튼 표시 판정(showOptions | 3위 확정 | ≤3)
- [x] `booking.ts`: 겹침 검사(호스트 무관), 수락 시 자동 거절 대상 계산
- **완료 기준**: `tests/core`에 필터·순위·판정·예약 규칙 케이스가 추가되고 모두 통과한다.

## M4. LLM (FR-21–22, NFR-2, NFR-5)
- [x] `llm/ollama.ts`: kibitzer `postChat` 이식 + `assistant` 역할 + 코드펜스 제거 + 키 3개 로테이션. fetch 목으로 테스트
- [x] `interpret.ts`: 프롬프트(오늘 날짜·요일, 장소/양식 id 목록), zod 스키마(`set`/`remove`/`showOptions`), 1회 재시도, 범위 밖 값은 키 단위로 버림
- [x] `respond.ts`: 프롬프트(요약만 근거로 말하게, 슬롯을 지어내지 않게), 실패 시 템플릿 문장
- [x] `scripts/eval-interpret.ts`: 한국어 입력 10–20개 × gemma4:31b / nemotron-3-nano:30b → 필터 정확도, 두 번 호출 합산 지연
- **완료 기준**: 평가 스크립트 결과를 기록하고, 모델을 확정해 `.env`에 반영한다. 두 번 호출 p50이 3초를 넘으면 사용자와 대응을 협의한다.
- **결과 (2026-09-29, `scripts/eval-interpret.ts`, 한국어 입력 14개·확인 항목 26개, 각 1회 실행)**

  | 모델 | 정확도 | ① 해석 p50 / p95 | ② 응답 p50 | ①+② 평균 합산 |
  |---|---|---|---|---|
  | `gemma4:31b` | 26/26 (100%) | 795ms / 1373ms | 618ms | 약 1.5초 |
  | `nemotron-3-nano:30b` | 18/26 (69%) | 812ms / 2146ms | 637ms | 약 1.7초 |

  - **`gemma4:31b`로 확정**했다. p50 3초 기준(NFR-2)을 만족한다.
  - nemotron은 "안녕하세요"에도 프롬프트 예시의 필터를 그대로 만들어 냈다(예시 누출).
  - 한계: 케이스를 직접 작성했고 프롬프트 예시와 표현이 비슷하다. 실행은 모델당 1회라 분산을 보지 못했다. 100%를 일반 성능으로 읽으면 안 된다.

## M5. 예약 대화 (FR-6, FR-20–29, US-20–25)
- [x] API: `POST /api/conversations`, `POST .../turns`, `PATCH .../filter`
- [x] `services/chat.ts`: 저장 → ① → merge/compute/rank/summary/options → ② → 저장
- [x] S4 호스트 목록(예약 불가 표시, 자기 자신 제외)
- [x] S5: `ChatView`, `FilterChips`(삭제 → 재계산), `OptionButtons`(최대 3개, 한 줄 문구), LLM 장애 배너
- **완료 기준**: 수용 기준 2·3번(PRD §5)이 브라우저에서 재현된다.

## M6. 요청 · 요청함 (FR-30–43, US-12–14, US-26–28)
- [x] API: `POST /api/requests`, `withdraw` / `accept` / `decline` (409: `slot_unavailable`, `overlapping_request`)
- [x] 수락 트랜잭션: 재검증 → accepted → 겹치는 pending 자동 거절 → 양쪽 events 추가
- [x] S6 요청 모달, S7 내 요청(철회, 만료 표시), S8 받은 요청함(시간대별 묶음, 자동 거절 N건 확인)
- **완료 기준**: 수용 기준 4·5번이 재현된다.

## M7. 데모 마감
- [x] 수용 기준 1–5를 처음부터 끝까지 한 번에 시연한다(`db:reset` 직후 기준).
- [x] README의 데모 시나리오 절 작성
- [x] 발견한 문제는 목록으로 남긴다. 범위 밖 수정은 하지 않는다.
- **완료 기준**: 새 환경에서 README 절차만 따라 데모가 재현된다.

---

## 위험 · 선행 확인
| 항목 | 영향 | 대응 |
|---|---|---|
| SQLite 드라이버와 Node 25 호환 | M0 지연 | 해소: better-sqlite3 13 정상 동작 |
| 한국어 필터 추출 품질 | 데모 핵심 | M4 평가 스크립트로 먼저 측정. 필요하면 프롬프트 수정 또는 모델 교체 |
| 두 번 호출 지연 | UX | M4에서 측정 |
| Ollama 무료 한도 | 데모 중단 | 키 3개 로테이션. 한도 정책은 공식 문서에서 구체 수치를 확인하지 못함 |

---

## M7 검증 기록 (2026-09-29)
- **자동 테스트**: `npm test` — core 슬롯·이동시간·필터·순위·예약 규칙, LLM 어댑터·해석·응답, 서버 예약·대화 서비스(메모리 DB).
- **HTTP 시나리오**(개발 서버 + 실제 LLM, 스크래치 스크립트로 실행): 수용 기준 2–5와 아래 항목을 통과했다.
  - 대화: 다음 주 평일 오후·온라인·금요일 제외 → 칩 4개, 후보 194개, 버튼 없이 되물음 → "제일 빠른 걸로 보여줘" → 버튼 3개. 칩 삭제 후 재계산. 응답 시간 턴당 1.5–2.4초.
  - 예약: 같은 슬롯에 두 클라이언트 요청(둘 다 접수), 수락 시 다른 요청 자동 거절, 양쪽 캘린더 반영, 수락된 시간 재요청 거부, 한 클라이언트의 호스트 무관 겹침 거부, 철회·거절 후 재요청, 남의 요청 처리 403, 재수락 409.
  - 설정: 일정 추가·삭제(수락된 미팅은 삭제 불가), 가능 시간 변경 시 후보 수 감소, 장소·양식이 없는 호스트는 예약 불가 → 등록 후 예약 가능.
  - 화면: 서버 렌더링된 HTML로 호스트 목록(본인 제외·예약 불가 표시), 요청함 묶음 문구, 헤더 배지, 캘린더 반영을 확인했다.
- **확인하지 못한 것**: 브라우저에서의 실제 클릭·하이드레이션·레이아웃(HTML 응답만 확인). 슬롯 계산은 DB 조회와 순위 포함 7–36ms(시드 데이터, 후보 4,583개).

## 개선 반영 기록 (2026-09-30)
- 개발 서버와 `start`를 `127.0.0.1`로 제한, 턴별 JSON 로그, LLM 장애와 해석 실패 구분(배너 분리, 장애 시 ② 생략, 호출 제한 시간 20초).
- 버튼 후보 다양화(같은 날 60분 이내 후보 제외), 후보가 많고 길이가 미정이면 길이를 먼저 되묻기.
- 실제 사용 기록(DB의 대화 7턴)에서 발견해 고친 것: `latest`가 가장 먼 날짜로 동작함, 정렬이 고착됨, "조금 더 늦은 시간" 같은 상대 표현을 해석하지 못함, 답변이 매번 같은 문장이었음, 같은 버튼이 매 턴 반복됨, "6시쯤"이 30분 폭으로 좁게 해석됨.
- 버튼과 함께 "어떤 기준에서 어떻게 골랐는지" 설명을 붙임(근거는 코드가 계산).
- 평가 재실행: `gemma4:31b` 37/37 (19개 케이스). 같은 7턴 대화를 재생해 위 문제가 사라진 것을 확인했다. 턴당 1.3–4.3초.
- 한계: 평가 케이스는 직접 작성했다. 이전 실행에서 한 턴이 7초·11초 걸린 적이 있으나 재현하지 못했다(로그로 추적 가능).

## 팀 리포 이관 · Supabase 전환 기록 (2026-09-30)
위 M0–M7 기록은 SQLite 시절 그대로 둔다. 이관 후 달라진 점만 적는다.
- 위치: 앱은 `apps/web/`, 문서는 `documentaions/mvp/`, 브랜치 `mvp/enu3379`.
- DB: SQLite(`better-sqlite3`) → Supabase(Postgres). 이유는 `technical_architecture.md` §6.
  - 스키마는 `supabase/schemas/scheduler.sql`(테이블·인덱스는 SQLite 때와 같음, 모든 테이블에 RLS만 추가), 마이그레이션은 `supabase/migrations/`.
  - DB 코드를 모두 async로 바꿨다. 예약 변경(생성·수락·거절·철회)은 advisory lock으로 직렬화한다.
  - `npm run db:reset`은 테이블을 만들지 않고 행 삭제 + 시드만 한다.
  - `currentUser()`가 쿠키를 DB보다 먼저 읽게 바꿨다. `next build`가 DB 없이 통과한다.
- 테스트: 서버 테스트는 메모리 SQLite 대신 PGlite에 `supabase/migrations`를 적용해 돌린다. 149개 전부 통과(전환 전과 같은 개수).
- 마이그레이션: `supabase db diff --use-migra -f scheduler_mvp`로 생성하고 `supabase db reset`으로 적용을 확인했다. 팀 `config.toml`에 `[experimental.pgdelta] enabled = true`가 있어 `--use-migra` 없이는 pg-delta 엔진이 선택된다(루트 `AGENTS.md`는 migra를 전제).
  - Data API 역할(`anon`·`authenticated`) 권한을 회수했다. migra는 새 테이블에 대한 `revoke`를 생성하지 않아서(적용 후 두 역할이 8개 테이블 모두 조회 가능했음), 마이그레이션 끝에 `revoke`를 손으로 추가했다. `db reset` 후 두 역할의 권한 0개, anon 키로 REST 조회 시 401, 스키마와 마이그레이션 간 diff 없음을 확인했다.
- 로컬 Supabase 연결 실행(개발 서버 + HTTP): 6개 화면 렌더링, 장소·가능 시간 CRUD, 대화 생성과 실제 LLM 한 턴(칩 4개, 메시지 저장), 요청 생성 → 같은 슬롯 두 요청을 **동시에** 수락 시 한 건만 성공(나머지 409 `not_pending`), 캘린더에 미팅 한 건, 수락된 시간 재요청 409.
- **확인하지 못한 것**: 원격 Supabase 프로젝트·Vercel 배포(팀이 환경을 정한 뒤), 브라우저 클릭.
